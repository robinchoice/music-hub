import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, stemRevisions, stems, tracks, users, versions } from '@music-hub/db';
import { replaceStem, restoreRevision } from './lib/stems.js';
import { syncState } from './lib/sync.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const userIds: string[] = [];
let robin: string, lena: string, projectId: string, trackId: string, stemId: string;
const hash = (c: string) => c.repeat(64);

const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  return u.id;
};
const file = (name: string, sha256?: string) => ({
  originalFileName: `${name}.wav`,
  mimeType: 'audio/wav',
  fileKey: `test/${crypto.randomUUID()}/${name}.wav`,
  fileSize: 1000,
  sha256,
});

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [robin, lena] = [await user('Robin'), await user('Lena')];
  const [project] = await db.insert(projects).values({ name: 'Tiefgang', createdById: robin }).returning();
  projectId = project.id;
  await db.insert(projectMembers).values({ projectId, userId: robin, role: 'owner', canUpload: true });
  const [archived] = await db.insert(projects).values({ name: 'Archiv', createdById: robin, isArchived: true }).returning();
  await db.insert(projectMembers).values({ projectId: archived.id, userId: robin, role: 'owner' });
  [{ id: trackId }] = await db.insert(tracks).values({ projectId, name: 'Nachtbus', createdById: robin }).returning();
  await db.insert(tracks).values({ projectId, name: 'Weg', createdById: robin, deletedAt: new Date(), deletedById: robin });
  const { fileKey, ...v } = file('mix', hash('a'));
  await db.insert(versions).values([
    { trackId, versionNumber: 1, label: 'Rough Mix', originalFileKey: fileKey, createdById: robin, ...v },
    { trackId, versionNumber: 2, originalFileKey: `test/${crypto.randomUUID()}/x.wav`, createdById: robin, ...v, sha256: null, deletedAt: new Date(), deletedById: robin },
  ]);
  [{ id: stemId }] = await db.insert(stems).values({ trackId, name: 'Drums', createdById: robin, ...file('drums', hash('b')) }).returning();
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('the state holds live projects, tracks, versions and stems with their hashes', async () => {
  const { projects: list } = await syncState(db, robin);
  expect(list.map((p) => p.name)).toEqual(['Tiefgang']);
  expect(list[0]).toMatchObject({ role: 'owner', canUpload: true });
  const [track, ...others] = list[0].tracks;
  expect(others).toHaveLength(0);
  expect(track.name).toBe('Nachtbus');
  expect(track.versions).toEqual([expect.objectContaining({ versionNumber: 1, label: 'Rough Mix', sha256: hash('a') })]);
  expect(track.stems).toEqual([expect.objectContaining({ id: stemId, name: 'Drums', sha256: hash('b') })]);
});

test('other people see nothing of projects they are not in', async () => {
  expect((await syncState(db, lena)).projects).toEqual([]);
});

test('a new file for a stem brings its hash along, and restoring brings the old one back', async () => {
  await replaceStem(db, stemId, robin, file('drums-cut', hash('c')));
  let [stem] = (await syncState(db, robin)).projects[0].tracks[0].stems;
  expect(stem.sha256).toBe(hash('c'));

  // A file without a hash doesn't keep the hash of the one before
  await replaceStem(db, stemId, robin, file('drums-web'));
  [stem] = (await syncState(db, robin)).projects[0].tracks[0].stems;
  expect(stem.sha256).toBeNull();

  const [first] = await db.select().from(stemRevisions).where(eq(stemRevisions.sha256, hash('b')));
  await restoreRevision(db, first.id);
  [stem] = (await syncState(db, robin)).projects[0].tracks[0].stems;
  expect(stem.sha256).toBe(hash('b'));
});
