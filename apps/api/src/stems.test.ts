import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { createDb, migrateDb, projects, stemRevisions, stems, tracks, users } from '@music-hub/db';
import { replaceStem, restoreRevision } from './lib/stems.js';
import { storageOf } from './lib/storage.js';
import { deleteUnusedFiles } from './lib/trash.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const userIds: string[] = [];
let owner: string, drummer: string, stemId: string;

const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  return u.id;
};
const file = (name: string, fileSize: number) => ({
  originalFileName: `${name}.wav`,
  mimeType: 'audio/wav',
  fileKey: `test/${crypto.randomUUID()}/${name}.wav`,
  fileSize,
});

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [owner, drummer] = [await user('Robin'), await user('Kai')];
  const [project] = await db.insert(projects).values({ name: 'Fernlicht', createdById: owner }).returning();
  const [track] = await db.insert(tracks).values({ projectId: project.id, name: 'Nachtbus', createdById: owner }).returning();
  [{ id: stemId }] = await db
    .insert(stems)
    .values({ trackId: track.id, name: 'Drums', createdById: drummer, ...file('drums-take1', 1000) })
    .returning();
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('a new file keeps the earlier one in the history, and both count towards storage', async () => {
  const before = await db.select().from(stems).where(eq(stems.id, stemId));
  const stem = (await replaceStem(db, stemId, owner, file('drums-cut', 400)))!;

  expect(stem).toMatchObject({ id: stemId, name: 'Drums', originalFileName: 'drums-cut.wav', fileSize: 400, createdById: owner });
  expect(stem.revisedAt).not.toBeNull();
  const history = await db.select().from(stemRevisions).where(eq(stemRevisions.stemId, stemId));
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ fileKey: before[0].fileKey, fileSize: 1000, createdById: drummer, createdAt: before[0].createdAt });
  expect((await storageOf(db, owner)).used).toBe(400);
  expect((await storageOf(db, drummer)).used).toBe(1000);
});

test("a file that doesn't fit into storage changes nothing", async () => {
  await db.update(users).set({ storageLimit: 500 }).where(eq(users.id, owner));
  expect(await replaceStem(db, stemId, owner, file('too-big', 200))).toBeNull();
  expect(await db.select().from(stemRevisions).where(eq(stemRevisions.stemId, stemId))).toHaveLength(1);
  await db.update(users).set({ storageLimit: null }).where(eq(users.id, owner));
});

test('restoring swaps the files back, and earlier files are not deleted as unused', async () => {
  const [revision] = await db.select().from(stemRevisions).where(eq(stemRevisions.stemId, stemId));
  const [cut] = await db.select().from(stems).where(eq(stems.id, stemId));

  const stem = (await restoreRevision(db, revision.id))!;
  expect(stem).toMatchObject({ fileKey: revision.fileKey, fileSize: 1000, createdById: drummer });
  const history = await db.select().from(stemRevisions).where(eq(stemRevisions.stemId, stemId));
  expect(history.map((r) => r.fileKey)).toEqual([cut.fileKey]);
  expect(await restoreRevision(db, revision.id)).toBeNull();
  expect((await storageOf(db, owner)).used).toBe(400);

  // Still referenced by the history, so nothing to delete
  expect(await deleteUnusedFiles(db, [cut.fileKey])).toBe(0);
});

test('an earlier file in the trash still counts, once out of the trash it no longer does', async () => {
  const [revision] = await db.select().from(stemRevisions).where(eq(stemRevisions.stemId, stemId));
  await db.update(stemRevisions).set({ deletedAt: new Date(), deletedById: owner }).where(eq(stemRevisions.id, revision.id));
  expect((await storageOf(db, owner)).used).toBe(400);
  expect(await restoreRevision(db, revision.id)).toBeNull();

  await db.update(stemRevisions).set({ discardedAt: new Date() }).where(eq(stemRevisions.id, revision.id));
  expect((await storageOf(db, owner)).used).toBe(0);
});
