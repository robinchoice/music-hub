import { runInBackground } from '../lib/background.js';
import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc, desc, inArray, isNull, ne, or } from 'drizzle-orm';
import { createShareLinkSchema, guestCommentSchema, guestReviewSchema, updateListenEventSchema } from '@music-hub/shared';
import {
  shareLinks,
  listenEvents,
  versions,
  tracks,
  projects,
  comments,
  users,
  projectMembers,
  reviews,
  type Database,
} from '@music-hub/db';
import { requireAuth, generateToken } from '../middleware/auth.js';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { createDownloadUrl } from '../storage/s3.js';
import { sendListenAlertEmail } from '../services/email.js';
import { liveVersion } from '../lib/trash.js';
import { mayDownload, membershipOf, versionAccess } from '../lib/access.js';
import { replyTarget } from './comments.js';
import { notBlocked } from '../lib/users.js';
import { submitReview } from '../lib/reviews.js';
import { publish } from '../services/sse.js';

// Links pause while their version is in the trash or their creator is no longer a member of the project
const UNAVAILABLE = 'Dieser Link ist gerade nicht verfügbar.';
// A link that follows the track moved on to a newer version while the guest was listening
const MOVED_ON = 'Inzwischen gibt es eine neuere Version. Lade die Seite neu, um sie zu hören.';

// The version a link shows: its own, or the newest playable (or approved) one of its track.
// null when there is none, e.g. no version approved yet. A link that follows the track
// does not pause with the version it was made on, only with the track.
async function shownVersionId(db: Database, link: { versionId: string; follows: string }) {
  if (link.follows === 'version') return link.versionId;
  const [origin] = await db.select({ trackId: versions.trackId }).from(versions).where(eq(versions.id, link.versionId));
  if (!origin) return null;
  const [newest] = await db
    .select({ id: versions.id })
    .from(versions)
    .where(
      and(
        eq(versions.trackId, origin.trackId),
        isNull(versions.deletedAt),
        link.follows === 'approved' ? eq(versions.status, 'approved') : inArray(versions.status, ['ready', 'approved', 'rejected']),
      ),
    )
    .orderBy(desc(versions.versionNumber))
    .limit(1);
  return newest?.id ?? null;
}

// Whether a guest's comment or "Fertig" is about the version shown now. A link that follows the track
// needs the version the guest heard; older pages don't send it and could otherwise land on a newer one.
function matchesShown(link: { follows: string }, heard: string | undefined, shown: string) {
  return heard ? heard === shown : link.follows === 'version';
}

// The version the link shows with its track and its creator's membership, null while the link pauses.
// A link never does more than its creator may right now: comments and downloads follow that membership.
async function liveTarget(db: Database, link: { versionId: string; follows: string; createdById: string }) {
  const versionId = await shownVersionId(db, link);
  if (!versionId) return null;
  const found = await liveVersion(db, versionId);
  if (!found) return null;
  const membership = await membershipOf(db, found.track.projectId, link.createdById);
  return membership ? { ...found, membership } : null;
}

const MINUTE = 60 * 1000;
// Wrong passwords per share link, counted like failed logins
const failedPasswords = rateLimit('failed-share-passwords', 10, 15 * MINUTE);
const listensPerIp = rateLimit('listens-per-ip', 30, 60 * MINUTE);
// Progress updates while listening, every 30 seconds per guest; a studio shares one address
const listenUpdatesPerIp = rateLimit('listen-updates-per-ip', 3000, 60 * MINUTE);
// Listen alert emails per share link
const listenAlerts = rateLimit('listen-alerts', 1, 60 * MINUTE);
// Each guest review pushes to the uploader, so a link can't send many of them
const guestReviews = rateLimit('guest-reviews', 10, 60 * MINUTE);

// Salted with a server secret, so the hashes of IPv4 addresses can't be listed
const IP_SALT = process.env.MAGIC_LINK_SECRET || 'musichub-salt';
async function hashIp(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + IP_SALT));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
import type { AppEnv } from '../types.js';

