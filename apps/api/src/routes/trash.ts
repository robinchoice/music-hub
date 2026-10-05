import { Hono } from 'hono';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { tracks, versions, stems, comments, projectMembers, type Database } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createDownloadUrl } from '../storage/s3.js';
import { inTrash } from '../lib/trash.js';
import type { AppEnv } from '../types.js';

const KINDS = ['track', 'version', 'stem', 'comment'] as const;
type Kind = (typeof KINDS)[number];
const isKind = (kind: string): kind is Kind => (KINDS as readonly string[]).includes(kind);

async function roleIn(db: Database, projectId: string, userId: string) {
  const [membership] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return membership?.role ?? null;
}

// What the user may restore in the project: as owner tracks, versions and stems, otherwise their own stems,
// and always their own comments. Whatever sits below a deleted track or version comes back with it.
async function trashOf(db: Database, projectId: string, userId: string, owner: boolean) {
  // The subqueries name the outer table: drizzle leaves columns of a single-table select unqualified
  const trackRows = owner
    ? await db
        .select({
          id: tracks.id,
          deletedAt: tracks.deletedAt,
          trackId: tracks.id,
          trackName: tracks.name,
          coverImageUrl: tracks.coverImageUrl,
          versionCount: sql<number>`(select count(*)::int from versions v where v.track_id = tracks.id and v.deleted_at is null)`,
          commentCount: sql<number>`(select count(*)::int from comments c join versions v on v.id = c.version_id where v.track_id = tracks.id and v.deleted_at is null and c.deleted_at is null)`,
          stemCount: sql<number>`(select count(*)::int from stems s where s.track_id = tracks.id and s.deleted_at is null)`,
          shareLinkCount: sql<number>`(select count(*)::int from share_links l join versions v on v.id = l.version_id where v.track_id = tracks.id and v.deleted_at is null)`,
          bytes: sql<number>`((select coalesce(sum(v.file_size), 0) from versions v where v.track_id = tracks.id and v.deleted_at is null) + (select coalesce(sum(s.file_size), 0) from stems s where s.track_id = tracks.id and s.deleted_at is null))::float8`,
        })
        .from(tracks)
        .where(and(eq(tracks.projectId, projectId), inTrash(tracks)))
    : [];

  const versionRows = owner
    ? await db
        .select({
          id: versions.id,
          deletedAt: versions.deletedAt,
          trackId: tracks.id,
          trackName: tracks.name,
          versionNumber: versions.versionNumber,
          label: versions.label,
          branchLabel: versions.branchLabel,
          originalFileName: versions.originalFileName,
          bytes: versions.fileSize,
          commentCount: sql<number>`(select count(*)::int from comments c where c.version_id = ${versions.id} and c.deleted_at is null)`,
          shareLinkCount: sql<number>`(select count(*)::int from share_links l where l.version_id = ${versions.id})`,
        })
        .from(versions)
        .innerJoin(tracks, eq(tracks.id, versions.trackId))
        .where(and(eq(tracks.projectId, projectId), isNull(tracks.deletedAt), inTrash(versions)))
    : [];

  const stemRows = await db
    .select({
      id: stems.id,
      deletedAt: stems.deletedAt,
      trackId: tracks.id,
      trackName: tracks.name,
      name: stems.name,
      bytes: stems.fileSize,
    })
    .from(stems)
    .innerJoin(tracks, eq(tracks.id, stems.trackId))
    .where(
      and(
        eq(tracks.projectId, projectId),
        isNull(tracks.deletedAt),
        inTrash(stems),
        owner ? undefined : eq(stems.createdById, userId),
      ),
    );

  const commentRows = await db
    .select({
      id: comments.id,
      deletedAt: comments.deletedAt,
      trackId: tracks.id,
      trackName: tracks.name,
      versionId: versions.id,
      versionNumber: versions.versionNumber,
      body: comments.body,
      timestampSeconds: comments.timestampSeconds,
      replyCount: sql<number>`(select count(*)::int from comments r where r.parent_id = ${comments.id} and r.deleted_at is null)`,
    })
    .from(comments)
    .innerJoin(versions, eq(versions.id, comments.versionId))
    .innerJoin(tracks, eq(tracks.id, versions.trackId))
    .where(
      and(
        eq(tracks.projectId, projectId),
        isNull(tracks.deletedAt),
        isNull(versions.deletedAt),
        inTrash(comments),
        eq(comments.userId, userId),
      ),
    );

  const entries = [
    ...(await Promise.all(
      trackRows.map(async ({ coverImageUrl, ...t }) => ({
        kind: 'track' as const,
        ...t,
        coverUrl: coverImageUrl ? await createDownloadUrl(coverImageUrl) : null,
      })),
    )),
    ...versionRows.map((v) => ({ kind: 'version' as const, ...v })),
    ...stemRows.map((s) => ({ kind: 'stem' as const, ...s })),
    ...commentRows.map((c) => ({ kind: 'comment' as const, ...c })),
  ];
  return entries.sort((a, b) => b.deletedAt!.getTime() - a.deletedAt!.getTime());
}

