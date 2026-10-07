import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { taskKeySchema, MAX_STORAGE_PER_USER } from '@music-hub/shared';
import {
  projects,
  projectMembers,
  tracks,
  versions,
  comments,
  shareLinks,
  listenEvents,
  users,
  taskDismissals,
  type Database,
} from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createDownloadUrl } from '../storage/s3.js';
import { keptSql } from '../lib/trash.js';
import type { AppEnv } from '../types.js';

// Same prefix the reject route writes; those comments are delivered as rejectionReason instead.
const REJECTION_PREFIX = '❌ Abgelehnt: ';
// Open comments are always included, others only from the longest timeline range (13 weeks).
const COMMENT_WINDOW_DAYS = 91;
const LISTEN_WINDOW_DAYS = 90;
const BODY_LIMIT = 200;
const DAY_MS = 86_400_000;

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

// Storage of the user's own uploads, counted like storageOf() in lib/storage.ts.
// The biggest tracks leave out what is in the trash, the totals include it.
async function storageSummary(db: Database, userId: string) {
  const [{ versionBytes, stemBytes, limitBytes }] = await db.execute<{ versionBytes: number; stemBytes: number; limitBytes: number }>(sql`
    SELECT
      (SELECT coalesce(sum(v.file_size), 0)::float8 FROM versions v JOIN tracks t ON t.id = v.track_id
        WHERE v.created_by_id = ${userId} AND ${keptSql('v')} AND ${keptSql('t')}) AS "versionBytes",
      (SELECT coalesce(sum(s.file_size), 0)::float8 FROM stems s JOIN tracks t ON t.id = s.track_id
        WHERE s.created_by_id = ${userId} AND ${keptSql('s')} AND ${keptSql('t')}) AS "stemBytes",
      (SELECT coalesce(storage_limit, ${MAX_STORAGE_PER_USER})::float8 FROM users WHERE id = ${userId}) AS "limitBytes"
  `);
  const topTracks = await db.execute<{ trackId: string; name: string; bytes: number }>(sql`
    SELECT t.id AS "trackId", t.name AS "name", sum(x.size)::float8 AS "bytes"
    FROM (
      SELECT track_id, file_size AS size FROM versions WHERE created_by_id = ${userId} AND deleted_at IS NULL
      UNION ALL
      SELECT track_id, file_size AS size FROM stems WHERE created_by_id = ${userId} AND deleted_at IS NULL
    ) x
    JOIN tracks t ON t.id = x.track_id
    WHERE t.deleted_at IS NULL
    GROUP BY t.id, t.name
    ORDER BY 3 DESC
    LIMIT 3
  `);
  return {
    usedBytes: Number(versionBytes) + Number(stemBytes),
    versionBytes: Number(versionBytes),
    stemBytes: Number(stemBytes),
    limitBytes: Number(limitBytes),
    topTracks: [...topTracks].map((t) => ({ trackId: t.trackId, name: t.name, bytes: Number(t.bytes) })),
  };
}

