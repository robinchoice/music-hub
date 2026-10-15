import { afterAll, beforeAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { comments, createDb, migrateDb, projects, tracks, users, versions } from '@music-hub/db';
import { reactionsOf, toggleReaction } from './lib/reactions.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const userIds: string[] = [];
let commentId: string;
let mara: string, jonas: string;

const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  return u.id;
};

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [mara, jonas] = [await user('Mara'), await user('Jonas')];
  const [project] = await db.insert(projects).values({ name: 'Nachtfalter', createdById: mara }).returning();
  const [track] = await db.insert(tracks).values({ projectId: project.id, name: 'Kein Zurück', createdById: mara }).returning();
  const [v] = await db
    .insert(versions)
    .values({
      trackId: track.id,
      versionNumber: 1,
      status: 'ready',
      originalFileName: 'mix.wav',
      mimeType: 'audio/wav',
      fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
      createdById: mara,
    })
    .returning();
  [{ id: commentId }] = await db.insert(comments).values({ versionId: v.id, userId: jonas, body: 'Bass sitzt' }).returning();
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('reacting again takes the reaction back', async () => {
  expect(await toggleReaction(db, commentId, mara, '👍')).toBe(true);
  expect(await toggleReaction(db, commentId, mara, '👍')).toBe(false);
  expect((await reactionsOf(db, [commentId])).get(commentId)).toBeUndefined();
});

test('reactions group by emoji in picker order, people in the order they reacted', async () => {
  await toggleReaction(db, commentId, jonas, '🔥');
  await toggleReaction(db, commentId, mara, '👍');
  await toggleReaction(db, commentId, jonas, '👍');
  expect((await reactionsOf(db, [commentId])).get(commentId)).toEqual([
    { emoji: '👍', users: [{ id: mara, name: 'Mara' }, { id: jonas, name: 'Jonas' }] },
    { emoji: '🔥', users: [{ id: jonas, name: 'Jonas' }] },
  ]);
});