// The project of an item in the trash, if the user may restore it
async function trashedItem(db: Database, kind: Kind, id: string, userId: string) {
  if (kind === 'track') {
    const [row] = await db
      .select({ projectId: tracks.projectId })
      .from(tracks)
      .where(and(eq(tracks.id, id), inTrash(tracks)))
      .limit(1);
    return row && (await roleIn(db, row.projectId, userId)) === 'owner' ? row : null;
  }
  if (kind === 'version') {
    const [row] = await db
      .select({ projectId: tracks.projectId })
      .from(versions)
      .innerJoin(tracks, eq(tracks.id, versions.trackId))
      .where(and(eq(versions.id, id), inTrash(versions), isNull(tracks.deletedAt)))
      .limit(1);
    return row && (await roleIn(db, row.projectId, userId)) === 'owner' ? row : null;
  }
  if (kind === 'stem') {
    const [row] = await db
      .select({ projectId: tracks.projectId, createdById: stems.createdById })
      .from(stems)
      .innerJoin(tracks, eq(tracks.id, stems.trackId))
      .where(and(eq(stems.id, id), inTrash(stems), isNull(tracks.deletedAt)))
      .limit(1);
    if (!row) return null;
    const role = await roleIn(db, row.projectId, userId);
    return role === 'owner' || (role && row.createdById === userId) ? row : null;
  }
  const [row] = await db
    .select({ projectId: tracks.projectId, authorId: comments.userId })
    .from(comments)
    .innerJoin(versions, eq(versions.id, comments.versionId))
    .innerJoin(tracks, eq(tracks.id, versions.trackId))
    .where(and(eq(comments.id, id), inTrash(comments), isNull(versions.deletedAt), isNull(tracks.deletedAt)))
    .limit(1);
  return row && row.authorId === userId && (await roleIn(db, row.projectId, userId)) ? row : null;
}

type TrashState = { deletedAt?: null; deletedById?: null; discardedAt: Date | null };

async function setState(db: Database, kind: Kind, ids: string[], state: TrashState) {
  if (kind === 'track') await db.update(tracks).set(state).where(inArray(tracks.id, ids));
  else if (kind === 'version') await db.update(versions).set(state).where(inArray(versions.id, ids));
  else if (kind === 'stem') await db.update(stems).set(state).where(inArray(stems.id, ids));
  else await db.update(comments).set(state).where(inArray(comments.id, ids));
}

export const trashRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/project/:projectId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');

    const role = await roleIn(db, projectId, userId);
    if (!role) return c.json({ error: 'Not found' }, 404);

    return c.json({ entries: await trashOf(db, projectId, userId, role === 'owner') });
  })

  // Empties the trash: everything the user could restore there is deleted for good
  .delete('/project/:projectId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');

    const role = await roleIn(db, projectId, userId);
    if (!role) return c.json({ error: 'Not found' }, 404);

    const entries = await trashOf(db, projectId, userId, role === 'owner');
    const now = new Date();
    for (const kind of KINDS) {
      const ids = entries.filter((e) => e.kind === kind).map((e) => e.id);
      if (ids.length) await setState(db, kind, ids, { discardedAt: now });
    }
    return c.json({ ok: true });
  })

  .post('/:kind/:id/restore', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const kind = c.req.param('kind');
    const id = c.req.param('id');

    if (!isKind(kind) || !(await trashedItem(db, kind, id, userId))) return c.json({ error: 'Not found' }, 404);

    await setState(db, kind, [id], { deletedAt: null, deletedById: null, discardedAt: null });
    return c.json({ ok: true });
  })

  // Deletes for good before the time in the trash runs out
  .delete('/:kind/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const kind = c.req.param('kind');
    const id = c.req.param('id');

    if (!isKind(kind) || !(await trashedItem(db, kind, id, userId))) return c.json({ error: 'Not found' }, 404);

    await setState(db, kind, [id], { discardedAt: new Date() });
    return c.json({ ok: true });
  });
