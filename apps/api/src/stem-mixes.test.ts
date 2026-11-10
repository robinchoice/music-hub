import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { audioJobs, createDb, migrateDb, projectMembers, projects, sessions, stemMixJobs, stemMixUploads, stems, tracks, users, versions } from '@music-hub/db';
import { holdStemMix, processNextStemMix, queueMissingStemMixes, queueStemMix, renderStemMix, stemMixState } from './services/stem-mixes.js';
import { Hono } from 'hono';
import { generateToken, hashToken } from './middleware/auth.js';
import { trashRoutes } from './routes/trash.js';
import type { AppEnv } from './types.js';
import { processVersion } from './services/audio-processor.js';
import { replaceStem, restoreRevision } from './lib/stems.js';
import { stemRevisions } from '@music-hub/db';

const storage = { ...await import('./storage/s3.js') };
const db = createDb(process.env.DATABASE_URL!);
const other = createDb(process.env.DATABASE_URL!);
const outputs = new Map<string, string>();
let directory: string, tone: string, owner: string, projectId: string, trackId: string, stemId: string;
let duringUpload: (() => Promise<void>) | undefined;
const signal = () => new AbortController().signal;
const prefix = `mix-test/${crypto.randomUUID()}/`;

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  directory = await mkdtemp(join(tmpdir(), 'mix-test-'));
  tone = join(directory, 'tone.wav');
  const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-y', tone], { stderr: 'ignore' });
  expect(await proc.exited).toBe(0);
  mock.module('./storage/s3.js', () => ({
    ...storage,
    createDownloadUrl: async (key: string, expiresIn?: number, downloadName?: string) =>
      key.startsWith(prefix) ? (key.includes('non-audio') ? '/missing-non-audio' : tone) : outputs.get(key) ?? storage.createDownloadUrl(key, expiresIn, downloadName),
    putObjectFile: async (key: string, path: string) => {
      const saved = join(directory, crypto.randomUUID());
      await Bun.write(saved, Bun.file(path));
      outputs.set(key, saved);
      await duringUpload?.();
    },
    putObject: async (key: string, body: string | Uint8Array) => {
      const saved = join(directory, crypto.randomUUID());
      await Bun.write(saved, body);
      outputs.set(key, saved);
    },
    deleteObject: async (key: string) => { outputs.delete(key); },
  }));
  const [user] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Mix test' }).returning();
  owner = user.id;
  const [project] = await db.insert(projects).values({ name: 'Stem mixes', createdById: owner }).returning();
  projectId = project.id;
  await db.insert(projectMembers).values({ projectId, userId: owner, role: 'owner', canDownload: true, canInvite: true, canUpload: true });
});

beforeEach(async () => {
  duringUpload = undefined;
  await db.delete(stemMixJobs).where(eq(stemMixJobs.createdById, owner));
  const [track] = await db.insert(tracks).values({ projectId, name: 'Song', createdById: owner }).returning();
  trackId = track.id;
  const [stem] = await db.insert(stems).values({ trackId, name: 'Drums', originalFileName: 'drums.wav', mimeType: 'audio/wav', fileSize: 100, fileKey: prefix + crypto.randomUUID(), createdById: owner }).returning();
  stemId = stem.id;
});

afterAll(async () => {
  mock.module('./storage/s3.js', () => storage);
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(eq(users.id, owner));
  await Promise.all([db.$client.end(), other.$client.end()]);
  if (directory) await rm(directory, { recursive: true, force: true });
});

const due = () => db.update(stemMixJobs).set({ requestedAt: new Date(0) }).where(eq(stemMixJobs.trackId, trackId));
const mixes = () => db.select().from(versions).where(eq(versions.trackId, trackId));

test('a batch becomes one playable V1, with MP3 and waveform through the existing processor', async () => {
  await queueStemMix(db, trackId, owner);
  await queueStemMix(db, trackId, owner);
  expect(await stemMixState(db, trackId)).toBe('pending');
  expect(await processNextStemMix(db, signal())).toBe(false);
  await due();
  expect(await processNextStemMix(db, signal())).toBe(true);
  const [version] = await mixes();
  expect(version).toMatchObject({ versionNumber: 1, autoMix: true, status: 'uploaded', mimeType: 'audio/wav' });
  expect(version.fileSize).toBeGreaterThan(100);
  expect(await stemMixState(db, trackId)).toBeNull();
  await processVersion(db, version.id, signal());
  const [ready] = await mixes();
  expect(ready).toMatchObject({ status: 'ready', sampleRate: 48000, bitDepth: 24 });
  expect(ready.duration).toBeCloseTo(0.2, 1);
  expect(outputs.has(ready.streamFileKey!)).toBe(true);
  expect(JSON.parse(await Bun.file(outputs.get(ready.waveformDataKey!)!).text()).length).toBeGreaterThan(0);
  expect(await db.select().from(audioJobs).where(eq(audioJobs.versionId, version.id))).toHaveLength(1);
});

