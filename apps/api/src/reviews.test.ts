import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { comments, createDb, migrateDb, projectMembers, projects, reviews, tracks, users, versions } from '@music-hub/db';
import { reviewsOf, submitReview, takeDueFeedback } from './lib/reviews.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const userIds: string[] = [];
let projectId: string;
let track: typeof tracks.$inferSelect;
let versionNumber = 0;

const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  return u.id;
};
const version = async (createdById: string) => {
  const [v] = await db
    .insert(versions)
    .values({
      trackId: track.id,
      versionNumber: ++versionNumber,
      status: 'ready',
      originalFileName: 'mix.wav',
      mimeType: 'audio/wav',
      fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
      createdById,
    })
    .returning();
  return v;
};
const comment = (versionId: string, by: { userId: string } | { guestName: string }, minutesAgo: number, body = 'Snare zu dünn') =>
  db.insert(comments).values({
    versionId,
    body,
    timestampSeconds: 42,
    ...by,
    createdAt: sql`now() - make_interval(mins => ${minutesAgo})` as unknown as Date,
  });
const summariesFor = async (versionId: string) =>
  db.select().from(reviews).where(and(eq(reviews.versionId, versionId), sql`${reviews.verdict} is null`));

let mixer: string, artist: string, label: string;
beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [mixer, artist, label] = [await user('Jonas'), await user('Mara'), await user('Tom')];
  const [project] = await db.insert(projects).values({ name: 'Nachtfalter', createdById: label }).returning();
  projectId = project.id;
  await db.insert(projectMembers).values([
    { projectId, userId: label, role: 'label', canApprove: true },
    { projectId, userId: mixer, role: 'mixing_engineer', canUpload: true },
    { projectId, userId: artist, role: 'artist', canApprove: true },
  ]);
  [track] = await db.insert(tracks).values({ projectId, name: 'Kein Zurück', createdById: label }).returning();
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('a review counts the comments since the previous one', async () => {
  const v = await version(mixer);
  await comment(v.id, { userId: artist }, 3);
  await comment(v.id, { userId: artist }, 2);
  const first = await submitReview(db, { version: v, track, author: { userId: artist }, authorName: 'Mara', verdict: 'notes', canApprove: true });
  expect(first.commentCount).toBe(2);

  await comment(v.id, { userId: artist }, 0);
  const second = await submitReview(db, { version: v, track, author: { userId: artist }, authorName: 'Mara', verdict: 'fine', canApprove: true });
  expect(second.commentCount).toBe(1);
});

test('approving and "Änderungen nötig" from an approver decide the version', async () => {
  const v = await version(mixer);
  await submitReview(db, { version: v, track, author: { userId: artist }, authorName: 'Mara', verdict: 'changes', note: 'Stimme lauter', canApprove: true });
  expect((await db.select().from(versions).where(eq(versions.id, v.id)))[0]).toMatchObject({ status: 'rejected', decidedById: artist });

  await submitReview(db, { version: v, track, author: { userId: label }, authorName: 'Tom', verdict: 'approve', canApprove: true });
  expect((await db.select().from(versions).where(eq(versions.id, v.id)))[0]).toMatchObject({ status: 'approved', decidedById: label });
});

test('"Änderungen nötig" from someone who may not approve leaves the version as it is', async () => {
  const v = await version(artist);
  await submitReview(db, { version: v, track, author: { userId: mixer }, authorName: 'Jonas', verdict: 'changes', canApprove: false });
  expect((await db.select().from(versions).where(eq(versions.id, v.id)))[0].status).toBe('ready');
});

test('a forgotten pass goes out once after the quiet time, guests included', async () => {
  const v = await version(mixer);
  await comment(v.id, { userId: artist }, 20);
  await comment(v.id, { userId: artist }, 16);
  await comment(v.id, { guestName: 'Lena' }, 18);
  // Still typing: too recent to send
  await comment(v.id, { userId: label }, 5);
  // The uploader's own comments never notify them
  await comment(v.id, { userId: mixer }, 30);

  const taken = (await takeDueFeedback(db)).filter((t) => t.versionId === v.id);
  expect(taken.map((t) => ({ author: t.author, count: t.comments.length }))).toEqual(
    expect.arrayContaining([
      { author: { userId: artist }, count: 2 },
      { author: { guestName: 'Lena' }, count: 1 },
    ]),
  );
  expect(taken).toHaveLength(2);
  expect(await summariesFor(v.id)).toHaveLength(2);

  // Taken once: the next round finds nothing for these passes
  expect((await takeDueFeedback(db)).filter((t) => t.versionId === v.id)).toHaveLength(0);
});

test('old threads stay quiet', async () => {
  const v = await version(mixer);
  await comment(v.id, { userId: artist }, 300);
  expect((await takeDueFeedback(db)).filter((t) => t.versionId === v.id)).toHaveLength(0);
});

test('approvers without feedback are listed as waiting, the uploader is not', async () => {
  const v = await version(artist);
  let { waiting } = await reviewsOf(db, v, projectId);
  expect(waiting.map((w) => w.id)).toEqual([label]);

  await submitReview(db, { version: v, track, author: { userId: label }, authorName: 'Tom', verdict: 'notes', canApprove: true });
  ({ waiting } = await reviewsOf(db, v, projectId));
  expect(waiting).toHaveLength(0);
});
