import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb, guestNotes, migrateDb, projectMembers, projects, sessions, stems, tracks, users } from '@music-hub/db';
import { generateToken, hashToken } from './middleware/auth.js';
import { guestStorageOf, storageOf } from './lib/storage.js';
import { replaceStem } from './lib/stems.js';
import type { AppEnv } from './types.js';

// No bucket needed: every uploaded file is 1234 bytes. The rest of the module stays real for other test files.
const s3 = await import('./storage/s3.js');
mock.module('./storage/s3.js', () => ({
  ...s3,
  createUploadUrl: async () => 'https://bucket.test/put',
  getObjectSize: async () => 1234,
}));
const { uploadLinkRoutes } = await import('./routes/upload-links.js');

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.set('db', db);
    await next();
  })
  .route('/upload-links', uploadLinkRoutes);
const userIds: string[] = [];
let owner: string, viewer: string, projectId: string, otherTrackId: string;

const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  return u.id;
};
const sessionOf = async (userId: string) => {
  const token = generateToken();
  await db.insert(sessions).values({ userId, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 60_000) });
  return { authorization: `Bearer ${token}` };
};
const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(`/upload-links${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body ? JSON.stringify(init.body) : null,
  });

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [owner, viewer] = [await user('Robin'), await user('Lisa')];
  const [project] = await db.insert(projects).values({ name: 'Fernlicht', artist: 'Tiefgang', createdById: owner }).returning();
  projectId = project.id;
  await db.insert(projectMembers).values([
    { projectId, userId: owner, role: 'owner', canUpload: true },
    { projectId, userId: viewer, role: 'viewer', canUpload: false },
  ]);
  await db.insert(tracks).values({ projectId, name: 'Nachtbus', createdById: owner });
  const [other] = await db.insert(projects).values({ name: 'Anderes', createdById: owner }).returning();
  [{ id: otherTrackId }] = await db.insert(tracks).values({ projectId: other.id, name: 'Fremd', createdById: owner }).returning();
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('only members who may upload create the link, and a new one replaces the old', async () => {
  expect((await call(`/project/${projectId}`, { method: 'POST', headers: await sessionOf(viewer) })).status).toBe(403);

  const headers = await sessionOf(owner);
  const first = (await (await call(`/project/${projectId}`, { method: 'POST', headers })).json()).link;
  const second = (await (await call(`/project/${projectId}`, { method: 'POST', headers })).json()).link;
  expect(second.token).not.toBe(first.token);
  expect(second.createdByName).toBe('Robin');
  expect((await call(`/public/${first.token}`)).status).toBe(404);
  expect((await call(`/public/${second.token}`)).status).toBe(200);
});

test('a guest adds a song and stems, which count towards the storage of the link creator', async () => {
  const { link } = await (await call(`/project/${projectId}`, { headers: await sessionOf(owner) })).json();
  const page = await (await call(`/public/${link.token}`)).json();
  expect(page).toMatchObject({ project: { name: 'Fernlicht', artist: 'Tiefgang' }, invitedBy: 'Robin', tracks: [{ name: 'Nachtbus' }] });

  const { track } = await (await call(`/public/${link.token}/tracks`, { method: 'POST', body: { name: 'Kreide' } })).json();
  const [created] = await db.select().from(tracks).where(eq(tracks.id, track.id));
  expect(created).toMatchObject({ projectId, createdById: owner, status: 'sketch' });

  const file = { fileName: 'drums.wav', mimeType: 'audio/wav', fileSize: 1000 };
  const { fileKey } = await (await call(`/public/${link.token}/track/${track.id}/upload-url`, { method: 'POST', body: file })).json();
  const stem = { fileKey, name: 'Drums', originalFileName: 'drums.wav', mimeType: 'audio/wav', fileSize: 1, guestName: 'Kai' };
  const res = await call(`/public/${link.token}/track/${track.id}`, { method: 'POST', body: stem });
  expect(res.status).toBe(201);

  const [row] = await db.select().from(stems).where(eq(stems.trackId, track.id));
  expect(row).toMatchObject({ name: 'Drums', guestName: 'Kai', createdById: owner, fileSize: 1234 });
  expect((await storageOf(db, owner)).used).toBe(1234);

  // The same file can't be registered twice, and tracks of other projects are out of reach
  expect((await call(`/public/${link.token}/track/${track.id}`, { method: 'POST', body: stem })).status).toBe(403);
  expect((await call(`/public/${link.token}/track/${otherTrackId}/upload-url`, { method: 'POST', body: file })).status).toBe(404);
});

test('the link stops working when it is switched off, the project is archived or its creator may no longer upload', async () => {
  const headers = await sessionOf(owner);
  const token = async () => (await (await call(`/project/${projectId}`, { method: 'POST', headers })).json()).link.token as string;

  let t = await token();
  await db.update(projects).set({ isArchived: true }).where(eq(projects.id, projectId));
  expect((await call(`/public/${t}`)).status).toBe(404);
  await db.update(projects).set({ isArchived: false }).where(eq(projects.id, projectId));

  await db.update(projectMembers).set({ canUpload: false }).where(eq(projectMembers.userId, owner));
  expect((await call(`/public/${t}`)).status).toBe(404);
  await db.update(projectMembers).set({ canUpload: true }).where(eq(projectMembers.userId, owner));

  t = await token();
  expect((await call(`/project/${projectId}`, { method: 'DELETE', headers })).status).toBe(200);
  expect((await call(`/public/${t}`)).status).toBe(404);
});

test('guests stay within the share of storage the creator leaves them, and the creator can turn them away', async () => {
  const headers = await sessionOf(owner);
  const { link } = await (await call(`/project/${projectId}`, { method: 'POST', headers })).json();
  const [track] = await db.select().from(tracks).where(and(eq(tracks.projectId, projectId), eq(tracks.name, 'Kreide')));
  const [guestStem] = await db.select().from(stems).where(eq(stems.trackId, track.id));

  // An earlier file a guest sent still counts as theirs after a member replaced it
  await replaceStem(db, guestStem.id, owner, { originalFileName: 'drums-cut.wav', mimeType: 'audio/wav', fileKey: `test/${crypto.randomUUID()}/drums-cut.wav`, fileSize: 10 });
  expect((await guestStorageOf(db, owner)).used).toBe(1234);

  await db.update(users).set({ guestStorageLimit: 2000 }).where(eq(users.id, owner));
  const file = (fileSize: number) => ({ method: 'POST', body: { fileName: 'bass.wav', mimeType: 'audio/wav', fileSize } });
  expect((await call(`/public/${link.token}/track/${track.id}/upload-url`, file(1000))).status).toBe(413);
  expect((await call(`/public/${link.token}/track/${track.id}/upload-url`, file(700))).status).toBe(200);

  // Only the offered amounts can be chosen
  expect((await call('/settings', { method: 'PATCH', headers, body: { limit: 12345 } })).status).toBe(400);
  const settings = await (await call('/settings', { method: 'PATCH', headers, body: { allowed: false } })).json();
  expect(settings).toMatchObject({ allowed: false, limit: 2000, used: 1234 });
  expect((await call(`/public/${link.token}`)).status).toBe(404);
  expect((await (await call(`/project/${projectId}`, { headers })).json()).link.paused).toBe(true);
  await call('/settings', { method: 'PATCH', headers, body: { allowed: true } });
});

test('a guest leaves a note with the song, members who may upload delete it', async () => {
  const headers = await sessionOf(owner);
  const { link } = await (await call(`/project/${projectId}`, { headers })).json();
  const [track] = await db.select().from(tracks).where(and(eq(tracks.projectId, projectId), eq(tracks.name, 'Nachtbus')));

  const res = await call(`/public/${link.token}/track/${track.id}/note`, { method: 'POST', body: { guestName: 'Kai', body: 'Gesang bitte lauter' } });
  expect(res.status).toBe(201);
  const { note } = await res.json();
  expect(await db.select().from(guestNotes).where(eq(guestNotes.trackId, track.id))).toMatchObject([{ guestName: 'Kai', body: 'Gesang bitte lauter' }]);

  expect((await call(`/notes/${note.id}`, { method: 'DELETE', headers: await sessionOf(viewer) })).status).toBe(403);
  expect((await call(`/notes/${note.id}`, { method: 'DELETE', headers })).status).toBe(200);
  expect(await db.select().from(guestNotes).where(eq(guestNotes.trackId, track.id))).toHaveLength(0);
});