test('replacing and restoring stems schedules V2 and V3 without changing the old audio', async () => {
  await queueStemMix(db, trackId, owner);
  await due();
  await processNextStemMix(db, signal());
  const [first] = await mixes();
  await replaceStem(db, stemId, owner, { originalFileName: 'new.wav', mimeType: 'audio/wav', fileSize: 200, fileKey: prefix + crypto.randomUUID() });
  await due();
  await processNextStemMix(db, signal());
  const [revision] = await db.select().from(stemRevisions).where(eq(stemRevisions.stemId, stemId));
  await restoreRevision(db, revision.id, owner);
  await due();
  await processNextStemMix(db, signal());
  const result = await mixes();
  expect(result.map((v) => v.versionNumber).sort()).toEqual([1, 2, 3]);
  expect(result.find((v) => v.id === first.id)?.originalFileKey).toBe(first.originalFileKey);
});

test('parallel workers publish only one version', async () => {
  await queueStemMix(db, trackId, owner);
  await due();
  await Promise.all([processNextStemMix(db, signal()), processNextStemMix(other, signal())]);
  expect(await mixes()).toHaveLength(1);
});

test('an edit during rendering discards the obsolete result and keeps the new job', async () => {
  await queueStemMix(db, trackId, owner);
  await due();
  const before = outputs.size;
  duringUpload = () => queueStemMix(other, trackId, owner);
  await processNextStemMix(db, signal());
  expect(await mixes()).toHaveLength(0);
  expect(outputs.size).toBe(before);
  expect(await stemMixState(db, trackId)).toBe('pending');
  duringUpload = undefined;
  await due();
  await processNextStemMix(db, signal());
  expect(await mixes()).toHaveLength(1);
});

test('empty stems discard the job; deleted and archived tracks keep it for their return', async () => {
  await queueStemMix(db, trackId, owner);
  await due();
  await db.update(stems).set({ deletedAt: new Date() }).where(eq(stems.id, stemId));
  await processNextStemMix(db, signal());
  expect(await stemMixState(db, trackId)).toBeNull();
  await db.update(stems).set({ deletedAt: null }).where(eq(stems.id, stemId));
  for (const unavailable of ['deleted', 'archived']) {
    await queueStemMix(db, trackId, owner);
    await due();
    if (unavailable === 'deleted') await db.update(tracks).set({ deletedAt: new Date() }).where(eq(tracks.id, trackId));
    if (unavailable === 'archived') await db.update(projects).set({ isArchived: true }).where(eq(projects.id, projectId));
    expect(await processNextStemMix(db, signal())).toBe(false);
    expect(await mixes()).toHaveLength(0);
    expect(await stemMixState(db, trackId)).toBe('pending');
    await db.update(tracks).set({ deletedAt: null }).where(eq(tracks.id, trackId));
    await db.update(projects).set({ isArchived: false }).where(eq(projects.id, projectId));
  }
  await processNextStemMix(db, signal());
  expect(await mixes()).toHaveLength(1);
});

test('restoring a track with an existing mix queues no extra version', async () => {
  await queueStemMix(db, trackId, owner);
  await due();
  await processNextStemMix(db, signal());
  await db.update(tracks).set({ deletedAt: new Date(), deletedById: owner }).where(eq(tracks.id, trackId));
  const token = generateToken();
  await db.insert(sessions).values({ userId: owner, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 60_000) });
  const app = new Hono<AppEnv>().use('*', async (c, next) => { c.set('db', db); await next(); }).route('/trash', trashRoutes);
  const res = await app.request(`/trash/track/${trackId}/restore`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(await stemMixState(db, trackId)).toBeNull();
  expect(await processNextStemMix(db, signal())).toBe(false);
  expect(await mixes()).toHaveLength(1);
});

test('MIDI, project and video attachments do not block real audio, including generic WAV uploads', async () => {
  await db.insert(stems).values([
    ...['audio/midi', 'video/mp4', 'application/octet-stream', 'audio/wav'].map((mimeType) => ({
      trackId, name: 'Attachment', originalFileName: 'project.logicx', mimeType, fileSize: 1,
      fileKey: prefix + 'non-audio-' + crypto.randomUUID(), createdById: owner,
    })),
    { trackId, name: 'Audio', originalFileName: 'take.wav', mimeType: 'application/octet-stream', fileSize: 100, fileKey: prefix + crypto.randomUUID(), createdById: owner },
    { trackId, name: 'Other audio', originalFileName: 'take.ogg', mimeType: 'application/octet-stream', fileSize: 100, fileKey: prefix + crypto.randomUUID(), createdById: owner },
  ]);
  await queueStemMix(db, trackId, owner);
  await due();
  await processNextStemMix(db, signal());
  expect(await mixes()).toHaveLength(1);
});

