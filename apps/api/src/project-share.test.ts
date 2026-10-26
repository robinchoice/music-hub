import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, sessions, tracks, users, versions } from '@music-hub/db';
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

type Link = { id: string; token: string; allowComments: boolean; allowDownload: boolean; hasPassword: boolean; trackIds: string[] | null };
type Album = { project: { name: string }; allowComments: boolean; tracks: { id: string; name: string; token: string; version: { versionNumber: number }; comments: number }[] };

const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });

async function person(name: string) {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  return { id: u.id, headers: { authorization: `Bearer ${token}` } };
}

async function project(ownerId: string) {
  const [p] = await db.insert(projects).values({ name: 'Nachtbus EP', artist: 'Fernlicht', createdById: ownerId }).returning();
  await db.insert(projectMembers).values({ projectId: p.id, userId: ownerId, role: 'owner', canUpload: true, canComment: true, canApprove: true });
  return p.id;
}

async function track(projectId: string, createdById: string, name: string, sortOrder: number, status?: 'ready' | 'approved' | 'processing') {
  const [t] = await db.insert(tracks).values({ projectId, name, sortOrder, createdById }).returning();
  if (status) {
    await db.insert(versions).values({
      trackId: t.id,
      versionNumber: 1,
      status,
      originalFileName: 'mix.wav',
      mimeType: 'audio/wav',
      fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
      createdById,
    });
  }
  return t.id;
}

const album = async (token: string, headers: Record<string, string> = {}) => {
  const res = await call(`/share/project/public/${token}`, { headers });
  return res.status === 200 ? ((await res.json()) as Album) : res.status;
};

let owner: Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  owner = await person('Robin');
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('one link per person plays every playable track in order, each through a track link', async () => {
  const projectId = await project(owner.id);
  const second = await track(projectId, owner.id, 'Kreise', 2, 'ready');
  const first = await track(projectId, owner.id, 'Nachtbus', 1, 'ready');
  await track(projectId, owner.id, 'Halbmond', 3, 'processing');
  await track(projectId, owner.id, 'Ohne Version', 4);

  const created = await call(`/share/project/${projectId}`, { method: 'POST', body: {}, headers: owner.headers });
  expect(created.status).toBe(201);
  const { link } = (await created.json()) as { link: Link };
  const again = await call(`/share/project/${projectId}`, { method: 'POST', body: {}, headers: owner.headers });
  expect(((await again.json()) as { link: Link }).link.id).toBe(link.id);
  const own = await call(`/share/project/${projectId}`, { headers: owner.headers });
  expect(((await own.json()) as { link: Link }).link.token).toBe(link.token);

  const shown = await album(link.token);
  if (typeof shown === 'number') throw new Error(`album answered ${shown}`);
  expect(shown.project.name).toBe('Nachtbus EP');
  expect(shown.tracks.map((t) => t.id)).toEqual([first, second]);
  // Opening the page again keeps the track links
  const again2 = await album(link.token);
  if (typeof again2 === 'number') throw new Error(`album answered ${again2}`);
  expect(again2.tracks.map((t) => t.token)).toEqual(shown.tracks.map((t) => t.token));

  const res = await call(`/share/public/${shown.tracks[0].token}`);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { track: { name: string } }).track.name).toBe('Nachtbus');

  // The track's own share dialog does not list them
  const [v] = await db.select({ id: versions.id }).from(versions).where(eq(versions.trackId, first));
  const listed = await call(`/share/version/${v.id}`, { headers: owner.headers });
  expect(((await listed.json()) as { links: unknown[] }).links).toEqual([]);
});

