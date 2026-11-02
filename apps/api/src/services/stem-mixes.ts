import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { projects, stemMixJobs, stems, tracks, versions, type Database } from '@music-hub/db';
import { MAX_FILE_SIZE } from '@music-hub/shared';
import { fits, lockStorage, storageOf } from '../lib/storage.js';
import { queueVersionNotice } from '../lib/notices.js';
import { captureException } from '../monitoring.js';
import { createDownloadUrl, deleteObject, putObjectFile } from '../storage/s3.js';
import { enqueueAudioJob, LEASE_MS, MAX_ATTEMPTS, RETRY_MS } from './audio-jobs.js';
import { publish } from './sse.js';

export const MIX_PAUSE_MS = 20_000;
type Executor = Pick<Database, 'insert'>;

export async function queueStemMix(db: Executor, trackId: string, createdById: string) {
  await db.insert(stemMixJobs).values({ trackId, createdById }).onConflictDoUpdate({
    target: stemMixJobs.trackId,
    set: { revision: crypto.randomUUID(), createdById, requestedAt: sql`now()`, attempts: 0 },
  });
}

// Catch up tracks that already had stems but nothing to play. Never add a mix to an existing version history here.
export async function queueMissingStemMixes(db: Database) {
  await db.execute(sql`
    INSERT INTO stem_mix_jobs (track_id, created_by_id)
    SELECT t.id, p.created_by_id FROM tracks t JOIN projects p ON p.id = t.project_id
    WHERE t.deleted_at IS NULL AND NOT p.is_archived
      AND EXISTS (SELECT 1 FROM stems s WHERE s.track_id = t.id AND s.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM versions v WHERE v.track_id = t.id)
    ON CONFLICT DO NOTHING
  `);
}

export async function stemMixState(db: Pick<Database, 'select'>, trackId: string) {
  const [job] = await db.select().from(stemMixJobs).where(eq(stemMixJobs.trackId, trackId));
  return job ? (job.attempts >= MAX_ATTEMPTS && (!job.lockedUntil || job.lockedUntil <= new Date()) ? 'failed' : 'pending') : null;
}

export async function renderStemMix(urls: string[], path: string, signal: AbortSignal, maxBytes = MAX_FILE_SIZE) {
  signal.throwIfAborted();
  const inputs = urls.flatMap((url) => ['-i', url]);
  const channels = urls.map((_, i) => `[${i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`);
  const sum = urls.map((_, i) => `[a${i}]`).join('');
  const filter = `${channels.join(';')};${sum}amix=inputs=${urls.length}:duration=longest:normalize=0,alimiter=limit=0.95:level=0:latency=1[out]`;
  const proc = Bun.spawn([
    'ffmpeg', '-nostdin', '-v', 'error', ...inputs,
    '-filter_complex', filter, '-map', '[out]', '-c:a', 'pcm_s24le', '-fs', String(maxBytes), '-y', path,
  ], { stdout: 'ignore', stderr: 'ignore', signal, timeout: 15 * 60_000, killSignal: 'SIGKILL' });
  if (await proc.exited !== 0) throw new Error('Stem mix failed or timed out');
  signal.throwIfAborted();
  // -fs bounds temporary disk use but exits successfully on truncation. Never publish that truncated audio.
  if ((await stat(path)).size >= maxBytes) throw new Error('Not enough storage for the complete stem mix');
}

