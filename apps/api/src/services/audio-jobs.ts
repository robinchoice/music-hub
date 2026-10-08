import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { audioJobs, versions, type Database } from '@music-hub/db';
import { publish } from './sse.js';

type Executor = Pick<Database, 'insert'>;

// How long a claimed job stays with its worker without a sign of life
export const LEASE_MS = 5 * 60_000;
// Claims per job; a job whose worker keeps dying is given up after that
export const MAX_ATTEMPTS = 3;

const leaseEnd = () => sql`now() + make_interval(secs => ${LEASE_MS / 1000})`;

export async function enqueueAudioJob(db: Executor, versionId: string) {
  await db.insert(audioJobs).values({ versionId }).onConflictDoNothing();
}

// Waits until the worker has processed these versions, at most `timeoutMs`
export async function waitForAudioJobs(db: Database, versionIds: string[], timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const open = await db
      .select({ versionId: audioJobs.versionId })
      .from(audioJobs)
      .where(inArray(audioJobs.versionId, versionIds))
      .limit(1);
    if (!open.length) return;
    await Bun.sleep(500);
  }
}

// Takes the oldest job no worker holds. SKIP LOCKED lets parallel workers pass each other.
export async function claimAudioJob(db: Database): Promise<string | null> {
  const next = db
    .select({ versionId: audioJobs.versionId })
    .from(audioJobs)
    .where(
      and(
        or(isNull(audioJobs.lockedUntil), lt(audioJobs.lockedUntil, sql`now()`)),
        lt(audioJobs.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(asc(audioJobs.createdAt))
    .limit(1)
    .for('update', { skipLocked: true });

  const [job] = await db
    .update(audioJobs)
    .set({ attempts: sql`${audioJobs.attempts} + 1`, lockedUntil: leaseEnd() })
    .where(inArray(audioJobs.versionId, next))
    .returning({ versionId: audioJobs.versionId });
  return job?.versionId ?? null;
}

// Called while the job runs, so long files don't look like a dead worker
export async function renewAudioJob(db: Database, versionId: string) {
  await db.update(audioJobs).set({ lockedUntil: leaseEnd() }).where(eq(audioJobs.versionId, versionId));
}

export async function finishAudioJob(db: Database, versionId: string) {
  await db.delete(audioJobs).where(eq(audioJobs.versionId, versionId));
}

// Hands a job back on shutdown, without counting the interrupted attempt
export async function releaseAudioJob(db: Database, versionId: string) {
  await db
    .update(audioJobs)
    .set({ attempts: sql`greatest(0, ${audioJobs.attempts} - 1)`, lockedUntil: null })
    .where(eq(audioJobs.versionId, versionId));
}

// Jobs whose attempts all ended with a dead worker. Like a failed conversion,
// the version becomes ready and plays from the original.
export async function giveUpAudioJobs(db: Database) {
  const dropped = await db
    .delete(audioJobs)
    .where(and(sql`${audioJobs.attempts} >= ${MAX_ATTEMPTS}`, lt(audioJobs.lockedUntil, sql`now()`)))
    .returning({ versionId: audioJobs.versionId });
  if (!dropped.length) return;

  const given = await db
    .update(versions)
    .set({ status: 'ready' })
    .where(
      and(
        inArray(versions.id, dropped.map((j) => j.versionId)),
        inArray(versions.status, ['uploaded', 'processing']),
      ),
    )
    .returning({ id: versions.id, trackId: versions.trackId });
  for (const v of given) {
    console.error(`[Worker] Gave up on version ${v.id} after ${MAX_ATTEMPTS} attempts`);
    publish(db, v.trackId, { type: 'version:status', data: { versionId: v.id, status: 'ready' } });
  }
}