export const overviewRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Everything the overview pages need, for all projects of the user that are not archived
  .get('/', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const [me] = await db.select({ tracksSeenAt: users.tracksSeenAt }).from(users).where(eq(users.id, userId)).limit(1);
    const dismissed = await db
      .select({ taskKey: taskDismissals.taskKey })
      .from(taskDismissals)
      .where(eq(taskDismissals.userId, userId));
    const personal = {
      storage: await storageSummary(db, userId),
      dismissedTaskKeys: dismissed.map((d) => d.taskKey),
      tracksSeenAt: iso(me?.tracksSeenAt),
    };

    const memberships = await db
      .select({ project: projects, role: projectMembers.role })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.userId, userId), eq(projects.isArchived, false)));
    const projectIds = memberships.map((m) => m.project.id);
    if (projectIds.length === 0) {
      return c.json({ projects: [], users: [], tracks: [], versions: [], comments: [], listens: [], ...personal });
    }

    const members = await db
      .select({ projectId: projectMembers.projectId, userId: projectMembers.userId, role: projectMembers.role })
      .from(projectMembers)
      .where(inArray(projectMembers.projectId, projectIds));

    const trackRows = await db
      .select({
        id: tracks.id,
        projectId: tracks.projectId,
        name: tracks.name,
        status: tracks.status,
        coverImageUrl: tracks.coverImageUrl,
        createdAt: tracks.createdAt,
        createdById: tracks.createdById,
      })
      .from(tracks)
      .where(and(inArray(tracks.projectId, projectIds), isNull(tracks.deletedAt)));
    const trackIds = trackRows.map((t) => t.id);

    const versionRows = trackIds.length
      ? await db
          .select({
            id: versions.id,
            trackId: versions.trackId,
            versionNumber: versions.versionNumber,
            label: versions.label,
            branchLabel: versions.branchLabel,
            parentVersionId: versions.parentVersionId,
            status: versions.status,
            createdById: versions.createdById,
            createdAt: versions.createdAt,
            duration: versions.duration,
            integratedLufs: versions.integratedLufs,
            decidedById: versions.decidedById,
            decidedAt: versions.decidedAt,
          })
          .from(versions)
          .where(and(inArray(versions.trackId, trackIds), isNull(versions.deletedAt)))
      : [];
    const versionIds = versionRows.map((v) => v.id);

    const cutoff = new Date(Date.now() - COMMENT_WINDOW_DAYS * DAY_MS);
    const commentRows = versionIds.length
      ? await db
          .select({
            id: comments.id,
            versionId: comments.versionId,
            parentId: comments.parentId,
            userId: comments.userId,
            guestName: comments.guestName,
            timestampSeconds: comments.timestampSeconds,
            resolvedAt: comments.resolvedAt,
            createdAt: comments.createdAt,
            body: comments.body,
          })
          .from(comments)
          .where(
            and(
              inArray(comments.versionId, versionIds),
              isNull(comments.deletedAt),
              or(isNull(comments.resolvedAt), gte(comments.createdAt, cutoff)),
            ),
          )
      : [];

    // The newest rejection comment of each version, regardless of age
    const rejectionRows = versionIds.length
      ? await db
          .select({ versionId: comments.versionId, body: comments.body })
          .from(comments)
          .where(
            and(
              inArray(comments.versionId, versionIds),
              isNull(comments.parentId),
              isNull(comments.deletedAt),
              sql`${comments.body} LIKE ${REJECTION_PREFIX + '%'}`,
            ),
          )
          .orderBy(desc(comments.createdAt))
      : [];
    const rejectionReason = new Map<string, string>();
    for (const r of rejectionRows) {
      if (!rejectionReason.has(r.versionId)) rejectionReason.set(r.versionId, r.body.slice(REJECTION_PREFIX.length));
    }

    const isRejection = (row: { parentId: string | null; body: string }) =>
      !row.parentId && row.body.startsWith(REJECTION_PREFIX);
    const topLevelIds = new Set(commentRows.filter((r) => !r.parentId && !isRejection(r)).map((r) => r.id));
    const commentsOut = commentRows
      .filter((r) => !isRejection(r) && (!r.parentId || topLevelIds.has(r.parentId)))
      .map((r) => ({
        ...r,
        body: r.body.length > BODY_LIMIT ? `${r.body.slice(0, BODY_LIMIT - 1)}…` : r.body,
        resolvedAt: iso(r.resolvedAt),
        createdAt: iso(r.createdAt)!,
      }));

    const now = new Date();
    const links = versionIds.length
      ? await db
          .select({ id: shareLinks.id, versionId: shareLinks.versionId, expiresAt: shareLinks.expiresAt })
          .from(shareLinks)
          .where(inArray(shareLinks.versionId, versionIds))
      : [];
    const activeLink = new Set(links.filter((l) => !l.expiresAt || l.expiresAt > now).map((l) => l.versionId));

    const listenRows = links.length
      ? await db
          .select({
            versionId: shareLinks.versionId,
            listenerName: listenEvents.listenerName,
            plays: sql<number>`count(*)::int`,
            fullPlays: sql<number>`count(*) filter (where ${listenEvents.completed})::int`,
            maxSeconds: sql<number>`max(${listenEvents.listenSeconds})::int`,
            lastAt: sql<string>`max(${listenEvents.openedAt})`,
          })
          .from(listenEvents)
          .innerJoin(shareLinks, eq(shareLinks.id, listenEvents.shareLinkId))
          .where(
            and(
              inArray(shareLinks.versionId, versionIds),
              isNotNull(listenEvents.firstPlayAt),
              gte(listenEvents.openedAt, new Date(Date.now() - LISTEN_WINDOW_DAYS * DAY_MS)),
            ),
          )
          .groupBy(shareLinks.versionId, listenEvents.listenerName)
      : [];

    const userIds = new Set<string>();
    for (const m of members) userIds.add(m.userId);
    for (const t of trackRows) userIds.add(t.createdById);
    for (const v of versionRows) {
      userIds.add(v.createdById);
      if (v.decidedById) userIds.add(v.decidedById);
    }
    for (const r of commentsOut) if (r.userId) userIds.add(r.userId);
    const userRows = await db
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, [...userIds]));

    return c.json({
      projects: await Promise.all(
        memberships.map(async ({ project, role }) => ({
          id: project.id,
          name: project.name,
          artist: project.artist,
          coverUrl: project.coverImageUrl ? await createDownloadUrl(project.coverImageUrl) : null,
          myRole: role,
          members: members.filter((m) => m.projectId === project.id).map((m) => ({ userId: m.userId, role: m.role })),
        })),
      ),
      users: userRows,
      tracks: await Promise.all(
        trackRows.map(async (t) => ({
          id: t.id,
          projectId: t.projectId,
          name: t.name,
          status: t.status,
          coverUrl: t.coverImageUrl ? await createDownloadUrl(t.coverImageUrl) : null,
          createdAt: iso(t.createdAt)!,
          createdById: t.createdById,
        })),
      ),
      versions: versionRows.map((v) => ({
        ...v,
        createdAt: iso(v.createdAt)!,
        decidedAt: iso(v.decidedAt),
        rejectionReason: v.status === 'rejected' ? (rejectionReason.get(v.id) ?? null) : null,
        hasActiveShareLink: activeLink.has(v.id),
      })),
      comments: commentsOut,
      listens: listenRows.map((l) => ({ ...l, lastAt: iso(l.lastAt)! })),
      ...personal,
    });
  })

  // Marks a task on "Für dich" as done; repeated calls are harmless
  .post('/dismissals', zValidator('json', taskKeySchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { taskKey } = c.req.valid('json');
    await db.insert(taskDismissals).values({ userId, taskKey }).onConflictDoNothing();
    return c.json({ ok: true });
  })

  // Undo for the above
  .delete('/dismissals', zValidator('json', taskKeySchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { taskKey } = c.req.valid('json');
    await db
      .delete(taskDismissals)
      .where(and(eq(taskDismissals.userId, userId), eq(taskDismissals.taskKey, taskKey)));
    return c.json({ ok: true });
  })

  // The user just left the "Tracks" page; newer activity counts as new from here on
  .post('/seen', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const now = new Date();
    await db.update(users).set({ tracksSeenAt: now }).where(eq(users.id, userId));
    return c.json({ tracksSeenAt: now.toISOString() });
  });
