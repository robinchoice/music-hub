import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { comments, createDb, migrateDb, projectMembers, projects, sessions, tracks, users, versions } from '@music-hub/db';
import { generateToken, hashToken } from './middleware/auth.js';
import type { AppEnv } from './types.js';

const s3 = await import('./storage/s3.js');
mock.module('./storage/s3.js', () => ({ ...s3, createDownloadUrl: async () => 'https://bucket.test/get' }));
const { shareRoutes } = await import('./routes/share.js');

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/share', shareRoutes);
const userIds: string[] = [];
let owner: string, headers: Record<string, string>;
let projectId: string;

const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const newTrack = async () => {
  const [t] = await db.insert(tracks).values({ projectId, name: 'Nachtbus', createdById: owner }).returning();
  return t.id;
};
const version = async (trackId: string, versionNumber: number, status: 'ready' | 'approved' | 'processing' = 'ready') => {
  const [v] = await db
    .insert(versions)
    .values({
      trackId,
      versionNumber,
      status,
      originalFileName: `mix-${versionNumber}.wav`,
      mimeType: 'audio/wav',
      fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
      createdById: owner,
    })
    .returning();
  return v.id;
};
const share = async (versionId: string, follows?: string) => {
  const res = await call(`/share/version/${versionId}`, { method: 'POST', body: { follows }, headers });
  expect(res.status).toBe(201);
  return ((await res.json()) as { link: { token: string; follows: string } }).link;
};
const shown = async (token: string) => {
  const res = await call(`/share/public/${token}`);
  return res.status === 200 ? ((await res.json()) as { version: { versionNumber: number } }).version.versionNumber : res.status;
};

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Robin' }).returning();
  userIds.push(u.id);
  owner = u.id;
  const token = generateToken();
  await db.insert(sessions).values({ userId: owner, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  headers = { authorization: `Bearer ${token}` };
  const [project] = await db.insert(projects).values({ name: 'Fernlicht', createdById: owner }).returning();
  projectId = project.id;
  await db.insert(projectMembers).values({ projectId, userId: owner, role: 'owner', canUpload: true, canComment: true, canApprove: true });
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('a link for a version keeps playing it, one that follows the track plays the newest', async () => {
  const trackId = await newTrack();
  const v1 = await version(trackId, 1);
  const fixed = await share(v1);
  const latest = await share(v1, 'latest');
  expect(fixed.follows).toBe('version');

  await version(trackId, 2);
  // Still processing, so not yet playable
  const v3 = await version(trackId, 3, 'processing');
  expect(await shown(fixed.token)).toBe(1);
  expect(await shown(latest.token)).toBe(2);

  await db.update(versions).set({ status: 'ready' }).where(eq(versions.id, v3));
  expect(await shown(latest.token)).toBe(3);
  // A version in the trash drops out
  await db.update(versions).set({ deletedAt: new Date() }).where(eq(versions.id, v3));
  expect(await shown(latest.token)).toBe(2);
});

test('a link that follows approvals pauses until one is approved', async () => {
  const trackId = await newTrack();
  const v1 = await version(trackId, 1);
  const approved = await share(v1, 'approved');
  expect(await shown(approved.token)).toBe(410);

  await db.update(versions).set({ status: 'approved' }).where(eq(versions.id, v1));
  await version(trackId, 2);
  expect(await shown(approved.token)).toBe(1);
});

test('guests comment on the version the link shows and are told when it moved on', async () => {
  const trackId = await newTrack();
  const v1 = await version(trackId, 1);
  const latest = await share(v1, 'latest');
  const v2 = await version(trackId, 2);

  const post = (versionId?: string) =>
    call(`/share/public/${latest.token}/comments`, { method: 'POST', body: { body: 'Schön', guestName: 'Tom', versionId } });
  expect((await post(v2)).status).toBe(201);
  expect((await db.select().from(comments).where(eq(comments.versionId, v2))).length).toBe(1);
  // The page still showed V1
  expect((await post(v1)).status).toBe(409);
  const review = await call(`/share/public/${latest.token}/review`, { method: 'POST', body: { verdict: 'fine', guestName: 'Tom', versionId: v1 } });
  expect(review.status).toBe(409);
});

test('links that follow the track are listed at every version of it', async () => {
  const trackId = await newTrack();
  const v1 = await version(trackId, 1);
  await share(v1);
  const latest = await share(v1, 'latest');
  const v2 = await version(trackId, 2);
  const res = await call(`/share/version/${v2}`, { headers });
  const { links } = (await res.json()) as { links: { token: string; follows: string }[] };
  expect(links.map((l) => l.token)).toEqual([latest.token]);
});

test('a link that follows the track outlives the version it was made on, a version link goes with it', async () => {
  const { keepFollowingLinks } = await import('./lib/trash.js');
  const trackId = await newTrack();
  const v1 = await version(trackId, 1);
  const fixed = await share(v1);
  const latest = await share(v1, 'latest');
  await version(trackId, 2);

  // What purgeTrash does with V1 once it leaves the trash for good
  await keepFollowingLinks(db, [{ id: v1, trackId }]);
  await db.delete(versions).where(eq(versions.id, v1));
  expect(await shown(latest.token)).toBe(2);
  expect(await shown(fixed.token)).toBe(404);
});

test('without the version they heard, guests of a following link are asked to reload', async () => {
  const trackId = await newTrack();
  const v1 = await version(trackId, 1);
  const fixed = await share(v1);
  const latest = await share(v1, 'latest');
  const body = { body: 'Schön', guestName: 'Tom' };
  expect((await call(`/share/public/${fixed.token}/comments`, { method: 'POST', body })).status).toBe(201);
  expect((await call(`/share/public/${latest.token}/comments`, { method: 'POST', body })).status).toBe(409);
});
