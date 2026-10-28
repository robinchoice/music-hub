import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { createDb, migrateDb, openTracks, projectMembers, projects, reviews, tracks, users, versions } from '@music-hub/db';
import { undoApproval } from './lib/approval.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const userIds: string[] = [];
let trackId: string;
let versionNumber = 0;

const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  return u.id;
};
const approvedBy = async (decidedById: string) => {
  const [v] = await db
    .insert(versions)
    .values({
      trackId,
      versionNumber: ++versionNumber,
      status: 'approved',
      decidedById,
      decidedAt: new Date(),
      originalFileName: 'mix.wav',
      mimeType: 'audio/wav',
      fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
      createdById: decidedById,
    })
    .returning();
  return v.id;
};

let owner: string, artist: string;
beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [owner, artist] = [await user('Robin'), await user('Lea')];
  const [project] = await db.insert(projects).values({ name: 'Fernlicht', createdById: owner }).returning();
  [{ id: trackId }] = await db.insert(tracks).values({ projectId: project.id, name: 'Nachtbus', createdById: owner }).returning();
  await db.insert(projectMembers).values([
    { projectId: project.id, userId: owner, role: 'owner', canApprove: true },
    { projectId: project.id, userId: artist, role: 'artist', canApprove: true },
  ]);
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('whoever approved can undo it, the version is ready again', async () => {
  const id = await approvedBy(owner);
  const undone = await undoApproval(db, id, owner);
  expect(undone).toMatchObject({ status: 'ready', decidedById: null, decidedAt: null });
  // A second undo finds nothing to undo
  expect(await undoApproval(db, id, owner)).toBeNull();
});

test('nobody else can undo an approval', async () => {
  const id = await approvedBy(owner);
  expect(await undoApproval(db, id, artist)).toBeNull();
  const [v] = await db.select().from(versions).where(eq(versions.id, id));
  expect(v.status).toBe('approved');
});

test('an approval stays once a request to open the track builds on it', async () => {
  const id = await approvedBy(owner);
  await db.insert(openTracks).values({ trackId, versionId: id, license: 'cc-by', requestedById: owner });
  expect(await undoApproval(db, id, owner)).toBeNull();
});

test('undoing the approval of a rejected version leaves it rejected', async () => {
  const rejectedAt = new Date(Date.now() - 60_000);
  const approvedAt = new Date();
  const id = await approvedBy(artist);
  await db.update(versions).set({ decidedAt: approvedAt }).where(eq(versions.id, id));
  await db.insert(reviews).values([
    { versionId: id, userId: owner, verdict: 'changes', note: 'Gesang lauter', createdAt: rejectedAt },
    { versionId: id, userId: artist, verdict: 'approve', createdAt: approvedAt },
  ]);
  const undone = await undoApproval(db, id, artist);
  expect(undone).toMatchObject({ status: 'rejected', decidedById: owner, decidedAt: rejectedAt });
});
