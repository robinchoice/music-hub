import './env';
import { drainBackground } from './lib/background.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { captureException } from './monitoring';
import { createDb, migrateDb } from '@music-hub/db';
import { purgeTrash } from './lib/trash.js';
import { processVersion } from './services/audio-processor.js';
import {
  claimAudioJob,
  finishAudioJob,
  giveUpAudioJobs,
  LEASE_MS,
  releaseAudioJob,
  renewAudioJob,
} from './services/audio-jobs.js';

// Audio worker: same image as the API, started with `bun run apps/api/src/worker.ts`.
// One ffmpeg job at a time, so it never takes more than what VPS 1 can spare.
const db = createDb(process.env.DATABASE_URL!);
const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop.abort());
await migrateDb(process.env.DATABASE_URL!);

// For the HEALTHCHECK of the image, which the API shares
const server = Bun.serve({ port: parseInt(process.env.PORT || '3000'), fetch: () => Response.json({ status: 'ok' }) });
// Deletes for good what left the trash long enough ago: a minute after boot, then every six hours.
// Each worker runs it; a second run finds nothing left to delete, so it needs no schedule table.
let purgeTimer: ReturnType<typeof setTimeout>;
let purgeInterval: ReturnType<typeof setInterval>;
let purging: Promise<unknown> = Promise.resolve();
{
  const purge = () =>
    purging = purgeTrash(db).catch((err) => {
      console.error('[Trash] Purge failed:', err);
      captureException(err);
    });
  purgeTimer = setTimeout(purge, 60_000);
  purgeInterval = setInterval(purge, 6 * 60 * 60_000);
}

console.log('[Worker] Waiting for audio jobs');

while (!stop.signal.aborted) {
  let current: string | null = null;
  try {
    await giveUpAudioJobs(db);
    if (stop.signal.aborted) break;
    current = await claimAudioJob(db);
    if (stop.signal.aborted) {
      if (current) await releaseAudioJob(db, current);
      break;
    }
    if (!current) {
      await sleep(2000, undefined, { signal: stop.signal }).catch(() => {});
      continue;
    }
    const versionId = current;
    const renew = setInterval(() => renewAudioJob(db, versionId).catch(() => {}), LEASE_MS / 5);
    try {
      await processVersion(db, versionId, stop.signal);
      stop.signal.throwIfAborted();
      await finishAudioJob(db, versionId);
    } finally {
      clearInterval(renew);
    }
  } catch (err) {
    if (stop.signal.aborted) {
      if (current) await releaseAudioJob(db, current);
      break;
    }
    // The job stays claimed and comes back once its lease runs out
    console.error('[Worker] Job failed:', err);
    captureException(err);
    await sleep(5000, undefined, { signal: stop.signal }).catch(() => {});
  }
}

clearTimeout(purgeTimer);
clearInterval(purgeInterval);
await purging;
await server.stop();
await drainBackground();
await db.$client.end();
process.exit(0);
