import type { Context } from 'hono';
import { sql } from 'drizzle-orm';
import { dateLocales, GUEST_STORAGE_DEFAULT, MAX_STORAGE_PER_USER } from '@music-hub/shared';
import type { Database } from '@music-hub/db';
import { rateLimit } from './rate-limit.js';
import { keptSql } from './trash.js';
import { locale, t } from './i18n.js';

type Executor = Pick<Database, 'execute'>;

const GB = 1024 * 1024 * 1024;

// Bytes of upload URLs handed out per user and day. Bounds what uploads that
// are deleted again or never registered can pile up in the bucket.
const uploadVolume = rateLimit('upload-volume', MAX_STORAGE_PER_USER, 24 * 60 * 60 * 1000);

// Counts the bytes towards the user's daily upload volume, unless that would exceed it.
export async function takeUploadVolume(db: Database, userId: string, bytes: number) {
  if (await uploadVolume.hit(db, userId, bytes)) return true;
  await uploadVolume.undo(db, userId, bytes);
  return false;
}

export type Storage = { used: number; limit: number };

// One row per file somebody pays for, with who pays (uid): the originals of versions and stems
// they uploaded, earlier files of stems included, in all projects including archived ones.
// Stems taken over from open tracks (forked) belong to their first uploader, so they are left out here.
// Covers, MP3s and waveforms derived from versions don't count.
// kept: counts towards the storage, also while in the trash. live: not deleted at all.
// guest: uploaded through an upload link in the payer's name.
// Every count of storage builds on this, so the rule lives in one place.
const uploadedFiles = sql`
  SELECT v.created_by_id AS uid, v.track_id, 'version' AS kind, v.file_size AS size, false AS guest,
         ${keptSql('v')} AND ${keptSql('t')} AS kept, v.deleted_at IS NULL AND t.deleted_at IS NULL AS live
    FROM versions v JOIN tracks t ON t.id = v.track_id
  UNION ALL
  SELECT s.created_by_id, s.track_id, 'stem', s.file_size, s.guest_name IS NOT NULL,
         ${keptSql('s')} AND ${keptSql('t')}, s.deleted_at IS NULL AND t.deleted_at IS NULL
    FROM stems s JOIN tracks t ON t.id = s.track_id WHERE NOT s.forked
  UNION ALL
  SELECT r.created_by_id, s.track_id, 'stem', r.file_size, r.guest_name IS NOT NULL,
         ${keptSql('r')} AND ${keptSql('s')} AND ${keptSql('t')}, r.deleted_at IS NULL AND s.deleted_at IS NULL AND t.deleted_at IS NULL
    FROM stem_revisions r JOIN stems s ON s.id = r.stem_id JOIN tracks t ON t.id = s.track_id WHERE NOT r.forked
`;

const limitSql = (userId: string) => sql`(SELECT coalesce(storage_limit, ${MAX_STORAGE_PER_USER}) FROM users WHERE id = ${userId})`;

export async function storageOf(db: Executor, userId: string): Promise<Storage> {
  const [{ used, limit }] = await db.execute<{ used: string; limit: string }>(sql`
    SELECT (SELECT coalesce(sum(size), 0) FROM (${uploadedFiles}) f WHERE uid = ${userId} AND kept) AS used,
           ${limitSql(userId)} AS limit
  `);
  return { used: Number(used), limit: Number(limit) };
}

// The part of the user's storage that guests filled through upload links, with the limit the user set for it
export async function guestStorageOf(db: Executor, userId: string): Promise<Storage & { allowed: boolean }> {
  const [{ used, limit, allowed }] = await db.execute<{ used: string; limit: string; allowed: boolean }>(sql`
    SELECT (SELECT coalesce(sum(size), 0) FROM (${uploadedFiles}) f WHERE uid = ${userId} AND kept AND guest) AS used,
           coalesce(guest_storage_limit, ${GUEST_STORAGE_DEFAULT}) AS limit,
           guest_uploads AS allowed
    FROM users WHERE id = ${userId}
  `);
  return { used: Number(used), limit: Number(limit), allowed };
}

// For the overview: the storage split into versions and stems, and the three biggest tracks.
// The biggest tracks leave out what is in the trash, the totals include it.
export async function storageSummary(db: Executor, userId: string) {
  const [{ versionBytes, stemBytes, limitBytes }] = await db.execute<{ versionBytes: string; stemBytes: string; limitBytes: string }>(sql`
    SELECT coalesce(sum(size) FILTER (WHERE kind = 'version'), 0) AS "versionBytes",
           coalesce(sum(size) FILTER (WHERE kind = 'stem'), 0) AS "stemBytes",
           ${limitSql(userId)} AS "limitBytes"
    FROM (${uploadedFiles}) f WHERE uid = ${userId} AND kept
  `);
  const topTracks = await db.execute<{ trackId: string; name: string; bytes: string }>(sql`
    SELECT t.id AS "trackId", t.name AS "name", sum(f.size) AS "bytes"
    FROM (${uploadedFiles}) f JOIN tracks t ON t.id = f.track_id
    WHERE f.uid = ${userId} AND f.live
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

// For the admin: everyone's used bytes
export async function storageByUser(db: Executor) {
  const rows = await db.execute<{ uid: string; bytes: string }>(sql`
    SELECT uid, sum(size) AS bytes FROM (${uploadedFiles}) f WHERE kept GROUP BY uid
  `);
  return new Map(rows.map((r) => [r.uid, Number(r.bytes)]));
}

export const fits = (storage: Storage, bytes: number) => storage.used + bytes <= storage.limit;

// Holds the user's storage until the transaction ends, so parallel uploads
// can't all pass the limit check before any of them is inserted.
export async function lockStorage(tx: Executor, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
}

export function storageFull(c: Context, { used, limit }: Storage) {
  // Rounded down, so a nearly full account doesn't read as full
  const gb = (bytes: number) => (Math.floor((bytes / GB) * 10) / 10).toLocaleString(dateLocales[locale(c)]);
  return c.json(
    { error: t(c).errors.storageFull(gb(used), gb(limit)) },
    413,
  );
}

export function uploadVolumeExceeded(c: Context) {
  return c.json({ error: t(c).errors.uploadVolume }, 429);
}
