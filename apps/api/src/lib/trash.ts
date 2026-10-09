import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { TRASH_DAYS } from '@music-hub/shared';
import { comments, stems, tracks, versions, type Database } from '@music-hub/db';
import { deleteObject } from '../storage/s3.js';

// After leaving the trash, deleted things are kept this long so they can be restored on request
const KEEP_DAYS = 60;

type Trashable = { deletedAt: PgColumn; discardedAt: PgColumn };

// Deleted, not deleted for good and younger than TRASH_DAYS
export const inTrash = (t: Trashable) =>
  and(
    isNotNull(t.deletedAt),
    isNull(t.discardedAt),
    sql`${t.deletedAt} > now() - make_interval(days => ${TRASH_DAYS})`,
  );

// Not deleted or still in the trash, as raw SQL for a table alias. Only that counts towards storage.
export const keptSql = (alias: string) =>
  sql.raw(
    `(${alias}.deleted_at IS NULL OR (${alias}.discarded_at IS NULL AND ${alias}.deleted_at > now() - interval '${TRASH_DAYS} days'))`,
  );

export async function liveTrack(db: Database, trackId: string) {
  const [track] = await db
    .select()
    .from(tracks)
    .where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt)))
    .limit(1);
  return track;
}

// The version with its track, unless one of them is deleted
export async function liveVersion(db: Database, versionId: string) {
  const [row] = await db
    .select({ version: versions, track: tracks })
    .from(versions)
    .innerJoin(tracks, eq(tracks.id, versions.trackId))
    .where(and(eq(versions.id, versionId), isNull(versions.deletedAt), isNull(tracks.deletedAt)))
    .limit(1);
  return row;
}

// Deletes for good, files included, what left the trash more than KEEP_DAYS ago.
// A comment that still has replies keeps an empty row, so the replies stay attached to it.
export async function purgeTrash(db: Database) {
  const due = (t: Trashable) =>
    and(
      isNotNull(t.deletedAt),
      sql`coalesce(${t.discardedAt}, ${t.deletedAt} + make_interval(days => ${TRASH_DAYS})) < now() - make_interval(days => ${KEEP_DAYS})`,
    );
  const keys = new Set<string>();
  const collect = (...list: (string | null)[]) => list.forEach((key) => key && keys.add(key));

  const trackIds = (await db.select({ id: tracks.id }).from(tracks).where(due(tracks))).map((t) => t.id);
  if (trackIds.length) {
    for (const v of await db.select().from(versions).where(inArray(versions.trackId, trackIds))) {
      collect(v.originalFileKey, v.streamFileKey, v.waveformDataKey);
    }
    for (const s of await db.select().from(stems).where(inArray(stems.trackId, trackIds))) collect(s.fileKey);
    await db.delete(tracks).where(inArray(tracks.id, trackIds));
  }

  const dueVersions = await db.select().from(versions).where(due(versions));
  for (const v of dueVersions) collect(v.originalFileKey, v.streamFileKey, v.waveformDataKey);
  if (dueVersions.length) await db.delete(versions).where(inArray(versions.id, dueVersions.map((v) => v.id)));

  const dueStems = await db.select().from(stems).where(due(stems));
  for (const s of dueStems) collect(s.fileKey);
  if (dueStems.length) await db.delete(stems).where(inArray(stems.id, dueStems.map((s) => s.id)));

  const dueComments = await db.select({ id: comments.id, body: comments.body }).from(comments).where(due(comments));
  const commentIds = dueComments.map((c) => c.id);
  const answered = new Set(
    commentIds.length
      ? (await db.select({ parentId: comments.parentId }).from(comments).where(inArray(comments.parentId, commentIds))).map(
          (r) => r.parentId,
        )
      : [],
  );
  const removable = commentIds.filter((id) => !answered.has(id));
  const blank = dueComments.filter((c) => answered.has(c.id) && c.body !== '').map((c) => c.id);
  if (removable.length) await db.delete(comments).where(inArray(comments.id, removable));
  if (blank.length) await db.update(comments).set({ body: '' }).where(inArray(comments.id, blank));

  const files = await deleteUnusedFiles(db, keys);

  if (trackIds.length || dueVersions.length || dueStems.length || commentIds.length) {
    console.log(
      `[Trash] Deleted for good: ${trackIds.length} tracks, ${dueVersions.length} versions, ${dueStems.length} stems, ${removable.length} comments (${blank.length} emptied), ${files} files.`,
    );
  }
}

// Several stems can share a file; keeps every file that a remaining row still points to
export async function deleteUnusedFiles(db: Database, keys: Iterable<string>) {
  let files = 0;
  for (const key of keys) {
    const [versionRef] = await db
      .select({ id: versions.id })
      .from(versions)
      .where(or(eq(versions.originalFileKey, key), eq(versions.streamFileKey, key), eq(versions.waveformDataKey, key)))
      .limit(1);
    const [stemRef] = await db.select({ id: stems.id }).from(stems).where(eq(stems.fileKey, key)).limit(1);
    if (versionRef || stemRef) continue;
    try {
      await deleteObject(key);
      files++;
    } catch (err) {
      console.error(`[Trash] Could not delete ${key}: ${(err as Error).message}`);
    }
  }
  return files;
}
