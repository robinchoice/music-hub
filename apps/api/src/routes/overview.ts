import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { memberRoles, taskKeySchema, REJECTION_PREFIX } from '@music-hub/shared';
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
} from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createDownloadUrl } from '../storage/s3.js';
import { storageSummary } from '../lib/storage.js';
import type { AppEnv } from '../types.js';

// Open comments are always included, others only from the longest timeline range (13 weeks).
const COMMENT_WINDOW_DAYS = 91;
const LISTEN_WINDOW_DAYS = 90;
const BODY_LIMIT = 200;
const DAY_MS = 86_400_000;

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

export const overviewRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Everything the overview pages need, for all projects of the user that are not archived
  .get('/', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const [[me], dismissed, storage, memberships] = await Promise.all([
      db.select({ tracksSeenAt: users.tracksSeenAt }).from(users).where(eq(users.id, userId)).limit(1),
      db.select({ taskKey: taskDismissals.taskKey }).from(taskDismissals).where(eq(taskDismissals.userId, userId)),
      storageSummary(db, userId),
      db
        .select({ project: projects, role: projectMembers.role, extraRoles: projectMembers.extraRoles })
        .from(projectMembers)
        .innerJoin(projects, eq(projects.id, projectMembers.projectId))
        .where(and(eq(projectMembers.userId, userId), eq(projects.isArchived, false))),
    ]);
    const personal = {
      storage,
      dismissedTaskKeys: dismissed.map((d) => d.taskKey),
      tracksSeenAt: iso(me?.tracksSeenAt),
    };

    const projectIds = memberships.map((m) => m.project.id);
    if (projectIds.length === 0) {
      return c.json({ projects: [], users: [], tracks: [], versions: [], comments: [], listens: [], ...personal });
    }

    const members = await db
      .select({ projectId: projectMembers.projectId, userId: projectMembers.userId, role: projectMembers.role, extraRoles: projectMembers.extraRoles })
      .from(projectMembers)
      .where(inArray(projectMembers.projectId, projectIds));

    const trackRows = await db
      .select({
        id: tracks.id,
        projectId: tracks.projectId,
        name: tracks.name,
        status: tracks.status,
        coverImageUrl: tracks.coverImageUrl,
        sortOrder: tracks.sortOrder,
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
    const [commentRows, rejectionRows, links] = await Promise.all([
      versionIds.length
        ? db
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
        : [],

      // The newest rejection comment of each version, regardless of age
      versionIds.length
        ? db
            .selectDistinctOn([comments.versionId], { versionId: comments.versionId, body: comments.body })
            .from(comments)
            .where(
              and(
                inArray(comments.versionId, versionIds),
                isNull(comments.parentId),
                isNull(comments.deletedAt),
                sql`${comments.body} LIKE ${REJECTION_PREFIX + '%'}`,
              ),
            )
            .orderBy(comments.versionId, desc(comments.createdAt))
        : [],
      versionIds.length
        ? db
            .select({ id: shareLinks.id, versionId: shareLinks.versionId, expiresAt: shareLinks.expiresAt })
            .from(shareLinks)
            .where(inArray(shareLinks.versionId, versionIds))
        : [],
    ]);
    const rejectionReason = new Map(rejectionRows.map((r) => [r.versionId, r.body.slice(REJECTION_PREFIX.length)]));

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
        memberships.map(async ({ project, role, extraRoles }) => ({
          id: project.id,
          name: project.name,
          artist: project.artist,
          coverUrl: project.coverImageUrl ? await createDownloadUrl(project.coverImageUrl) : null,
          myRole: role,
          myRoles: memberRoles({ role, extraRoles }),
          members: members
            .filter((m) => m.projectId === project.id)
            .map((m) => ({ userId: m.userId, role: m.role, roles: memberRoles(m) })),
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
          sortOrder: t.sortOrder,
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
