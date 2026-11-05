import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { inArray, like } from 'drizzle-orm';
import { createDb, migrateDb, projectFiles, projects, stems, tracks, users, versions } from '@music-hub/db';

// Uploads nobody registered leave the bucket after a week; anything a row points to stays. Runs against DATABASE_URL
// with rows of its own, the bucket is a list in memory.
const storage = { ...await import('./storage/s3.js') };
const db = createDb(process.env.DATABASE_URL!);
const run = crypto.randomUUID();
const now = new Date('2026-11-20T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);
let bucket: { key: string; size: number; lastModified: Date }[] = [];
const removed: string[] = [];
let userId: string;
let sweepAbandonedUploads: typeof import('./lib/upload-sweep.js').sweepAbandonedUploads;

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  mock.module('./storage/s3.js', () => ({
    ...storage,
    listObjects: async function* (prefix: string) {
      yield bucket.filter((o) => o.key.startsWith(prefix));
    },
    deleteObject: async (key: string) => {
      removed.push(key);
    },
  }));
  ({ sweepAbandonedUploads } = await import('./lib/upload-sweep.js'));
  const [u] = await db.insert(users).values({ email: `test-${run}@example.com`, name: 'Robin' }).returning();
  userId = u.id;
});

afterAll(async () => {
  mock.module('./storage/s3.js', () => storage);
  await db.delete(projects).where(inArray(projects.createdById, [userId]));
  await db.delete(users).where(like(users.email, `%${run}%`));
  await db.$client.end();
});

test('only old upload keys without a row are swept, and only once deleting is on', async () => {
  const [project] = await db.insert(projects).values({ name: 'Werbespot', createdById: userId }).returning();
  const [track] = await db.insert(tracks).values({ projectId: project.id, name: 'Roller', createdById: userId }).returning();
  const p = `projects/${project.id}`;
  const t = `${p}/tracks/${track.id}`;
  const key = {
    version: `${t}/versions/${crypto.randomUUID()}/original/mix.wav`,
    stem: `${p}/uploads/${crypto.randomUUID()}/original/kick.wav`,
    file: `${p}/uploads/${crypto.randomUUID()}/file/Kreise.als`,
    lostFile: `${p}/uploads/${crypto.randomUUID()}/file/notes.pdf`,
    unlistable: `${p}/uploads/${crypto.randomUUID()}/original/a\rb.wav`,
    lostUpload: `${p}/uploads/${crypto.randomUUID()}/original/vox.wav`,
    lostStem: `${t}/stems/${crypto.randomUUID()}/bass.wav`,
    lostOriginal: `${t}/versions/${crypto.randomUUID()}/original/v2.wav`,
    fresh: `${p}/uploads/${crypto.randomUUID()}/original/snare.wav`,
    mp3: `${t}/versions/${crypto.randomUUID()}/stream/audio.mp3`,
  };
  await db.insert(versions).values({
    trackId: track.id, versionNumber: 1, originalFileName: 'mix.wav', mimeType: 'audio/wav', fileSize: 10, originalFileKey: key.version, createdById: userId,
  });
  // In the trash, so still pointed to
  await db.insert(stems).values({
    trackId: track.id, name: 'Kick', originalFileName: 'kick.wav', mimeType: 'audio/wav', fileSize: 10, fileKey: key.stem, createdById: userId, deletedAt: daysAgo(3),
  });
  await db.insert(projectFiles).values({
    projectId: project.id, originalFileName: 'Kreise.als', mimeType: 'application/octet-stream', fileSize: 10, fileKey: key.file, createdById: userId,
  });
  bucket = Object.entries(key).map(([name, k]) => ({ key: k, size: 1024 ** 2, lastModified: name === 'fresh' ? daysAgo(6) : daysAgo(8) }));

  expect(await sweepAbandonedUploads(db, { now })).toEqual({ found: 4, bytes: 4 * 1024 ** 2, deleted: 0 });
  expect(removed).toEqual([]);

  expect(await sweepAbandonedUploads(db, { now, deletes: true })).toMatchObject({ found: 4, deleted: 4 });
  expect(removed.sort()).toEqual([key.lostUpload, key.lostFile, key.lostStem, key.lostOriginal].sort());
});