// Creates a version only after its original exists. Failed and superseded renders never leave broken versions behind.
export async function processNextStemMix(db: Database, signal: AbortSignal): Promise<boolean> {
  const claimed = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(stemMixJobs).where(and(
      lt(stemMixJobs.requestedAt, sql`now() - make_interval(secs => ${MIX_PAUSE_MS / 1000})`),
      or(isNull(stemMixJobs.lockedUntil), lt(stemMixJobs.lockedUntil, sql`now()`)),
      lt(stemMixJobs.attempts, MAX_ATTEMPTS),
    )).orderBy(asc(stemMixJobs.requestedAt)).limit(1).for('update', { skipLocked: true });
    if (!job) return null;
    const [track] = await tx.select({ id: tracks.id, projectId: tracks.projectId }).from(tracks)
      .innerJoin(projects, eq(projects.id, tracks.projectId))
      .where(and(eq(tracks.id, job.trackId), isNull(tracks.deletedAt), eq(projects.isArchived, false)));
    const files = track ? await tx.select({ fileKey: stems.fileKey }).from(stems)
      .where(and(eq(stems.trackId, job.trackId), isNull(stems.deletedAt))).orderBy(asc(stems.id)) : [];
    if (!track || !files.length) {
      await tx.delete(stemMixJobs).where(eq(stemMixJobs.trackId, job.trackId));
      return { empty: true } as const;
    }
    await tx.update(stemMixJobs).set({ attempts: job.attempts + 1, lockedUntil: sql`now() + make_interval(secs => ${LEASE_MS / 1000})` })
      .where(eq(stemMixJobs.trackId, job.trackId));
    return { empty: false, job, track, files } as const;
  });
  if (!claimed) return false;
  if (claimed.empty) return true;
  const { job, track, files } = claimed;
  const mine = and(eq(stemMixJobs.trackId, job.trackId), eq(stemMixJobs.revision, job.revision));
  const renew = setInterval(() => {
    db.update(stemMixJobs).set({ lockedUntil: sql`now() + make_interval(secs => ${LEASE_MS / 1000})` })
      .where(eq(stemMixJobs.trackId, job.trackId)).catch(() => {});
  }, LEASE_MS / 5);
  let directory: string | undefined;
  let uploaded = false;
  let stored = false;
  const versionId = crypto.randomUUID();
  const key = `projects/${track.projectId}/tracks/${track.id}/versions/${versionId}/original/automatic-mix.wav`;
  try {
    directory = await mkdtemp(join(tmpdir(), 'musichub-mix-'));
    const path = join(directory, 'mix.wav');
    const storage = await storageOf(db, job.createdById);
    const maxBytes = Math.min(MAX_FILE_SIZE, storage.limit - storage.used);
    if (maxBytes <= 44) throw new Error('Not enough storage for stem mix');
    await renderStemMix(await Promise.all(files.map((file) => createDownloadUrl(file.fileKey))), path, signal, maxBytes);
    const { size } = await stat(path);
    signal.throwIfAborted();
    await putObjectFile(key, path, 'audio/wav');
    uploaded = true;
    signal.throwIfAborted();
    const version = await db.transaction(async (tx) => {
      await lockStorage(tx, job.createdById);
      // Manual uploads use the same track lock, keeping version numbers unique across uploaders.
      const [live] = await tx.select().from(tracks).where(and(eq(tracks.id, track.id), isNull(tracks.deletedAt))).for('update');
      const [current] = await tx.select().from(stemMixJobs).where(eq(stemMixJobs.trackId, job.trackId)).for('update');
      if (!current || current.revision !== job.revision) return null;
      const [project] = await tx.select().from(projects).where(eq(projects.id, track.projectId));
      if (!live || project.isArchived) {
        await tx.delete(stemMixJobs).where(mine);
        return null;
      }
      if (!fits(await storageOf(tx, job.createdById), size)) throw new Error('Not enough storage for stem mix');
      const [latest] = await tx.select({ number: sql<number>`coalesce(max(${versions.versionNumber}), 0)` }).from(versions).where(eq(versions.trackId, track.id));
      const [created] = await tx.insert(versions).values({
        id: versionId, trackId: track.id, versionNumber: latest.number + 1, autoMix: true,
        originalFileName: 'automatic-mix.wav', mimeType: 'audio/wav', fileSize: size,
        originalFileKey: key, createdById: job.createdById,
      }).returning();
      await enqueueAudioJob(tx, created.id);
      await queueVersionNotice(tx, track.projectId, job.createdById, created.id);
      await tx.delete(stemMixJobs).where(mine);
      return created;
    });
    stored = !!version;
    if (version) publish(db, track.id, { type: 'version:new', data: { versionId: version.id, trackId: track.id } });
    // An edit that arrived during rendering can be picked up as soon as its pause has elapsed.
    await db.update(stemMixJobs).set({ lockedUntil: null }).where(eq(stemMixJobs.trackId, job.trackId));
  } catch (error) {
    if (signal.aborted) {
      await db.update(stemMixJobs).set({ attempts: sql`greatest(0, ${stemMixJobs.attempts} - 1)`, lockedUntil: null }).where(mine);
    } else {
      captureException(error);
      console.error(`[Worker] Stem mix failed for track ${track.id}`);
      await db.update(stemMixJobs).set({ lockedUntil: sql`now() + make_interval(secs => ${RETRY_MS / 1000})` }).where(mine);
    }
    // A new revision must not stay leased by the render it superseded.
    await db.update(stemMixJobs).set({ lockedUntil: null }).where(and(eq(stemMixJobs.trackId, job.trackId), sql`${stemMixJobs.revision} <> ${job.revision}`));
  } finally {
    clearInterval(renew);
    if (uploaded && !stored) await deleteObject(key);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
  return true;
}
