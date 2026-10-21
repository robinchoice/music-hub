import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, rateLimits, sessions, tracks, users, versions } from '@music-hub/db';
import { generateToken, hashToken } from './middleware/auth.js';
import { versionRoutes } from './routes/versions.js';
import type { AppEnv } from './types.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/versions', versionRoutes);
const userIds: string[] = [];
const versionIds: string[] = [];
let projectId: string, trackId: string;
let owner: string, mixer: string, approver: string, artist: string;
const headers: Record<string, Record<string, string>> = {};

const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  headers[u.id] = { authorization: `Bearer ${token}` };
  return u.id;
};
const version = async (createdById: string) => {
  const [v] = await db
    .insert(versions)
    .values({
      trackId,
      versionNumber: versionIds.length + 1,
      status: 'ready',
      originalFileName: 'mix.wav',
      mimeType: 'audio/wav',
      fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
      createdById,
    })
    .returning();
  versionIds.push(v.id);
  return v.id;
};
const remind = (versionId: string, by: string, whom: string) =>
  app.request(`/versions/${versionId}/reviews/remind/${whom}`, { method: 'POST', headers: headers[by] });

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [owner, mixer, approver, artist] = [await user('Robin'), await user('Jonas'), await user('Mara'), await user('Lea')];
  const [project] = await db.insert(projects).values({ name: 'Fernlicht', createdById: owner }).returning();
  projectId = project.id;
  await db.insert(projectMembers).values([
    { projectId, userId: owner, role: 'owner', canUpload: true, canComment: true, canApprove: true },
    { projectId, userId: mixer, role: 'mixing_engineer', canUpload: true, canComment: true },
    { projectId, userId: approver, role: 'label', canComment: true, canApprove: true },
    { projectId, userId: artist, role: 'artist', canComment: true },
  ]);
  const [track] = await db.insert(tracks).values({ projectId, name: 'Nachtbus', createdById: owner }).returning();
  trackId = track.id;
});

afterAll(async () => {
  await db.delete(rateLimits).where(inArray(rateLimits.key, versionIds.flatMap((v) => userIds.map((u) => `review-reminders:${v}:${u}`))));
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('the uploader reminds an approver once an hour', async () => {
  const v = await version(mixer);
  expect((await remind(v, mixer, approver)).status).toBe(200);
  expect((await remind(v, mixer, approver)).status).toBe(429);
  // The owner may remind too, but the hour counts per version and person
  expect((await remind(v, owner, approver)).status).toBe(429);
  expect((await remind(v, owner, owner)).status).toBe(200);
});

test('only the uploader and the owner remind, and only approvers still missing', async () => {
  const v = await version(mixer);
  expect((await remind(v, approver, owner)).status).toBe(403);
  expect((await remind(v, artist, approver)).status).toBe(403);
  // Not an approver, or the uploader themselves
  expect((await remind(v, mixer, artist)).status).toBe(404);
  expect((await remind(v, owner, mixer)).status).toBe(404);
});

test('a decided version and an archived project take no reminders', async () => {
  const decided = await version(mixer);
  await db.update(versions).set({ status: 'approved' }).where(eq(versions.id, decided));
  expect((await remind(decided, mixer, approver)).status).toBe(404);

  const v = await version(mixer);
  await db.update(projects).set({ isArchived: true }).where(eq(projects.id, projectId));
  expect((await remind(v, mixer, approver)).status).toBe(403);
  await db.update(projects).set({ isArchived: false }).where(eq(projects.id, projectId));
});

test('a non-member hears nothing about the version', async () => {
  const v = await version(mixer);
  const stranger = await user('Fremd');
  expect((await remind(v, stranger, approver)).status).toBe(404);
});
