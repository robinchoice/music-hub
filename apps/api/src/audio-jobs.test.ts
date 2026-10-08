import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { audioJobs, createDb, migrateDb, projects, tracks, users, versions } from '@music-hub/db';
import {
  claimAudioJob,
  enqueueAudioJob,
  finishAudioJob,
  giveUpAudioJobs,
  MAX_ATTEMPTS,
  releaseAudioJob,
} from './services/audio-jobs.js';

// Runs against DATABASE_URL. The test jobs are dated far back, so workers take
// them before any job of the local dev database; all test rows go again at the end.
// Two clients stand for two workers.
const a = createDb(process.env.DATABASE_URL!);
const b = createDb(process.env.DATABASE_URL!);

let userId: string;
let projectId: string;
let trackId: string;

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [{ id: userId }] = await a
    .insert(users)
    .values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Test' })
    .returning({ id: users.id });
  [{ id: projectId }] = await a.insert(projects).values({ name: 'Test', createdById: userId }).returning({ id: projects.id });
  [{ id: trackId }] = await a
    .insert(tracks)
    .values({ projectId, name: 'Test', createdById: userId })
    .returning({ id: tracks.id });
});

afterAll(async () => {
  await a.delete(projects).where(eq(projects.id, projectId));
  await a.delete(users).where(eq(users.id, userId));
  await Promise.all([a.$client.end(), b.$client.end()]);
});

// Leaves no job of an earlier test behind to be claimed
beforeEach(async () => {
  const mine = a.select({ id: versions.id }).from(versions).where(eq(versions.trackId, trackId));
  await a.delete(audioJobs).where(inArray(audioJobs.versionId, mine));
});

let versionNumber = 0;

async function queuedVersion() {
  const [version] = await a
    .insert(versions)
    .values({
      trackId,
      versionNumber: ++versionNumber,
      originalFileName: 'test.wav',
      mimeType: 'audio/wav',
      fileSize: 1,
      originalFileKey: `test/${crypto.randomUUID()}.wav`,
      createdById: userId,
    })
    .returning({ id: versions.id });
  await enqueueAudioJob(a, version.id);
  await a
    .update(audioJobs)
    .set({ createdAt: new Date(Date.UTC(2000, 0, 1, 0, 0, versionNumber)) })
    .where(eq(audioJobs.versionId, version.id));
  return version.id;
}

// Lets the lease of a claimed job run out, as if its worker had died
async function expireLease(versionId: string) {
  await a.update(audioJobs).set({ lockedUntil: new Date(Date.UTC(2000, 0, 1)) }).where(eq(audioJobs.versionId, versionId));
}

// A second worker that finds no test job may take one of the dev database; that one goes straight back
async function claimOther() {
  const id = await claimAudioJob(b);
  const [mine] = id ? await a.select().from(versions).where(eq(versions.id, id)) : [];
  if (id && mine?.trackId !== trackId) await releaseAudioJob(b, id);
  return id;
}

const job = async (versionId: string) =>
  (await a.select().from(audioJobs).where(eq(audioJobs.versionId, versionId)))[0];

test('parallel workers take different jobs, oldest first', async () => {
  const first = await queuedVersion();
  const second = await queuedVersion();
  const claimed = await Promise.all([claimAudioJob(a), claimAudioJob(b)]);
  expect(new Set(claimed)).toEqual(new Set([first, second]));
  expect((await job(first)).attempts).toBe(1);
});

test('a held job is not claimed again, a finished one is gone', async () => {
  const id = await queuedVersion();
  expect(await claimAudioJob(a)).toBe(id);
  expect(await claimOther()).not.toBe(id);
  await finishAudioJob(a, id);
  expect(await job(id)).toBeUndefined();
});

test('a crashed job comes back once its lease ran out', async () => {
  const id = await queuedVersion();
  expect(await claimAudioJob(a)).toBe(id);
  await expireLease(id);
  expect(await claimAudioJob(b)).toBe(id);
  expect((await job(id)).attempts).toBe(2);
});

test('a released job is free again without counting the attempt', async () => {
  const id = await queuedVersion();
  expect(await claimAudioJob(a)).toBe(id);
  await releaseAudioJob(a, id);
  expect(await job(id)).toMatchObject({ attempts: 0, lockedUntil: null });
  expect(await claimAudioJob(b)).toBe(id);
});

test('after the last attempt the version is given up and plays from the original', async () => {
  const id = await queuedVersion();
  await a.update(versions).set({ status: 'processing' }).where(eq(versions.id, id));
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    expect(await claimAudioJob(a)).toBe(id);
    await expireLease(id);
  }
  expect(await claimOther()).not.toBe(id);

  await giveUpAudioJobs(b);
  expect(await job(id)).toBeUndefined();
  const [version] = await a.select({ status: versions.status }).from(versions).where(eq(versions.id, id));
  expect(version.status).toBe('ready');
});