test('parallel transfers hold the batch until all finish; abandoned upload URLs expire', async () => {
  const first = prefix + crypto.randomUUID(), second = prefix + crypto.randomUUID();
  await holdStemMix(db, trackId, first);
  await holdStemMix(db, trackId, second);
  await replaceStem(db, stemId, owner, { originalFileName: 'take.wav', mimeType: 'audio/wav', fileSize: 100, fileKey: first });
  await due();
  expect(await processNextStemMix(db, signal())).toBe(false);
  expect(await mixes()).toHaveLength(0);
  await replaceStem(db, stemId, owner, { originalFileName: 'take2.wav', mimeType: 'audio/wav', fileSize: 100, fileKey: second });
  await due();
  await processNextStemMix(db, signal());
  expect(await mixes()).toHaveLength(1);

  await holdStemMix(db, trackId, prefix + crypto.randomUUID());
  await queueStemMix(db, trackId, owner);
  await due();
  expect(await processNextStemMix(db, signal())).toBe(false);
  await db.update(stemMixUploads).set({ expiresAt: new Date(0) }).where(eq(stemMixUploads.trackId, trackId));
  await processNextStemMix(db, signal());
  expect(await mixes()).toHaveLength(2);
});

test('a full account leaves no broken version and the failed job stays visible', async () => {
  await db.update(users).set({ storageLimit: 1 }).where(eq(users.id, owner));
  await queueStemMix(db, trackId, owner);
  await due();
  await processNextStemMix(db, signal());
  expect(await mixes()).toHaveLength(0);
  await db.update(stemMixJobs).set({ attempts: 3, lockedUntil: new Date(0) }).where(eq(stemMixJobs.trackId, trackId));
  expect(await stemMixState(db, trackId)).toBe('failed');
  await db.update(users).set({ storageLimit: null }).where(eq(users.id, owner));
});

test('catch-up finds stem-only tracks without changing existing version histories', async () => {
  const [fork] = await db.insert(tracks).values({ projectId, name: 'Free remix', createdById: owner, forkedFromId: trackId }).returning();
  await db.insert(stems).values({ trackId: fork.id, name: 'Drums', originalFileName: 'drums.wav', mimeType: 'audio/wav', fileSize: 100, fileKey: prefix + crypto.randomUUID(), forked: true, createdById: owner });
  await queueMissingStemMixes(db);
  const mine = await db.select().from(stemMixJobs).where(eq(stemMixJobs.createdById, owner));
  expect(mine.some((job) => job.trackId === trackId)).toBe(true);
  expect(mine.some((job) => job.trackId === fork.id)).toBe(false);
  await db.insert(stems).values({ trackId: fork.id, name: 'New take', originalFileName: 'new.wav', mimeType: 'audio/wav', fileSize: 100, fileKey: prefix + crypto.randomUUID(), createdById: owner });
  await queueMissingStemMixes(db);
  expect(await db.select().from(stemMixJobs).where(eq(stemMixJobs.trackId, fork.id))).toHaveLength(1);
  const idsWithVersions = db.select({ id: versions.trackId }).from(versions).where(eq(versions.createdById, owner));
  expect(await db.select().from(stemMixJobs).where(and(eq(stemMixJobs.createdById, owner), inArray(stemMixJobs.trackId, idsWithVersions)))).toHaveLength(0);
});

test('the real sum keeps stereo, follows the longest input and limits peaks', async () => {
  const loud = join(directory, 'loud.wav');
  const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.8|0.4:s=48000:d=0.4', '-y', loud], { stderr: 'ignore' });
  expect(await proc.exited).toBe(0);
  const mix = join(directory, 'sum.wav');
  await renderStemMix([loud, loud, tone], mix, signal());
  const decode = Bun.spawn(['ffmpeg', '-v', 'error', '-i', mix, '-f', 'f32le', 'pipe:1']);
  const samples = new Float32Array(await new Response(decode.stdout).arrayBuffer());
  expect(await decode.exited).toBe(0);
  expect(samples.length / 2 / 48000).toBeCloseTo(0.4, 2);
  const left = samples.filter((_, i) => i % 2 === 0);
  const right = samples.filter((_, i) => i % 2 === 1);
  expect(Math.max(...left)).toBeLessThanOrEqual(0.951);
  expect(left[5000]).toBeGreaterThan(right[5000]!);
  await expect(renderStemMix([loud], join(directory, 'limited.wav'), signal(), 10_000)).rejects.toThrow('complete stem mix');
});