test('settings reach the track links and a selection leaves the other tracks out', async () => {
  const projectId = await project(owner.id);
  const keep = await track(projectId, owner.id, 'Nachtbus', 1, 'ready');
  await track(projectId, owner.id, 'Kreise', 2, 'ready');
  const created = await call(`/share/project/${projectId}`, { method: 'POST', body: {}, headers: owner.headers });
  const { link } = (await created.json()) as { link: Link };
  const before = await album(link.token);
  if (typeof before === 'number') throw new Error(`album answered ${before}`);
  const dropped = before.tracks[1].token;

  const patched = await call(`/share/project-link/${link.id}`, {
    method: 'PATCH',
    body: { password: 'nachtbus', trackIds: [keep], allowComments: false },
    headers: owner.headers,
  });
  expect(patched.status).toBe(200);
  expect(((await patched.json()) as { link: Link }).link.hasPassword).toBe(true);

  expect(await album(link.token)).toBe(401);
  const after = await album(link.token, { 'x-share-password': 'nachtbus' });
  if (typeof after === 'number') throw new Error(`album answered ${after}`);
  expect(after.tracks.map((t) => t.id)).toEqual([keep]);
  expect(after.allowComments).toBe(false);

  // The track link asks for the same password and takes no comments
  const token = after.tracks[0].token;
  expect((await call(`/share/public/${token}`)).status).toBe(401);
  const comment = await call(`/share/public/${token}/comments`, {
    method: 'POST',
    body: { body: 'Schön', guestName: 'Mara' },
    headers: { 'x-share-password': 'nachtbus' },
  });
  expect(comment.status).toBe(403);
  // The track that left the selection lost its link
  expect((await call(`/share/public/${dropped}`)).status).toBe(404);

  const cleared = await call(`/share/project-link/${link.id}`, { method: 'PATCH', body: { password: null, trackIds: null }, headers: owner.headers });
  expect(cleared.status).toBe(200);
  const all = await album(link.token);
  if (typeof all === 'number') throw new Error(`album answered ${all}`);
  expect(all.tracks).toHaveLength(2);
});

test('a link grants no more than its creator may, and only the creator or the owner manages it', async () => {
  const projectId = await project(owner.id);
  await track(projectId, owner.id, 'Nachtbus', 1, 'ready');
  const viewer = await person('Lea');
  const stranger = await person('Tom');
  await db.insert(projectMembers).values({ projectId, userId: viewer.id, role: 'viewer', canUpload: false, canComment: false, canApprove: false });

  const created = await call(`/share/project/${projectId}`, { method: 'POST', body: { allowDownload: true }, headers: viewer.headers });
  const { link } = (await created.json()) as { link: Link };
  expect(link.allowDownload).toBe(false);
  expect(link.allowComments).toBe(false);

  expect((await call(`/share/project/${projectId}`, { headers: stranger.headers })).status).toBe(404);
  expect((await call(`/share/project/${projectId}`, { method: 'POST', body: {}, headers: stranger.headers })).status).toBe(403);
  expect((await call(`/share/project-link/${link.id}`, { method: 'PATCH', body: { allowComments: true }, headers: owner.headers })).status).toBe(404);
  expect((await call(`/share/project-link/${link.id}`, { method: 'DELETE', headers: stranger.headers })).status).toBe(403);

  const shown = await album(link.token);
  if (typeof shown === 'number') throw new Error(`album answered ${shown}`);
  // The owner revokes it, the track links go with it
  expect((await call(`/share/project-link/${link.id}`, { method: 'DELETE', headers: owner.headers })).status).toBe(200);
  expect(await album(link.token)).toBe(404);
  expect((await call(`/share/public/${shown.tracks[0].token}`)).status).toBe(404);
});

test('a link pauses while its creator is out of the project', async () => {
  const projectId = await project(owner.id);
  await track(projectId, owner.id, 'Nachtbus', 1, 'ready');
  const mixer = await person('Lea');
  await db.insert(projectMembers).values({ projectId, userId: mixer.id, role: 'mixing_engineer', canUpload: true, canComment: true, canApprove: false });
  const created = await call(`/share/project/${projectId}`, { method: 'POST', body: {}, headers: mixer.headers });
  const { link } = (await created.json()) as { link: Link };
  expect(typeof (await album(link.token))).toBe('object');

  await db.delete(projectMembers).where(eq(projectMembers.userId, mixer.id));
  expect(await album(link.token)).toBe(410);
});
