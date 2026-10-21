import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, stems, tracks, users, versions } from '@music-hub/db';
import { trashOf } from './routes/trash.js';
import { fileKeysOfTracks } from './lib/trash.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const userIds: string[] = [];
let robin: string, kai: string, own: string, foreign: string;

const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  return u.id;
};
const deletedStem = (trackId: string, name: string, createdById: string) => ({
  trackId,
  name,
  createdById,
  originalFileName: `${name}.wav`,
  mimeType: 'audio/wav',
  fileKey: `test/${crypto.randomUUID()}/${name}.wav`,
  fileSize: 100,
  deletedAt: new Date(),
});

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [robin, kai] = [await user('Robin'), await user('Kai')];
  [{ id: own }, { id: foreign }] = await db
    .insert(projects)
    .values([
      { name: 'Fernlicht', createdById: robin },
      { name: 'Kais Band', createdById: kai },
    ])
    .returning();
  await db.insert(projectMembers).values([
    { projectId: own, userId: robin, role: 'owner' },
    { projectId: foreign, userId: kai, role: 'owner' },
    { projectId: foreign, userId: robin, role: 'mixing_engineer' },
  ]);
  const [ownTrack, foreignTrack] = await db
    .insert(tracks)
    .values([
      { projectId: own, name: 'Nachtbus', createdById: robin },
      { projectId: foreign, name: 'Hafen', createdById: kai },
      { projectId: foreign, name: 'Weg', createdById: kai, deletedAt: new Date() },
    ])
    .returning();
  await db.insert(stems).values([
    deletedStem(ownTrack.id, 'Bass', kai),
    deletedStem(foreignTrack.id, 'Gitarre', robin),
    deletedStem(foreignTrack.id, 'Drums', kai),
  ]);
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test("the trash covers all projects, with each project's rights", async () => {
  const entries = await trashOf(db, robin);
  // Everything in the own project, in Kai's project only the own stem and not the deleted track
  expect(entries.map((e) => `${e.projectName}: ${e.kind === 'stem' ? e.name : e.kind}`).sort()).toEqual([
    'Fernlicht: Bass',
    'Kais Band: Gitarre',
  ]);
});

test('the trash of one project shows only that project', async () => {
  expect((await trashOf(db, robin, own)).map((e) => e.projectId)).toEqual([own]);
  expect(await trashOf(db, robin, crypto.randomUUID())).toEqual([]);
});

test('archived projects stay out of the trash', async () => {
  await db.update(projects).set({ isArchived: true }).where(eq(projects.id, own));
  try {
    expect((await trashOf(db, robin)).map((e) => e.projectId)).toEqual([foreign]);
    expect(await trashOf(db, robin, own)).toEqual([]);
  } finally {
    await db.update(projects).set({ isArchived: false }).where(eq(projects.id, own));
  }
});

test('the files of a track include its cover, its versions and the stems with their earlier files', async () => {
  const [track] = await db
    .insert(tracks)
    .values({ projectId: own, name: 'Cover', createdById: robin, coverImageUrl: 'covers/cover.png' })
    .returning();
  await db.insert(versions).values({
    trackId: track.id,
    versionNumber: 1,
    originalFileName: 'mix.wav',
    mimeType: 'audio/wav',
    fileSize: 100,
    originalFileKey: 'test/mix.wav',
    streamFileKey: 'test/mix.mp3',
    createdById: robin,
  });
  const [stem] = await db.insert(stems).values(deletedStem(track.id, 'Keys', robin)).returning();

  expect(await fileKeysOfTracks(db, [track.id])).toEqual(new Set(['covers/cover.png', 'test/mix.wav', 'test/mix.mp3', stem.fileKey]));
  expect(await fileKeysOfTracks(db, [])).toEqual(new Set());
});
