import { runInBackground } from '../lib/background.js';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray } from 'drizzle-orm';
import { acceptRequestSchema, blockRequestSchema } from '@music-hub/shared';
import { projectMembers, projects, tracks, users } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { ADMIN_EMAILS } from '../lib/admin.js';
import { acceptRequest, declineRequest, pendingRequests } from '../lib/profiles.js';
import { notifyUser } from '../services/push.js';
import { sendInviteEmail, sendRequestReportEmail } from '../services/email.js';
import type { AppEnv } from '../types.js';
import { pickLocale } from '@music-hub/shared';

// Contact requests sent to you through your profile
export const requestRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const db = c.get('db');
    const rows = await pendingRequests(db, c.get('userId'));
    const ids = rows.map((r) => r.trackId).filter((id): id is string => !!id);
    const names = ids.length
      ? new Map((await db.select({ id: tracks.id, name: tracks.name }).from(tracks).where(inArray(tracks.id, ids))).map((t) => [t.id, t.name]))
      : new Map<string, string>();
    // Projects of yours the sender is already in, so "In Projekt einladen" leaves them out
    const senders = [...new Set(rows.map((r) => r.from.id))];
    const shared = senders.length
      ? await db
          .select({ userId: projectMembers.userId, projectId: projectMembers.projectId })
          .from(projectMembers)
          .where(
            and(
              inArray(projectMembers.userId, senders),
              inArray(
                projectMembers.projectId,
                db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, c.get('userId'))),
              ),
            ),
          )
      : [];
    return c.json({
      requests: rows.map(({ trackId, ...r }) => ({
        ...r,
        track: trackId && names.has(trackId) ? { id: trackId, name: names.get(trackId)! } : null,
        sharedProjectIds: shared.filter((m) => m.userId === r.from.id).map((m) => m.projectId),
      })),
    });
  })

  .post('/:id/accept', zValidator('json', acceptRequestSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const result = await acceptRequest(db, c.req.param('id'), userId, c.req.valid('json').projectId);
    if (!result) return c.json({ error: 'Forbidden' }, 403);

    const [[project], [me], [sender]] = await Promise.all([
      db.select({ name: projects.name }).from(projects).where(eq(projects.id, result.projectId)),
      db.select({ name: users.name }).from(users).where(eq(users.id, userId)),
      db.select({ email: users.email, locale: users.locale }).from(users).where(eq(users.id, result.fromUserId)),
    ]);
    runInBackground(notifyUser(db, result.fromUserId, (m) => ({
      projectId: result.projectId,
      title: m.push.requestAccepted(me.name),
      body: m.push.requestAcceptedBody(project.name),
      url: `/projects/${result.projectId}`,
    })).catch((err) => console.error('[Push] Accepted request failed:', err.message)));
    runInBackground(sendInviteEmail(sender.email, result.projectId, project.name, me.name, null, pickLocale(sender.locale)).catch((err) =>
      console.error('[Email] Accepted request failed:', err.message),
    ));
    return c.json({ projectId: result.projectId });
  })

  .post('/:id/decline', async (c) => {
    const request = await declineRequest(c.get('db'), c.req.param('id'), c.get('userId'));
    if (!request) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  })

  .post('/:id/block', zValidator('json', blockRequestSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { report } = c.req.valid('json');
    const request = await declineRequest(db, c.req.param('id'), userId, true, report);
    if (!request) return c.json({ error: 'Not found' }, 404);

    if (report) {
      const [[sender], [me]] = await Promise.all([
        db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, request.fromUserId)),
        db.select({ name: users.name }).from(users).where(eq(users.id, userId)),
      ]);
      runInBackground(sendRequestReportEmail([...ADMIN_EMAILS], sender.name, sender.email, me.name, request.message).catch((err) =>
        console.error('[Email] Request report failed:', err.message),
      ));
    }
    return c.json({ ok: true });
  });
