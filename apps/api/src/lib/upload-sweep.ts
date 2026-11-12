import type { Database } from '@music-hub/db';
import { deleteObject, listObjects } from '../storage/s3.js';
import { keysInUse } from './files.js';

// Originals and stems a client sent to a presigned URL and never registered, because the upload or the page broke off.
// They count towards nobody's storage, so only the bucket pays for them. An upload URL lasts 15 minutes,
// so nothing registers an object this old any more.
export const ABANDONED_AFTER_MS = 7 * 24 * 60 * 60_000;

// Until a week of counts in the worker log looked right, the sweep only reports what it would delete
export const SWEEP_DELETES = false;

// Where upload URLs put files: the project's uploads, stems and originals of versions. MP3s, waveforms and covers are left alone.
const UPLOAD_KEY = /^projects\/[^/]+\/(uploads\/[^/]+\/(original|file)\/|tracks\/[^/]+\/(stems\/|versions\/[^/]+\/original\/))/;
// Control characters don't survive the XML of a bucket listing, so such a key could differ from the one in the database
const UNLISTABLE = /[\x00-\x1f\x7f]/;

export async function sweepAbandonedUploads(db: Pick<Database, 'execute'>, { now = new Date(), deletes = SWEEP_DELETES } = {}) {
  const started = Date.now();
  const before = now.getTime() - ABANDONED_AFTER_MS;
  let scanned = 0;
  let found = 0;
  let bytes = 0;
  let deleted = 0;
  // Which upload URL they came from, so the log shows whether a single path leaves files behind
  const kinds = { uploads: 0, stems: 0, originals: 0 };
  for await (const page of listObjects('projects/')) {
    scanned += page.length;
    const old = page.filter((o) => o.lastModified.getTime() < before && UPLOAD_KEY.test(o.key) && !UNLISTABLE.test(o.key));
    if (!old.length) continue;
    const used = await keysInUse(db, old.map((o) => o.key));
    for (const o of old) {
      if (used.has(o.key)) continue;
      found++;
      bytes += o.size;
      kinds[o.key.includes('/uploads/') ? 'uploads' : o.key.includes('/stems/') ? 'stems' : 'originals']++;
      if (!deletes) continue;
      try {
        await deleteObject(o.key);
        deleted++;
      } catch (err) {
        console.error(`[Uploads] Could not delete ${o.key}: ${(err as Error).message}`);
      }
    }
  }
  // Logged on every run, also with nothing found, so the log shows that the sweep ran and how much it looked at
  const summary = `${found} abandoned uploads (${(bytes / 1024 ** 2).toFixed(1)} MB; ${kinds.uploads} project uploads, ${kinds.stems} stems, ${kinds.originals} originals) among ${scanned} objects in ${((Date.now() - started) / 1000).toFixed(1)} s`;
  console.log(deletes ? `[Uploads] Deleted ${deleted} of ${summary}.` : `[Uploads] Found ${summary}, not deleting yet.`);
  return { found, bytes, deleted };
}
