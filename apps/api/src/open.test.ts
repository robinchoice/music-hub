import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, stems, tracks, users, versions } from '@music-hub/db';
import { allowedLicenses, consentToOpen, forkTrack, liveOpenTrack, openStateOf, openStems, remixesOf, requestOpen } from './lib/open.js';
import { storageOf } from './lib/storage.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const userIds: string[] = [];
let owner: string, singer: string, remixer: string;
let bandProject: string, remixProject: string, trackId: string;

const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  return u.id;
};
const stem = (createdById: string, name: string, createdAt = new Date(Date.now() - 60_000)) => ({
  trackId,
  name,
  originalFileName: `${name}.wav`,
  mimeType: 'audio/wav',
  fileSize: 1000,
  fileKey: `test/${crypto.randomUUID()}/${name}.wav`,
  createdById,
  createdAt,
});

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [owner, singer, remixer] = [await user('Robin'), await user('Lea'), await user('Mara')];
  [{ id: bandProject }] = await db.insert(projects).values({ name: 'Fernlicht', artist: 'Fernlicht', createdById: owner }).returning();
  [{ id: remixProject }] = await db.insert(projects).values({ name: 'Mara solo', createdById: remixer }).returning();
  await db.insert(projectMembers).values([
    { projectId: bandProject, userId: owner, role: 'owner', canUpload: true },
    { projectId: bandProject, userId: singer, role: 'artist', canUpload: true },
    { projectId: remixProject, userId: remixer, role: 'owner', canUpload: true },
  ]);
  [{ id: trackId }] = await db.insert(tracks).values({ projectId: bandProject, name: 'Nachtbus', createdById: owner }).returning();
  await db.insert(versions).values({
    trackId,
    versionNumber: 1,
    status: 'approved',
    originalFileName: 'mix.wav',
    mimeType: 'audio/wav',
    fileSize: 5000,
    originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
    createdById: owner,
  });
  await db.insert(stems).values([stem(owner, 'Drums'), stem(singer, 'Vocals')]);
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('a track opens once everyone who uploaded to it agreed', async () => {
  expect(await requestOpen(db, trackId, owner, 'cc-by-sa')).toEqual({ opened: false });
  const pending = await openStateOf(db, trackId);
  expect(pending.contributors.map((p) => [p.name, p.consented])).toEqual([
    ['Lea', false],
    ['Robin', true],
  ]);
  expect(await liveOpenTrack(db, trackId)).toBeUndefined();

  expect(await consentToOpen(db, trackId, remixer)).toBeNull();
  expect(await consentToOpen(db, trackId, singer)).toEqual({ opened: true });
  expect((await liveOpenTrack(db, trackId))?.open.license).toBe('cc-by-sa');
});

test('stems uploaded after opening stay private', async () => {
  await db.insert(stems).values(stem(owner, 'Later', new Date(Date.now() + 1000)));
  const { open } = (await liveOpenTrack(db, trackId))!;
  expect((await openStems(db, trackId, open.openedAt!)).map((s) => s.name).sort()).toEqual(['Drums', 'Vocals']);
});

test('a remix shares the files, costs no storage and carries license and credit', async () => {
  expect(await forkTrack(db, trackId, remixer, bandProject)).toBeNull();
  const remix = (await forkTrack(db, trackId, remixer, remixProject))!;

  expect(remix.forkedFromId).toBe(trackId);
  expect(remix.license).toBe('cc-by-sa');
  expect(remix.credit).toContain('„Nachtbus“ von Fernlicht (Lea, Robin) · CC BY-SA 4.0');
  const copied = await db.select().from(stems).where(eq(stems.trackId, remix.id));
  const original = await db.select().from(stems).where(eq(stems.trackId, trackId));
  expect(copied).toHaveLength(2);
  expect(copied.every((s) => s.forked && original.some((o) => o.fileKey === s.fileKey))).toBe(true);
  expect((await storageOf(db, remixer)).used).toBe(0);

  // Share-alike: the remix can only open under the same license, and nobody is asked about the taken-over stems
  expect(allowedLicenses(remix.license)).toEqual(['cc-by-sa']);
  expect((await openStateOf(db, remix.id)).contributors).toHaveLength(0);

  expect(await remixesOf(db, trackId)).toEqual({ count: 1, open: [] });
});
