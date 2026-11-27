import { afterAll, afterEach, beforeAll, expect, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { appFeedback, createDb, migrateDb, sessions, users } from '@music-hub/db';
import { ADMIN_EMAILS } from './lib/admin.js';
import { generateToken, hashToken } from './middleware/auth.js';
import { appFeedbackRoutes } from './routes/app-feedback.js';
import type { AppEnv } from './types.js';

const ADMIN = `admin-${crypto.randomUUID()}@example.com`;
ADMIN_EMAILS.add(ADMIN);

const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.set('db', db);
    await next();
  })
  .route('/app-feedback', appFeedbackRoutes);
const log = spyOn(console, 'log');
const emails: string[] = [];

beforeAll(() => migrateDb(process.env.DATABASE_URL!));
afterAll(async () => {
  await db.delete(users).where(inArray(users.email, emails));
  await db.$client.end();
});
afterEach(() => {
  delete process.env.FEEDBACK_EMAIL;
  delete process.env.FEEDBACK_GITHUB_TOKEN;
  delete process.env.GITHUB_REPOSITORY;
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');

const context = {
  platform: 'web',
  page: '/music',
  device: 'Chrome 141 · macOS',
  viewport: '1440×900 @2x',
  locale: 'de',
  errors: ['POST /api/v1/tracks → 500'],
};

async function logIn(email = `test-${crypto.randomUUID()}@example.com`) {
  emails.push(email);
  const [user] = await db.insert(users).values({ email, name: 'Lena' }).returning({ id: users.id });
  const token = generateToken();
  await db.insert(sessions).values({ userId: user!.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 60_000) });
  return { id: user!.id, email, cookie: `session=${token}` };
}

function send(cookie: string | null, body: unknown) {
  return app.request('/app-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const reports = (userId: string) => db.select().from(appFeedback).where(eq(appFeedback.userId, userId));
const lastMail = () => log.mock.calls.map((args) => String(args[0])).findLast((line) => line.startsWith('[DEV] App feedback mail'));

test('feedback on the app needs a login', async () => {
  expect((await send(null, { kind: 'idea', message: 'Mehr Farben', context })).status).toBe(401);
});

test('a bug report is stored, mailed with reply-to the tester and filed as an issue without personal data', async () => {
  const tester = await logIn();
  process.env.FEEDBACK_EMAIL = 'robin@example.com';
  process.env.FEEDBACK_GITHUB_TOKEN = 'token';
  process.env.GITHUB_REPOSITORY = 'robinchoice/musichub';
  const github = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    Response.json({ html_url: 'https://github.com/robinchoice/musichub/issues/7' }, { status: 201 }),
  );

  const res = await send(tester.cookie, {
    kind: 'bug',
    message: 'Export geht nicht\nEs kommt nur ein Fehler.',
    screenshot: PNG,
    context,
  });
  const [url, init] = github.mock.calls[0]!;
  github.mockRestore();
  expect(res.status).toBe(200);

  const [row] = await reports(tester.id);
  expect(row).toMatchObject({ kind: 'bug', issueUrl: 'https://github.com/robinchoice/musichub/issues/7' });
  expect(row!.context).toMatchObject({ ...context, api: 'dev' });

  expect(url).toBe('https://api.github.com/repos/robinchoice/musichub/issues');
  const issue = JSON.parse(String(init!.body));
  expect(issue.title).toBe('Feedback: Export geht nicht');
  expect(issue.labels).toEqual(['feedback', 'bug', 'web']);
  expect(issue.body).toContain('> Es kommt nur ein Fehler.');
  expect(issue.body).toContain(row!.id);
  expect(issue.body).not.toContain(PNG);
  expect(issue.body).not.toContain(tester.email);
  expect(issue.body).not.toContain('Lena');

  expect(lastMail()).toStartWith('[DEV] App feedback mail to robin@example.com: Bug from Lena: Export geht nicht');

  const screenshotUrl = `/app-feedback/${row!.id}/screenshot`;
  expect((await app.request(screenshotUrl)).status).toBe(401);
  expect((await app.request(screenshotUrl, { headers: { cookie: tester.cookie } })).status).toBe(403);

  const admin = await logIn(ADMIN);
  const shot = await app.request(screenshotUrl, { headers: { cookie: admin.cookie } });
  expect(shot.status).toBe(200);
  expect(shot.headers.get('content-type')).toBe('image/png');
  expect(shot.headers.get('cache-control')).toBe('no-store');
  expect(Buffer.from(await shot.arrayBuffer()).toString('base64')).toBe(PNG);
  expect((await app.request(`/app-feedback/${crypto.randomUUID()}/screenshot`, { headers: { cookie: admin.cookie } })).status).toBe(404);
  expect((await app.request('/app-feedback/nope/screenshot', { headers: { cookie: admin.cookie } })).status).toBe(404);
});

test('without GitHub and mail the feedback is still stored', async () => {
  const tester = await logIn();
  expect((await send(tester.cookie, { kind: 'idea', message: 'Dunkler Modus wäre schön', context })).status).toBe(200);
  expect(await reports(tester.id)).toMatchObject([{ kind: 'idea', screenshot: null, issueUrl: null }]);
});

test('a failing GitHub keeps the report and still mails it', async () => {
  const tester = await logIn();
  process.env.FEEDBACK_EMAIL = 'robin@example.com';
  process.env.FEEDBACK_GITHUB_TOKEN = 'token';
  process.env.GITHUB_REPOSITORY = 'robinchoice/musichub';
  const github = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('down', { status: 503 }));
  const error = spyOn(console, 'error').mockImplementation(() => {});

  expect((await send(tester.cookie, { kind: 'bug', message: 'Knopf fehlt', context })).status).toBe(200);
  github.mockRestore();
  error.mockRestore();
  expect(lastMail()).toStartWith('[DEV] App feedback mail to robin@example.com: Bug from Lena: Knopf fehlt');
  expect(await reports(tester.id)).toHaveLength(1);
});

test('link tokens in the page and the recent errors stay out, ids of projects stay in', async () => {
  const tester = await logIn();
  const token = 'a1b2c3d4'.repeat(8);
  const project = crypto.randomUUID();
  const page = `/projects/${project}/share/${token}`;
  expect((await send(tester.cookie, { kind: 'bug', message: 'Link geht nicht', context: { ...context, page, errors: [`GET /api/v1/share/${token} → 404`] } })).status).toBe(200);
  const [row] = await reports(tester.id);
  expect(row!.context).toMatchObject({ page: `/projects/${project}/share/…`, errors: ['GET /api/v1/share/… → 404'] });
});

test('short messages and other files are refused', async () => {
  const tester = await logIn();
  expect((await send(tester.cookie, { kind: 'bug', message: 'ab', context })).status).toBe(400);
  const html = Buffer.from('<html>').toString('base64');
  const file = await send(tester.cookie, { kind: 'bug', message: 'Mit Anhang', screenshot: html, context });
  expect(file.status).toBe(400);
  expect(await file.json()).toEqual({ error: 'Der Screenshot muss ein PNG oder JPEG sein.' });
  expect(await reports(tester.id)).toHaveLength(0);
});
