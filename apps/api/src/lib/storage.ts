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
const uploadVolume = rateLimit(MAX_STORAGE_PER_USER, 24 * 60 * 60 * 1000);

// Counts the bytes towards the user's daily upload volume, unless that would exceed it.
export function takeUploadVolume(userId: string, bytes: number) {
  if (uploadVolume.hit(userId, bytes)) return true;
  uploadVolume.undo(userId, bytes);
  return false;
}

// Originals the user uploaded, in all projects including archived ones, also while they are in the trash.
// Covers and the MP3s and waveforms derived from versions don't count.
export async function storageUsed(db: Executor, userId: string): Promise<number> {
  const [{ used }] = await db.execute<{ used: string }>(sql`
    SELECT (SELECT coalesce(sum(v.file_size), 0) FROM versions v JOIN tracks t ON t.id = v.track_id
             WHERE v.created_by_id = ${userId} AND ${keptSql('v')} AND ${keptSql('t')})
         + (SELECT coalesce(sum(s.file_size), 0) FROM stems s JOIN tracks t ON t.id = s.track_id
             WHERE s.created_by_id = ${userId} AND ${keptSql('s')} AND ${keptSql('t')}) AS used
  `);
  return Number(used);
}

// Holds the user's storage until the transaction ends, so parallel uploads
// can't all pass the limit check before any of them is inserted.
export async function lockStorage(tx: Executor, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
}

export function storageFull(c: Context, used: number) {
  // Rounded down, so a nearly full account doesn't read as full
  const gb = (bytes: number) => (Math.floor((bytes / GB) * 10) / 10).toLocaleString('de-DE');
  return c.json(
    { error: `Nicht genug Speicherplatz: ${gb(used)} von ${gb(MAX_STORAGE_PER_USER)} GB belegt` },
    413,
  );
}

export function uploadVolumeExceeded(c: Context) {
  return c.json({ error: 'Tageslimit für Uploads erreicht — bitte später erneut versuchen' }, 429);
}
