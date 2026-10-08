import type { Context } from 'hono';
import { sql } from 'drizzle-orm';
import { MAX_STORAGE_PER_USER } from '@music-hub/shared';
import type { Database } from '@music-hub/db';
import { rateLimit } from './rate-limit.js';
import { keptSql } from './trash.js';

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

// Used: originals the user uploaded, in all projects including archived ones, also while they are in the trash.
// Covers and the MP3s and waveforms derived from versions don't count.
export async function storageOf(db: Executor, userId: string): Promise<Storage> {
  const [{ used, limit }] = await db.execute<{ used: string; limit: string }>(sql`
    SELECT (SELECT coalesce(sum(v.file_size), 0) FROM versions v JOIN tracks t ON t.id = v.track_id
             WHERE v.created_by_id = ${userId} AND ${keptSql('v')} AND ${keptSql('t')})
         + (SELECT coalesce(sum(s.file_size), 0) FROM stems s JOIN tracks t ON t.id = s.track_id
             WHERE s.created_by_id = ${userId} AND ${keptSql('s')} AND ${keptSql('t')}) AS used,
           (SELECT coalesce(storage_limit, ${MAX_STORAGE_PER_USER}) FROM users WHERE id = ${userId}) AS limit
  `);
  return { used: Number(used), limit: Number(limit) };
}

export const fits = (storage: Storage, bytes: number) => storage.used + bytes <= storage.limit;

// Holds the user's storage until the transaction ends, so parallel uploads
// can't all pass the limit check before any of them is inserted.
export async function lockStorage(tx: Executor, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
}

export function storageFull(c: Context, { used, limit }: Storage) {
  // Rounded down, so a nearly full account doesn't read as full
  const gb = (bytes: number) => (Math.floor((bytes / GB) * 10) / 10).toLocaleString('de-DE');
  return c.json(
    { error: `Nicht genug Speicherplatz: ${gb(used)} von ${gb(limit)} GB belegt` },
    413,
  );
}

export function uploadVolumeExceeded(c: Context) {
  return c.json({ error: 'Tageslimit für Uploads erreicht — bitte später erneut versuchen' }, 429);
}
