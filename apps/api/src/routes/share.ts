import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc, desc, inArray } from 'drizzle-orm';
import { createShareLinkSchema, guestCommentSchema, updateListenEventSchema } from '@music-hub/shared';
import {
  shareLinks,
  listenEvents,
  versions,
  tracks,
  projects,
  comments,
  users,
  projectMembers,
} from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createDownloadUrl } from '../storage/s3.js';

async function hashIp(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + 'musichub-salt'));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
import type { AppEnv } from '../types.js';

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const shareRoutes = new Hono<AppEnv>()
  // --- Authenticated: create / list / revoke ---
  .post(
    '/version/:versionId',
    requireAuth,
    zValidator('json', createShareLinkSchema),
    async (c) => {
      const db = c.get('db');
      const userId = c.get('userId');
      const versionId = c.req.param('versionId');
      const input = c.req.valid('json');

      const [version] = await db
        .select()
        .from(versions)
        .where(eq(versions.id, versionId))
        .limit(1);
      if (!version) return c.json({ error: 'Not found' }, 404);

      const [track] = await db
        .select()
        .from(tracks)
        .where(eq(tracks.id, version.trackId))
        .limit(1);

      const [membership] = await db
        .select()
        .from(projectMembers)
        .where(
          and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)),
        )
        .limit(1);
      if (!membership) return c.json({ error: 'Forbidden' }, 403);

      const token = generateToken();
      const passwordHash = input.password
        ? await Bun.password.hash(input.password)
        : null;

      const [link] = await db
        .insert(shareLinks)
        .values({
          versionId,
          token,
          createdById: userId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          allowComments: input.allowComments ?? true,
          allowDownload: input.allowDownload ?? false,
          passwordHash,
        })
        .returning();

      return c.json({ link: { ...link, passwordHash: undefined } }, 201);
    },
  )

  .get('/version/:versionId', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('versionId');

    const [version] = await db
      .select()
      .from(versions)
      .where(eq(versions.id, versionId))
      .limit(1);
    if (!version) return c.json({ error: 'Not found' }, 404);

    const [track] = await db
      .select()
      .from(tracks)
      .where(eq(tracks.id, version.trackId))
      .limit(1);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)),
      )
      .limit(1);
    if (!membership) return c.json({ error: 'Forbidden' }, 403);

    const links = await db
      .select({
        id: shareLinks.id,
        token: shareLinks.token,
        expiresAt: shareLinks.expiresAt,
        allowComments: shareLinks.allowComments,
        allowDownload: shareLinks.allowDownload,
        hasPassword: shareLinks.passwordHash,
        createdAt: shareLinks.createdAt,
      })
      .from(shareLinks)
      .where(eq(shareLinks.versionId, versionId))
      .orderBy(asc(shareLinks.createdAt));

    return c.json({
      links: links.map((l) => ({ ...l, hasPassword: l.hasPassword !== null })),
    });
  })

  .delete('/:linkId', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const linkId = c.req.param('linkId');

    const [link] = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.id, linkId))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);
    if (link.createdById !== userId) return c.json({ error: 'Forbidden' }, 403);

    await db.delete(shareLinks).where(eq(shareLinks.id, linkId));
    return c.json({ message: 'Revoked' });
  })

  // --- Public: resolve token, fetch, comment ---
  .get('/public/:token', async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');
    const password = c.req.header('x-share-password');

    const [link] = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.token, token))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);
    if (link.expiresAt && link.expiresAt < new Date()) {
      return c.json({ error: 'Expired' }, 410);
    }
    if (link.passwordHash) {
      if (!password || !(await Bun.password.verify(password, link.passwordHash))) {
        return c.json({ error: 'Password required', passwordRequired: true }, 401);
      }
    }

    const [version] = await db
      .select()
      .from(versions)
      .where(eq(versions.id, link.versionId))
      .limit(1);
    if (!version) return c.json({ error: 'Not found' }, 404);

    const [track] = await db
      .select()
      .from(tracks)
      .where(eq(tracks.id, version.trackId))
      .limit(1);
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, track!.projectId))
      .limit(1);

    const streamKey = version.streamFileKey || version.originalFileKey;
    const streamUrl = await createDownloadUrl(streamKey);
    const waveformUrl = version.waveformDataKey
      ? await createDownloadUrl(version.waveformDataKey)
      : null;
    const downloadUrl = link.allowDownload
      ? await createDownloadUrl(version.originalFileKey)
      : null;

    const versionComments = await db
      .select({
        id: comments.id,
        body: comments.body,
        timestampSeconds: comments.timestampSeconds,
        parentId: comments.parentId,
        resolvedAt: comments.resolvedAt,
        createdAt: comments.createdAt,
        guestName: comments.guestName,
        user: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.versionId, version.id))
      .orderBy(asc(comments.createdAt));

    return c.json({
      project: { name: project!.name },
      track: { id: track!.id, name: track!.name },
      version: {
        id: version.id,
        label: version.label,
        notes: version.notes,
        duration: version.duration,
        status: version.status,
        originalFileName: version.originalFileName,
      },
      streamUrl,
      waveformUrl,
      downloadUrl,
      allowComments: link.allowComments,
      comments: versionComments,
    });
  })

  .post('/public/:token/comments', zValidator('json', guestCommentSchema), async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');
    const password = c.req.header('x-share-password');
    const input = c.req.valid('json');

    const [link] = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.token, token))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);
    if (link.expiresAt && link.expiresAt < new Date()) {
      return c.json({ error: 'Expired' }, 410);
    }
    if (!link.allowComments) return c.json({ error: 'Comments disabled' }, 403);
    if (link.passwordHash) {
      if (!password || !(await Bun.password.verify(password, link.passwordHash))) {
        return c.json({ error: 'Password required' }, 401);
      }
    }

    const [comment] = await db
      .insert(comments)
      .values({
        versionId: link.versionId,
        userId: null,
        guestName: input.guestName,
        body: input.body,
        timestampSeconds: input.timestampSeconds,
        parentId: input.parentId,
      })
      .returning();

    return c.json({ comment }, 201);
  })

  // --- Listen tracking (public, no auth) ---
  .post('/public/:token/listen', async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');

    const [link] = await db
      .select({ id: shareLinks.id, expiresAt: shareLinks.expiresAt })
      .from(shareLinks)
      .where(eq(shareLinks.token, token))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);
    if (link.expiresAt && link.expiresAt < new Date()) return c.json({ error: 'Expired' }, 410);

    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('cf-connecting-ip') ?? 'unknown';
    const ipHash = await hashIp(ip);
    const userAgent = (c.req.header('user-agent') ?? '').slice(0, 500);

    const [event] = await db
      .insert(listenEvents)
      .values({ shareLinkId: link.id, ipHash, userAgent })
      .returning({ id: listenEvents.id });

    return c.json({ eventId: event.id }, 201);
  })

  .patch('/public/:token/listen/:eventId', zValidator('json', updateListenEventSchema), async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');
    const eventId = c.req.param('eventId');
    const input = c.req.valid('json');

    const [link] = await db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(eq(shareLinks.token, token))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);

    const [event] = await db
      .select()
      .from(listenEvents)
      .where(and(eq(listenEvents.id, eventId), eq(listenEvents.shareLinkId, link.id)))
      .limit(1);
    if (!event) return c.json({ error: 'Not found' }, 404);

    await db
      .update(listenEvents)
      .set({
        ...(input.listenerName !== undefined ? { listenerName: input.listenerName } : {}),
        ...(input.firstPlay && !event.firstPlayAt ? { firstPlayAt: new Date() } : {}),
        ...(input.listenSeconds !== undefined ? { listenSeconds: input.listenSeconds } : {}),
        ...(input.completed !== undefined ? { completed: input.completed } : {}),
      })
      .where(eq(listenEvents.id, eventId));

    return c.json({ ok: true });
  })

  // --- Analytics (authenticated) ---
  .get('/version/:versionId/analytics', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('versionId');

    const [version] = await db.select().from(versions).where(eq(versions.id, versionId)).limit(1);
    if (!version) return c.json({ error: 'Not found' }, 404);

    const [track] = await db.select().from(tracks).where(eq(tracks.id, version.trackId)).limit(1);
    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Forbidden' }, 403);

    const links = await db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(eq(shareLinks.versionId, versionId));

    if (links.length === 0) return c.json({ totalOpens: 0, totalPlays: 0, uniqueListeners: 0, avgListenSeconds: 0, completionRate: 0, events: [] });

    const linkIds = links.map((l) => l.id);

    const events = await db
      .select()
      .from(listenEvents)
      .where(inArray(listenEvents.shareLinkId, linkIds))
      .orderBy(desc(listenEvents.openedAt));

    const totalOpens = events.length;
    const played = events.filter((e) => e.firstPlayAt !== null);
    const totalPlays = played.length;
    const uniqueListeners = new Set(events.map((e) => e.ipHash)).size;
    const avgListenSeconds = played.length > 0
      ? Math.round(played.reduce((s, e) => s + e.listenSeconds, 0) / played.length)
      : 0;
    const completionRate = totalPlays > 0
      ? Math.round((events.filter((e) => e.completed).length / totalPlays) * 100)
      : 0;

    return c.json({
      totalOpens,
      totalPlays,
      uniqueListeners,
      avgListenSeconds,
      completionRate,
      events: events.map((e) => ({
        id: e.id,
        listenerName: e.listenerName,
        openedAt: e.openedAt,
        firstPlayAt: e.firstPlayAt,
        listenSeconds: e.listenSeconds,
        completed: e.completed,
      })),
    });
  });
