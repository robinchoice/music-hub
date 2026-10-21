import { Hono } from 'hono';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { tracks, versions, stems, stemRevisions, comments, projects, projectMembers, openTracks, type Database } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createDownloadUrl } from '../storage/s3.js';
import { inTrash } from '../lib/trash.js';
import { membershipOf } from '../lib/access.js';
import type { AppEnv } from '../types.js';

const KINDS = ['track', 'version', 'stem', 'revision', 'comment'] as const;
type Kind = (typeof KINDS)[number];
const isKind = (kind: string): kind is Kind => (KINDS as readonly string[]).includes(kind);

async function roleIn(db: Database, projectId: string, userId: string) {
  return (await membershipOf(db, projectId, userId))?.role ?? null;
}

// What the user may restore, across all their projects that are not archived or in one: in projects they own tracks, versions, stems and earlier files of stems,
// otherwise their own stems and earlier files, and always their own comments. Whatever sits below a deleted track or version comes back with it.
export async function trashOf(db: Database, userId: string, projectId?: string) {
  const memberships = await db
    .select({ id: projects.id, name: projects.name, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.userId, userId), eq(projects.isArchived, false), projectId ? eq(projects.id, projectId) : undefined));
  if (!memberships.length) return [];
  const memberIds = memberships.map((m) => m.id);
  const ownedIds = memberships.filter((m) => m.role === 'owner').map((m) => m.id);
  const owner = ownedIds.length > 0;
  const projectName = new Map(memberships.map((m) => [m.id, m.name]));

  const trackRows = owner
    ? await db
        .select({
          id: tracks.id,
          deletedAt: tracks.deletedAt,
          projectId: tracks.projectId,
          trackId: tracks.id,
          trackName: tracks.name,
          coverImageUrl: tracks.coverImageUrl,
          versionCount: sql<number>`(select count(*)::int from versions v where v.track_id = tracks.id and v.deleted_at is null)`,
          commentCount: sql<number>`(select count(*)::int from comments c join versions v on v.id = c.version_id where v.track_id = tracks.id and v.deleted_at is null and c.deleted_at is null)`,
          stemCount: sql<number>`(select count(*)::int from stems s where s.track_id = tracks.id and s.deleted_at is null)`,
          shareLinkCount: sql<number>`(select count(*)::int from share_links l join versions v on v.id = l.version_id where v.track_id = tracks.id and v.deleted_at is null)`,
          bytes: sql<number>`((select coalesce(sum(v.file_size), 0) from versions v where v.track_id = tracks.id and v.deleted_at is null) + (select coalesce(sum(s.file_size), 0) from stems s where s.track_id = tracks.id and not s.forked and s.deleted_at is null) + (select coalesce(sum(r.file_size), 0) from stem_revisions r join stems s on s.id = r.stem_id where s.track_id = tracks.id and not r.forked and s.deleted_at is null and r.deleted_at is null))::float8`,
        })
        .from(tracks)
        .where(and(inArray(tracks.projectId, ownedIds), inTrash(tracks)))
    : [];

  const versionRows = owner
    ? await db
        .select({
          id: versions.id,
          deletedAt: versions.deletedAt,
          projectId: tracks.projectId,
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
        .where(and(inArray(tracks.projectId, ownedIds), isNull(tracks.deletedAt), inTrash(versions)))
    : [];

  const stemRows = await db
    .select({
      id: stems.id,
      deletedAt: stems.deletedAt,
      projectId: tracks.projectId,
      trackId: tracks.id,
      trackName: tracks.name,
      name: stems.name,
      bytes: sql<number>`case when ${stems.forked} then 0 else ${stems.fileSize} end`,
    })
    .from(stems)
    .innerJoin(tracks, eq(tracks.id, stems.trackId))
    .where(
      and(
        inArray(tracks.projectId, memberIds),
        isNull(tracks.deletedAt),
        inTrash(stems),
        owner ? or(inArray(tracks.projectId, ownedIds), eq(stems.createdById, userId)) : eq(stems.createdById, userId),
      ),
    );

  const revisionRows = await db
    .select({
      id: stemRevisions.id,
      deletedAt: stemRevisions.deletedAt,
      projectId: tracks.projectId,
      trackId: tracks.id,
      trackName: tracks.name,
      name: stems.name,
      originalFileName: stemRevisions.originalFileName,
      bytes: sql<number>`case when ${stemRevisions.forked} then 0 else ${stemRevisions.fileSize} end`,
    })
    .from(stemRevisions)
    .innerJoin(stems, eq(stems.id, stemRevisions.stemId))
    .innerJoin(tracks, eq(tracks.id, stems.trackId))
    .where(
      and(
        inArray(tracks.projectId, memberIds),
        isNull(tracks.deletedAt),
        isNull(stems.deletedAt),
        inTrash(stemRevisions),
        owner ? or(inArray(tracks.projectId, ownedIds), eq(stemRevisions.createdById, userId)) : eq(stemRevisions.createdById, userId),
      ),
    );

  const commentRows = await db
    .select({
      id: comments.id,
      deletedAt: comments.deletedAt,
      projectId: tracks.projectId,
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
        inArray(tracks.projectId, memberIds),
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
    ...revisionRows.map((r) => ({ kind: 'revision' as const, ...r })),
    ...commentRows.map((c) => ({ kind: 'comment' as const, ...c })),
  ];
  return entries
    .map((e) => ({ ...e, projectName: projectName.get(e.projectId)! }))
    .sort((a, b) => b.deletedAt!.getTime() - a.deletedAt!.getTime());
}

// The project of an item in the trash, if the user may restore it
async function trashedItem(db: Database, kind: Kind, id: string, userId: string) {
  if (kind === 'track') {
    const [row] = await db
      .select({ projectId: tracks.projectId, trackId: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.id, id), inTrash(tracks)))
      .limit(1);
    return row && (await roleIn(db, row.projectId, userId)) === 'owner' ? row : null;
  }
  if (kind === 'version') {
    const [row] = await db
      .select({ projectId: tracks.projectId, trackId: tracks.id })
      .from(versions)
      .innerJoin(tracks, eq(tracks.id, versions.trackId))
      .where(and(eq(versions.id, id), inTrash(versions), isNull(tracks.deletedAt)))
      .limit(1);
    return row && (await roleIn(db, row.projectId, userId)) === 'owner' ? row : null;
  }
  if (kind === 'stem') {
    const [row] = await db
      .select({ projectId: tracks.projectId, trackId: tracks.id, createdById: stems.createdById })
      .from(stems)
      .innerJoin(tracks, eq(tracks.id, stems.trackId))
      .where(and(eq(stems.id, id), inTrash(stems), isNull(tracks.deletedAt)))
      .limit(1);
    if (!row) return null;
    const role = await roleIn(db, row.projectId, userId);
    return role === 'owner' || (role && row.createdById === userId) ? row : null;
  }
  if (kind === 'revision') {
    const [row] = await db
      .select({ projectId: tracks.projectId, trackId: tracks.id, createdById: stemRevisions.createdById })
      .from(stemRevisions)
      .innerJoin(stems, eq(stems.id, stemRevisions.stemId))
      .innerJoin(tracks, eq(tracks.id, stems.trackId))
      .where(and(eq(stemRevisions.id, id), inTrash(stemRevisions), isNull(stems.deletedAt), isNull(tracks.deletedAt)))
      .limit(1);
    if (!row) return null;
    const role = await roleIn(db, row.projectId, userId);
    return role === 'owner' || (role && row.createdById === userId) ? row : null;
  }
  const [row] = await db
    .select({ projectId: tracks.projectId, trackId: tracks.id, authorId: comments.userId })
    .from(comments)
    .innerJoin(versions, eq(versions.id, comments.versionId))
    .innerJoin(tracks, eq(tracks.id, versions.trackId))
    .where(and(eq(comments.id, id), inTrash(comments), isNull(versions.deletedAt), isNull(tracks.deletedAt)))
    .limit(1);
  return row && row.authorId === userId && (await roleIn(db, row.projectId, userId)) ? row : null;
}

type TrashState = { deletedAt?: null; deletedById?: null; discardedAt: Date | null };

async function setState(db: Pick<Database, 'update'>, kind: Kind, ids: string[], state: TrashState) {
  if (kind === 'track') await db.update(tracks).set(state).where(inArray(tracks.id, ids));
  else if (kind === 'version') await db.update(versions).set(state).where(inArray(versions.id, ids));
  else if (kind === 'stem') await db.update(stems).set(state).where(inArray(stems.id, ids));
  else if (kind === 'revision') await db.update(stemRevisions).set(state).where(inArray(stemRevisions.id, ids));
  else await db.update(comments).set(state).where(inArray(comments.id, ids));
}

// Everything the user could restore there is deleted for good
async function emptyTrash(db: Database, userId: string, projectId?: string) {
  const entries = await trashOf(db, userId, projectId);
  const now = new Date();
  for (const kind of KINDS) {
    const ids = entries.filter((e) => e.kind === kind).map((e) => e.id);
    if (ids.length) await setState(db, kind, ids, { discardedAt: now });
  }
}

export const trashRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // The user's trash across all projects, or of one with ?project=
  .get('/', async (c) => {
    const projectId = c.req.query('project');
    return c.json({ entries: await trashOf(c.get('db'), c.get('userId'), projectId) });
  })

  .delete('/', async (c) => {
    await emptyTrash(c.get('db'), c.get('userId'), c.req.query('project'));
    return c.json({ ok: true });
  })

  .get('/project/:projectId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');

    if (!(await roleIn(db, projectId, userId))) return c.json({ error: 'Not found' }, 404);
    return c.json({ entries: await trashOf(db, userId, projectId) });
  })

  .delete('/project/:projectId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');

    if (!(await roleIn(db, projectId, userId))) return c.json({ error: 'Not found' }, 404);
    await emptyTrash(db, userId, projectId);
    return c.json({ ok: true });
  })

  .post('/:kind/:id/restore', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const kind = c.req.param('kind');
    const id = c.req.param('id');

    if (!isKind(kind)) return c.json({ error: 'Not found' }, 404);
    const item = await trashedItem(db, kind, id, userId);
    if (!item) return c.json({ error: 'Not found' }, 404);

    return db.transaction(async (tx) => {
      if (kind === 'stem' || kind === 'revision') {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'open:' + item.trackId}))`);
        const [open] = await tx
          .select({ trackId: openTracks.trackId })
          .from(openTracks)
          .where(and(eq(openTracks.trackId, item.trackId), isNotNull(openTracks.openedAt)));
        if (open) return c.json({ error: 'Der Track ist offen. Schließe ihn, um Spuren wiederherzustellen.' }, 409);
      }
      await setState(tx, kind, [id], { deletedAt: null, deletedById: null, discardedAt: null });
      return c.json({ ok: true });
    });
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
