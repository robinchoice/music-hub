import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { comments, createDb, migrateDb, projectMembers, projects, sessions, shareLinks, tracks, users, versions } from '@music-hub/db';
import { generateToken, hashToken } from './middleware/auth.js';
import { membershipOf } from './lib/access.js';
import type { AppEnv } from './types.js';

const s3 = await import('./storage/s3.js');
mock.module('./storage/s3.js', () => ({ ...s3, createDownloadUrl: async () => 'https://bucket.test/get' }));
const { commentRoutes } = await import('./routes/comments.js');
const { shareRoutes } = await import('./routes/share.js');
const { versionRoutes } = await import('./routes/versions.js');

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/comments', commentRoutes)
  .route('/share', shareRoutes)
  .route('/versions', versionRoutes);
const userIds: string[] = [];
let owner: string, artist: string;
let ownerHeaders: Record<string, string>, artistHeaders: Record<string, string>;
let projectId: string, trackId: string, versionId: string;

const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  return { id: u.id, headers: { authorization: `Bearer ${token}` } };
};
const artistMembership = { projectId: '', userId: '', role: 'artist' as const, canUpload: true, canComment: true, canApprove: true };
const removeArtist = () => db.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, artist)));
const readdArtist = () => db.insert(projectMembers).values({ ...artistMembership, projectId, userId: artist });

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  const o = await user('Robin');
  const a = await user('Lea');
  [owner, artist, ownerHeaders, artistHeaders] = [o.id, a.id, o.headers, a.headers];
  const [project] = await db.insert(projects).values({ name: 'Fernlicht', createdById: owner }).returning();
  projectId = project.id;
  await db.insert(projectMembers).values([
    { projectId, userId: owner, role: 'owner', canUpload: true, canComment: true, canApprove: true },
    { ...artistMembership, projectId, userId: artist },
  ]);
  const [track] = await db.insert(tracks).values({ projectId, name: 'Nachtbus', createdById: owner }).returning();
  trackId = track.id;
  const [version] = await db
    .insert(versions)
    .values({
      trackId,
      versionNumber: 1,
      status: 'ready',
      originalFileName: 'mix.wav',
      mimeType: 'audio/wav',
      fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
      createdById: artist,
    })
    .returning();
  versionId = version.id;
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('an archived project keeps the membership but rests the rights to upload, comment and approve', async () => {
  await db.update(projects).set({ isArchived: true }).where(eq(projects.id, projectId));
  expect(await membershipOf(db, projectId, artist)).toMatchObject({ role: 'artist', canUpload: false, canComment: false, canApprove: false });
  const upload = await call(`/versions/track/${trackId}/upload-url`, {
    method: 'POST',
    body: { fileName: 'Mix 2.wav', mimeType: 'audio/wav', fileSize: 1000 },
    headers: artistHeaders,
  });
  expect(upload.status).toBe(403);
  // Reading still works, the owner keeps the role to restore the project
  expect((await call(`/comments/version/${versionId}`, { headers: artistHeaders })).status).toBe(200);
  expect((await membershipOf(db, projectId, owner))?.role).toBe('owner');

  await db.update(projects).set({ isArchived: false }).where(eq(projects.id, projectId));
  expect(await membershipOf(db, projectId, artist)).toMatchObject({ canUpload: true, canComment: true, canApprove: true });
});

test('who left the project can no longer edit or delete their comments', async () => {
  const created = await call(`/comments/version/${versionId}`, { method: 'POST', body: { body: 'Snare zu dünn' }, headers: artistHeaders });
  expect(created.status).toBe(201);
  const { comment } = (await created.json()) as { comment: { id: string } };
  expect((await call(`/comments/${comment.id}`, { method: 'PATCH', body: { body: 'Snare etwas dünn' }, headers: artistHeaders })).status).toBe(200);

  await removeArtist();
  expect((await call(`/comments/${comment.id}`, { method: 'PATCH', body: { body: 'Snare passt' }, headers: artistHeaders })).status).toBe(403);
  expect((await call(`/comments/${comment.id}`, { method: 'DELETE', headers: artistHeaders })).status).toBe(403);
  await readdArtist();

  expect((await call(`/comments/${comment.id}`, { method: 'DELETE', headers: artistHeaders })).status).toBe(200);
  const [row] = await db.select({ deletedAt: comments.deletedAt }).from(comments).where(eq(comments.id, comment.id));
  expect(row.deletedAt).not.toBeNull();
});

test('a share link pauses while its creator is no longer a member', async () => {
  const created = await call(`/share/version/${versionId}`, { method: 'POST', body: { allowComments: true }, headers: artistHeaders });
  expect(created.status).toBe(201);
  const { link } = (await created.json()) as { link: { token: string } };
  expect((await call(`/share/public/${link.token}`)).status).toBe(200);

  await removeArtist();
  expect((await call(`/share/public/${link.token}`)).status).toBe(410);
  const guest = await call(`/share/public/${link.token}/comments`, { method: 'POST', body: { body: 'Gefällt mir', guestName: 'Kim' } });
  expect(guest.status).toBe(410);
  await readdArtist();

  expect((await call(`/share/public/${link.token}`)).status).toBe(200);
  await db.delete(shareLinks).where(eq(shareLinks.token, link.token));
});

test('nobody finishes listening to their own version', async () => {
  expect((await call(`/versions/${versionId}/reviews`, { method: 'POST', body: { verdict: 'fine' }, headers: artistHeaders })).status).toBe(403);
  expect((await call(`/versions/${versionId}/reviews`, { method: 'POST', body: { verdict: 'fine' }, headers: ownerHeaders })).status).toBe(201);
});
