import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { appFeedback, users } from '@music-hub/db';
import { type AppFeedbackContext, appFeedbackSchema, withoutTokens } from '@music-hub/shared';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../lib/admin.js';
import { createIssue } from '../lib/github.js';
import { t } from '../lib/i18n.js';
import { rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { imageType, UUID } from '../lib/updates.js';
import { captureException } from '../monitoring.js';
import { sendAppFeedbackEmail } from '../services/email.js';
import type { AppEnv } from '../types.js';

// Bug reports and ideas about the app from the bug button (README, „Feedback zur App“)
const reportsPerUser = rateLimit('app-feedback-per-user', 10, 60 * 60 * 1000);

type Report = {
  id: string;
  user: { id: string; name: string; email: string };
  kind: 'bug' | 'idea';
  message: string;
  context: AppFeedbackContext & { api: string };
};

const firstLine = (message: string) => {
  const line = message.split('\n')[0]!;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
};

// Developer-facing, so English like the rest of the repo
function details({ id, user, context }: Report) {
  return [
    ['Page', context.page],
    ['Version', [context.version && `${context.platform} ${context.version}`, `api ${context.api}`].filter(Boolean).join(' · ')],
    ['Device', context.device],
    ['Window', context.viewport],
    ['Language', context.locale],
    ['Recent errors', context.errors.join(', ') || '–'],
    ['Tester', user.id],
    ['Feedback', id],
  ] as const;
}

// The repo is public: no name, email or screenshot in the issue. Replies go through the mail.
function issue(report: Report) {
  const cell = (value: string) => value.replace(/[|\n\r`]/g, ' ');
  return {
    title: `Feedback: ${firstLine(report.message)}`,
    body: [
      report.message
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n'),
      `| | |\n|---|---|\n${details(report)
        .map(([key, value]) => `| ${key} | \`${cell(value)}\` |`)
        .join('\n')}`,
    ].join('\n\n'),
    labels: ['feedback', report.kind, report.context.platform],
  };
}

function mail(report: Report, to: string, issueUrl: string | null, screenshot: Buffer | null) {
  return {
    to,
    replyTo: { name: report.user.name, address: report.user.email },
    subject: `${report.kind === 'bug' ? 'Bug' : 'Idea'} from ${report.user.name}: ${firstLine(report.message)}`,
    text: [
      report.message,
      '--',
      `${report.user.name} <${report.user.email}>`,
      ...details(report).map(([key, value]) => `${key}: ${value}`),
      issueUrl && `Issue: ${issueUrl}`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
    attachments: screenshot
      ? [{ filename: `screenshot.${imageType(screenshot) === 'image/png' ? 'png' : 'jpg'}`, content: screenshot }]
      : [],
  };
}

export const appFeedbackRoutes = new Hono<AppEnv>()
  // Stored first, so a failing mail or GitHub loses nothing
  .post('/', requireAuth, zValidator('json', appFeedbackSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    if (!(await reportsPerUser.hit(db, userId))) return tooManyRequests(c);
    const { kind, message, context, screenshot: base64 } = c.req.valid('json');
    const screenshot = base64 ? Buffer.from(base64, 'base64') : null;
    if (screenshot && !imageType(screenshot)) return c.json({ error: t(c).errors.invalidScreenshot }, 400);

    const [user] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
    const fullContext = {
      ...context,
      page: withoutTokens(context.page),
      errors: context.errors.map(withoutTokens),
      api: process.env.APP_VERSION || 'dev',
    };
    const [row] = await db
      .insert(appFeedback)
      .values({ userId, kind, message, screenshot, context: fullContext })
      .returning({ id: appFeedback.id });
    const report: Report = { id: row!.id, user: user!, kind, message, context: fullContext };

    let issueUrl: string | null = null;
    try {
      issueUrl = await createIssue(issue(report));
      if (issueUrl) await db.update(appFeedback).set({ issueUrl }).where(eq(appFeedback.id, report.id));
    } catch (err) {
      console.error('[Feedback] Issue failed:', err);
      captureException(err);
    }
    const to = process.env.FEEDBACK_EMAIL;
    try {
      if (to) await sendAppFeedbackEmail(mail(report, to, issueUrl, screenshot));
    } catch (err) {
      console.error('[Feedback] Mail failed:', err);
      captureException(err);
    }
    return c.json({ ok: true });
  })

  .get('/:id/screenshot', requireAuth, requireAdmin, async (c) => {
    const id = c.req.param('id');
    const [row] = UUID.test(id)
      ? await c.get('db').select({ screenshot: appFeedback.screenshot }).from(appFeedback).where(eq(appFeedback.id, id))
      : [];
    if (!row?.screenshot) return c.json({ error: 'Not found' }, 404);
    return c.body(new Uint8Array(row.screenshot), 200, {
      'content-type': imageType(row.screenshot)!,
      'cache-control': 'no-store',
    });
  });
