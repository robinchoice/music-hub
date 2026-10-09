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
await migrateDb(process.env.DATABASE_URL!);

let current: string | null = null;
let claiming: Promise<string | null> | null = null;
let stopping = false;

// A deploy stops the old container; the next worker picks the job up right away
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  const versionId = claiming ? await claiming.catch(() => null) : current;
  if (versionId) await releaseAudioJob(db, versionId).catch(() => {});
  process.exit(0);
});

// For the HEALTHCHECK of the image, which the API shares
Bun.serve({ port: parseInt(process.env.PORT || '3000'), fetch: () => Response.json({ status: 'ok' }) });
// Deletes for good what left the trash long enough ago: a minute after boot, then every six hours.
// Each worker runs it; a second run finds nothing left to delete, so it needs no schedule table.
{
  const purge = () =>
    purgeTrash(db).catch((err) => {
      console.error('[Trash] Purge failed:', err);
      captureException(err);
    });
  setTimeout(purge, 60_000);
  setInterval(purge, 6 * 60 * 60_000);
}

console.log('[Worker] Waiting for audio jobs');

while (!stopping) {
  try {
    await giveUpAudioJobs(db);
    claiming = claimAudioJob(db);
    current = await claiming;
    claiming = null;
    if (stopping) break;
    if (!current) {
      await Bun.sleep(2000);
      continue;
    }
    const versionId = current;
    const renew = setInterval(() => renewAudioJob(db, versionId).catch(() => {}), LEASE_MS / 5);
    try {
      await processVersion(db, versionId);
      await finishAudioJob(db, versionId);
    } finally {
      clearInterval(renew);
      current = null;
    }
  } catch (err) {
    // The job stays claimed and comes back once its lease runs out
    console.error('[Worker] Job failed:', err);
    captureException(err);
    await Bun.sleep(5000);
  }
}