async function commentableLink(c: Context<AppEnv>, token: string) {
  const db = c.get('db');
  const password = c.req.header('x-share-password');

  const [link] = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.token, token), notBlocked(shareLinks.createdById)))
    .limit(1);
  if (!link) return c.json({ error: 'Not found' }, 404);
  if (link.expiresAt && link.expiresAt < new Date()) {
    return c.json({ error: 'Expired' }, 410);
  }
  if (!link.allowComments) return c.json({ error: 'Comments disabled' }, 403);
  if (link.passwordHash) {
    if (!password) return c.json({ error: 'Password required' }, 401);
    if (!(await failedPasswords.hit(db, link.id))) return tooManyRequests(c);
    if (!(await Bun.password.verify(password, link.passwordHash))) {
      return c.json({ error: 'Password required' }, 401);
    }
    await failedPasswords.undo(db, link.id);
  }
  return link;
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

      const found = await versionAccess(db, versionId, userId);
      if (!found) return c.json({ error: 'Not found' }, 404);
      const { track, membership } = found;
      if (!membership) return c.json({ error: 'Forbidden' }, 403);

      const token = generateToken();
      const passwordHash = input.password
        ? await Bun.password.hash(input.password)
        : null;

      // The link grants at most what its creator may: no guest comments without the right to
      // comment, no download without the right to download
      const [link] = await db
        .insert(shareLinks)
        .values({
          versionId,
          token,
          createdById: userId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          allowComments: (input.allowComments ?? true) && membership.canComment,
          allowDownload: (input.allowDownload ?? false) && mayDownload(membership),
          passwordHash,
          follows: input.follows ?? 'version',
        })
        .returning();

      return c.json({ link: { ...link, passwordHash: undefined } }, 201);
    },
  )

  .get('/version/:versionId', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('versionId');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track, membership } = found;
    if (!membership) return c.json({ error: 'Forbidden' }, 403);

    const links = await db
      .select({
        id: shareLinks.id,
        token: shareLinks.token,
        expiresAt: shareLinks.expiresAt,
        allowComments: shareLinks.allowComments,
        allowDownload: shareLinks.allowDownload,
        hasPassword: shareLinks.passwordHash,
        follows: shareLinks.follows,
        createdAt: shareLinks.createdAt,
      })
      .from(shareLinks)
      .where(
        or(
          eq(shareLinks.versionId, versionId),
          // Links that follow the track show up at every version of it
          and(
            ne(shareLinks.follows, 'version'),
            inArray(shareLinks.versionId, db.select({ id: versions.id }).from(versions).where(eq(versions.trackId, track!.id))),
          ),
        ),
      )
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

    if (link.createdById !== userId) {
      const [owner] = await db
        .select({ id: projectMembers.id })
        .from(versions)
        .innerJoin(tracks, eq(tracks.id, versions.trackId))
        .innerJoin(projectMembers, eq(projectMembers.projectId, tracks.projectId))
        .where(
          and(
            eq(versions.id, link.versionId),
            eq(projectMembers.userId, userId),
            eq(projectMembers.role, 'owner'),
          ),
        )
        .limit(1);
      if (!owner) return c.json({ error: 'Forbidden' }, 403);
    }

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
      .where(and(eq(shareLinks.token, token), notBlocked(shareLinks.createdById)))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);
    if (link.expiresAt && link.expiresAt < new Date()) {
      return c.json({ error: 'Expired' }, 410);
    }
    if (link.passwordHash) {
      if (!password) return c.json({ error: 'Password required', passwordRequired: true }, 401);
      if (!(await failedPasswords.hit(db, link.id))) return tooManyRequests(c);
      if (!(await Bun.password.verify(password, link.passwordHash))) {
        return c.json({ error: 'Password required', passwordRequired: true }, 401);
      }
      await failedPasswords.undo(db, link.id);
    }

    const found = await liveTarget(db, link);
    if (!found) return c.json({ error: UNAVAILABLE }, 410);
    const { version, track, membership } = found;
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, track!.projectId))
      .limit(1);

    if (c.req.query('meta') === '1') {
      return c.json({ project: { name: project!.name }, track: { name: track!.name } });
    }

    const streamKey = version.streamFileKey || version.originalFileKey;
    const streamUrl = await createDownloadUrl(streamKey);
    const waveformUrl = version.waveformDataKey
      ? await createDownloadUrl(version.waveformDataKey)
      : null;
    const downloadUrl = link.allowDownload && mayDownload(membership)
      ? await createDownloadUrl(version.originalFileKey)
      : null;
    // A link for listening only shows no comments either, they belong to the people in the project
    const allowComments = link.allowComments && membership.canComment;

    const versionComments = allowComments ? await db
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
      .where(and(eq(comments.versionId, version.id), isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt)) : [];

    // Guests finish their pass by name; the page counts their comments since their last review
    const guestReviewRows = allowComments ? await db
      .select({ guestName: reviews.guestName, createdAt: reviews.createdAt })
      .from(reviews)
      .where(and(eq(reviews.versionId, version.id), isNull(reviews.userId)))
      .orderBy(asc(reviews.createdAt)) : [];
    const [uploader] = await db.select({ name: users.name }).from(users).where(eq(users.id, version.createdById));

    return c.json({
      project: { name: project!.name },
      track: { id: track!.id, name: track!.name },
      version: {
        id: version.id,
        versionNumber: version.versionNumber,
        label: version.label,
        notes: version.notes,
        duration: version.duration,
        status: version.status,
        originalFileName: version.originalFileName,
      },
      streamUrl,
      waveformUrl,
      downloadUrl,
      allowComments,
      comments: versionComments,
      reviews: guestReviewRows,
      uploaderName: uploader?.name ?? null,
    });
  })

  .post('/public/:token/comments', zValidator('json', guestCommentSchema), async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');
    const input = c.req.valid('json');

    const link = await commentableLink(c, token);
    if (link instanceof Response) return link;

    // A link that follows the track comments on the version it shows right now
    const found = await liveTarget(db, link);
    if (!found) return c.json({ error: UNAVAILABLE }, 410);
    if (!found.membership.canComment) return c.json({ error: 'Comments disabled' }, 403);
    const versionId = found.version.id;
    if (!matchesShown(link, input.versionId, versionId)) return c.json({ error: MOVED_ON }, 409);

    if (input.parentId) {
      const parent = await replyTarget(db, input.parentId, versionId);
      if (parent instanceof Response) return parent;
    }
    if (!(await guestReviews.hit(db, link.id))) return tooManyRequests(c);

    const [comment] = await db
      .insert(comments)
      .values({
        versionId,
        userId: null,
        guestName: input.guestName,
        body: input.body,
        timestampSeconds: input.timestampSeconds,
        parentId: input.parentId,
      })
      .returning();

    publish(db, found.track.id, { type: 'comment:new', data: { versionId, commentId: comment.id } });
    return c.json({ comment }, 201);
  })

  // A guest's "Fertig": their verdict on the version goes to the uploader
  .post('/public/:token/review', zValidator('json', guestReviewSchema), async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');
    const input = c.req.valid('json');

    const link = await commentableLink(c, token);
    if (link instanceof Response) return link;
    if (!(await guestReviews.hit(db, link.id))) return tooManyRequests(c);

    const found = await liveTarget(db, link);
    if (!found) return c.json({ error: UNAVAILABLE }, 410);
    if (!found.membership.canComment) return c.json({ error: 'Comments disabled' }, 403);
    if (!matchesShown(link, input.versionId, found.version.id)) return c.json({ error: MOVED_ON }, 409);

    await submitReview(db, {
      version: found.version,
      track: found.track!,
      author: { guestName: input.guestName },
      authorName: input.guestName,
      verdict: input.verdict,
      note: input.note,
      canApprove: false,
    });
    return c.json({ ok: true }, 201);
  })

  // --- Listen tracking (public, no auth) ---
  .post('/public/:token/listen', async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');

    const [link] = await db
      .select({ id: shareLinks.id, expiresAt: shareLinks.expiresAt })
      .from(shareLinks)
      .where(and(eq(shareLinks.token, token), notBlocked(shareLinks.createdById)))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);
    if (link.expiresAt && link.expiresAt < new Date()) return c.json({ error: 'Expired' }, 410);

    const ip = clientIp(c);
    if (!(await listensPerIp.hit(db, ip))) return tooManyRequests(c);
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
      .select({ id: shareLinks.id, expiresAt: shareLinks.expiresAt })
      .from(shareLinks)
      .where(and(eq(shareLinks.token, token), notBlocked(shareLinks.createdById)))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);
    if (link.expiresAt && link.expiresAt < new Date()) return c.json({ error: 'Expired' }, 410);
    if (!(await listenUpdatesPerIp.hit(db, clientIp(c)))) return tooManyRequests(c);

    const [event] = await db
      .select()
      .from(listenEvents)
      .where(and(eq(listenEvents.id, eventId), eq(listenEvents.shareLinkId, link.id)))
      .limit(1);
    if (!event) return c.json({ error: 'Not found' }, 404);

    const isFirstPlay = input.firstPlay && !event.firstPlayAt;

    await db
      .update(listenEvents)
      .set({
        ...(input.listenerName !== undefined ? { listenerName: input.listenerName } : {}),
        ...(isFirstPlay ? { firstPlayAt: new Date() } : {}),
        ...(input.listenSeconds !== undefined ? { listenSeconds: input.listenSeconds } : {}),
        ...(input.completed !== undefined ? { completed: input.completed } : {}),
      })
      .where(eq(listenEvents.id, eventId));

    if (isFirstPlay && (await listenAlerts.hit(db, link.id))) {
      // Fire-and-forget: alert link creator by email
      runInBackground(Promise.resolve().then(async () => {
        try {
          const [fullLink] = await db
            .select({ createdById: shareLinks.createdById, versionId: shareLinks.versionId })
            .from(shareLinks)
            .where(eq(shareLinks.id, link.id))
            .limit(1);
          if (!fullLink) return;

          const [creator] = await db
            .select({ email: users.email, name: users.name })
            .from(users)
            .where(eq(users.id, fullLink.createdById))
            .limit(1);
          if (!creator) return;

          const [version] = await db.select().from(versions).where(eq(versions.id, fullLink.versionId)).limit(1);
          const [track] = version ? await db.select().from(tracks).where(eq(tracks.id, version.trackId)).limit(1) : [null];
          const [project] = track ? await db.select().from(projects).where(eq(projects.id, track.projectId)).limit(1) : [null];
          if (!track || !project) return;

          const listenerName = input.listenerName ?? event.listenerName;
          const trackUrl = `${process.env.APP_URL}/projects/${track.projectId}/tracks/${track.id}`;
          await sendListenAlertEmail(creator.email, listenerName ?? null, track.name, project.name, trackUrl);
        } catch { /* non-critical */ }
      }));
    }

    return c.json({ ok: true });
  })

  // --- Analytics (authenticated) ---
  .get('/version/:versionId/analytics', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('versionId');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track, membership } = found;
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
