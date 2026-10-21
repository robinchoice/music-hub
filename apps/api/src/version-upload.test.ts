import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, sessions, tracks, users } from '@music-hub/db';
import { generateToken, hashToken } from './middleware/auth.js';
import type { AppEnv } from './types.js';

const s3 = await import('./storage/s3.js');
mock.module('./storage/s3.js', () => ({ ...s3, createUploadUrl: async () => 'https://bucket.test/put', getObjectSize: async () => 1234 }));
const { versionRoutes } = await import('./routes/versions.js');
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>().use('*', async (c, next) => { c.set('db', db); await next(); }).route('/versions', versionRoutes);
const userIds: string[] = [];
let ownerHeaders: Record<string, string>, viewerHeaders: Record<string, string>, strangerHeaders: Record<string, string>;
let projectId: string, trackId: string, otherProjectId: string, otherTrackId: string;
const file = { fileName: 'Mix 2.wav', mimeType: 'audio/wav', fileSize: 1000 };
const call = (path: string, body: unknown, headers: Record<string, string> = {}) => app.request(`/versions${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const register = (id: string, fileKey: string) => call(`/track/${id}`, { ...file, originalFileName: file.fileName, fileKey }, ownerHeaders);

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  for (const name of ['Owner', 'Viewer', 'Stranger']) {
    const [user] = await db.insert(users).values({ name, email: `test-${crypto.randomUUID()}@example.com` }).returning();
    userIds.push(user.id);
  }
  const headers = await Promise.all(userIds.map(async (userId) => {
    const token = generateToken();
    await db.insert(sessions).values({ userId, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
    return { authorization: `Bearer ${token}` };
  }));
  [ownerHeaders, viewerHeaders, strangerHeaders] = headers;
  for (const name of ['Upload target', 'Other project']) {
    const [project] = await db.insert(projects).values({ name, createdById: userIds[0] }).returning();
    await db.insert(projectMembers).values([
      { projectId: project.id, userId: userIds[0], role: 'owner', canUpload: true },
      { projectId: project.id, userId: userIds[1], role: 'viewer', canUpload: false },
    ]);
    const [track] = await db.insert(tracks).values({ projectId: project.id, name: 'Letzte Bahn', createdById: userIds[0] }).returning();
    if (!projectId) { projectId = project.id; trackId = track.id; }
    else { otherProjectId = project.id; otherTrackId = track.id; }
  }
});
afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('project upload URLs require authentication, upload rights and an active project', async () => {
  const path = `/project/${projectId}/upload-url`;
  expect((await call(path, file)).status).toBe(401);
  expect((await call(path, file, viewerHeaders)).status).toBe(403);
  expect((await call(path, file, strangerHeaders)).status).toBe(403);
  expect((await call(path, { ...file, fileName: '../mix.wav' }, ownerHeaders)).status).toBe(400);
  await db.update(projects).set({ isArchived: true }).where(eq(projects.id, projectId));
  expect((await call(path, file, ownerHeaders)).status).toBe(403);
  await db.update(projects).set({ isArchived: false }).where(eq(projects.id, projectId));
});

test('a project upload registers once in that project and uses its stored size', async () => {
  const response = await call(`/project/${projectId}/upload-url`, file, ownerHeaders);
  expect(response.status).toBe(200);
  const { uploadUrl, fileKey } = await response.json();
  expect(uploadUrl).toBe('https://bucket.test/put');
  expect(fileKey).toStartWith(`projects/${projectId}/uploads/`);
  expect((await register(otherTrackId, fileKey)).status).toBe(403);
  expect((await register(trackId, fileKey.replace('/original/', '/original/../'))).status).toBe(403);
  const saved = await register(trackId, fileKey);
  expect(saved.status).toBe(201);
  expect((await saved.json()).version).toMatchObject({ trackId, fileSize: 1234, versionNumber: 1 });
  expect((await register(trackId, fileKey)).status).toBe(403);
});

test('existing clients can still register track-scoped uploads only in their original track', async () => {
  const { fileKey } = await (await call(`/track/${otherTrackId}/upload-url`, file, ownerHeaders)).json();
  expect(fileKey).toStartWith(`projects/${otherProjectId}/tracks/${otherTrackId}/versions/`);
  expect((await register(trackId, fileKey)).status).toBe(403);
  expect((await register(otherTrackId, fileKey)).status).toBe(201);
});
