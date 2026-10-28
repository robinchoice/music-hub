import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { audioJobs, createDb, migrateDb, projects, tracks, users, versions } from '@music-hub/db';
import { analyzeNextVersion, parseMusicAnalysis } from './services/audio-processor.js';

// Lines as music-analysis.ts prints them (essentia.js 0.1.3)
const line = (bpm: number, bpmConfidence: number, key: string, scale: string, keyStrength: number) =>
  JSON.stringify({ bpm, bpmConfidence, key, scale, keyStrength });

test('keeps tempo and key of a mix', () => {
  expect(parseMusicAnalysis(line(84.2311, 2.82, 'D', 'minor', 0.86))).toEqual({ bpm: 84.2, keyRoot: 'D', keyScale: 'minor' });
});

test('drops a tempo Essentia only guessed, keeps a clear key', () => {
  // A sine tone: no beat, but plainly A
  expect(parseMusicAnalysis(line(112.35, 0.71, 'A', 'minor', 0.69))).toEqual({ bpm: null, keyRoot: 'A', keyScale: 'minor' });
});

test('silence has neither, although Essentia is confident about 738 BPM', () => {
  expect(parseMusicAnalysis(line(738.28, 4.59, 'A', 'minor', 0))).toEqual({ bpm: null, keyRoot: null, keyScale: null });
});

test('unexpected output has no values', () => {
  expect(parseMusicAnalysis(line(120, 3, 'H', 'minor', 0.9))).toBeNull();
  expect(parseMusicAnalysis('{}')).toBeNull();
});

// Runs against DATABASE_URL. ffmpeg and the analysis are replaced by small processes: the first
// spawn of a run decodes, the second analyses.
const db = createDb(process.env.DATABASE_URL!);
const spawn = Bun.spawn;
let userId: string;
let projectId: string;
let trackId: string;

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [{ id: userId }] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Test' }).returning({ id: users.id });
  [{ id: projectId }] = await db.insert(projects).values({ name: 'Test', createdById: userId }).returning({ id: projects.id });
  [{ id: trackId }] = await db.insert(tracks).values({ projectId, name: 'Test', createdById: userId }).returning({ id: tracks.id });
});

afterEach(() => { Bun.spawn = spawn; });

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(eq(users.id, userId));
  await db.$client.end();
});

// Dated ahead, so these come before any other version in the database
let versionNumber = 0;
async function version(values: Partial<typeof versions.$inferInsert>, daysAhead: number) {
  const [row] = await db.insert(versions).values({
    trackId, createdById: userId, versionNumber: ++versionNumber, status: 'ready',
    originalFileKey: `analysis-test/${crypto.randomUUID()}`, originalFileName: 'mix.wav', mimeType: 'audio/wav', fileSize: 1,
    createdAt: new Date(Date.now() + daysAhead * 86_400_000), ...values,
  }).returning();
  return row!;
}

function fakeAnalysis(script: string) {
  let calls = 0;
  Bun.spawn = ((_command: string[], options: object) =>
    spawn([process.execPath, '--eval', calls++ % 2 ? script : ''], options)) as typeof Bun.spawn;
}

const stored = async (id: string) => (await db.select().from(versions).where(eq(versions.id, id)))[0]!;

test('takes the newest playable version and stores what it found', async () => {
  const older = await version({}, 1000);
  const newer = await version({ status: 'approved' }, 1001);
  // Not playable yet or in the trash
  await version({ status: 'processing' }, 1002);
  await version({ deletedAt: new Date() }, 1003);
  fakeAnalysis(`console.log('${line(84.2, 2.8, 'D', 'minor', 0.86)}')`);

  expect(await analyzeNextVersion(db, new AbortController().signal)).toBe(true);
  expect(await stored(newer.id)).toMatchObject({ bpm: 84.2, keyRoot: 'D', keyScale: 'minor' });
  expect((await stored(newer.id)).analyzedAt).not.toBeNull();
  expect((await stored(older.id)).analyzedAt).toBeNull();

  expect(await analyzeNextVersion(db, new AbortController().signal)).toBe(true);
  expect((await stored(older.id)).analyzedAt).not.toBeNull();
});

test('a failed analysis leaves the version marked without values', async () => {
  const failing = await version({}, 2000);
  fakeAnalysis('process.exit(1)');
  expect(await analyzeNextVersion(db, new AbortController().signal)).toBe(true);
  expect(await stored(failing.id)).toMatchObject({ bpm: null, keyRoot: null });
  expect((await stored(failing.id)).analyzedAt).not.toBeNull();
});

test('gives way to a new upload and comes back to the version later', async () => {
  const waiting = await version({}, 3000);
  fakeAnalysis('setInterval(() => {}, 1000)');
  const upload = await version({ status: 'uploaded' }, 0);
  await db.insert(audioJobs).values({ versionId: upload.id });
  try {
    expect(await analyzeNextVersion(db, new AbortController().signal)).toBe(true);
    expect((await stored(waiting.id)).analyzedAt).toBeNull();
  } finally {
    await db.delete(audioJobs).where(eq(audioJobs.versionId, upload.id));
  }
}, 10_000);

test('a correction by hand during the analysis wins', async () => {
  const corrected = await version({}, 4000);
  fakeAnalysis(`setTimeout(() => console.log('${line(168.4, 2.8, 'D', 'minor', 0.86)}'), 1000)`);
  const analysis = analyzeNextVersion(db, new AbortController().signal);
  await Bun.sleep(300);
  // As PATCH /versions/:id stores it
  await db.update(versions).set({ bpm: 84, analyzedAt: new Date() }).where(eq(versions.id, corrected.id));
  expect(await analysis).toBe(true);
  expect(await stored(corrected.id)).toMatchObject({ bpm: 84, keyRoot: null });
}, 10_000);
