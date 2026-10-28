import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, sessions, shareLinks, stems, tracks, users, versions } from '@music-hub/db';
import { generateToken, hashToken } from './middleware/auth.js';
import type { AppEnv } from './types.js';

const s3 = await import('./storage/s3.js');
mock.module('./storage/s3.js', () => ({ ...s3, createDownloadUrl: async () => 'https://bucket.test/get', getObjectSize: async () => 1234 }));
const { commentRoutes } = await import('./routes/comments.js');
const { shareRoutes } = await import('./routes/share.js');
const { stemRoutes } = await import('./routes/stems.js');
const { versionRoutes } = await import('./routes/versions.js');

// Who may download, rename and share what: the rights of the roles, enforced by the API.
// Runs against DATABASE_URL with rows of its own, which go again at the end.
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/comments', commentRoutes)
  .route('/share', shareRoutes)
  .route('/stems', stemRoutes)
  .route('/versions', versionRoutes);
const userIds: string[] = [];
type Person = { id: string; headers: Record<string, string> };
let owner: Person, producer: Person, engineer: Person, label: Person, viewer: Person;
let projectId: string, trackId: string, versionId: string, stemId: string;

const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
const json = async <T>(res: Response) => (await res.json()) as T;
const user = async (name: string): Promise<Person> => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  return { id: u.id, headers: { authorization: `Bearer ${token}` } };
};
const version = async (trackId: string, versionNumber: number, createdById: string) => {
  const [v] = await db
    .insert(versions)
    .values({
      trackId,
      versionNumber,
      status: 'ready',
      originalFileName: `mix-${versionNumber}.wav`,
      mimeType: 'audio/wav',
      fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
      createdById,
    })
    .returning();
  return v.id;
};
const setRole = (userId: string, role: 'viewer' | 'producer', canComment: boolean) =>
  db.update(projectMembers).set({ role, canComment, canUpload: role === 'producer', canApprove: role === 'producer' })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [owner, producer, engineer, label, viewer] = await Promise.all([user('Robin'), user('Kai'), user('Mo'), user('Tom'), user('Lea')]);
  const [project] = await db.insert(projects).values({ name: 'Fernlicht', createdById: owner.id }).returning();
  projectId = project.id;
  await db.insert(projectMembers).values([
    { projectId, userId: owner.id, role: 'owner', canUpload: true, canComment: true, canApprove: true },
    { projectId, userId: producer.id, role: 'producer', canUpload: true, canComment: true, canApprove: true },
    { projectId, userId: engineer.id, role: 'mixing_engineer', canUpload: true, canComment: true, canApprove: false },
    { projectId, userId: label.id, role: 'label', canUpload: false, canComment: true, canApprove: true },
    { projectId, userId: viewer.id, role: 'viewer', canUpload: false, canComment: false, canApprove: false },
  ]);
  const [track] = await db.insert(tracks).values({ projectId, name: 'Nachtbus', createdById: owner.id }).returning();
  trackId = track.id;
  versionId = await version(trackId, 1, producer.id);
  const [stem] = await db
    .insert(stems)
    .values({ trackId, name: 'Bass', originalFileName: 'bass.wav', mimeType: 'audio/wav', fileSize: 4000, fileKey: `test/${crypto.randomUUID()}/bass.wav`, createdById: owner.id })
    .returning();
  stemId = stem.id;
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('originals go only to roles with the download right, listening to every member', async () => {
  expect((await call(`/versions/${versionId}/download-url`, { headers: viewer.headers })).status).toBe(403);
  expect((await call(`/versions/${versionId}/download-url`, { headers: label.headers })).status).toBe(403);
  expect((await call(`/versions/${versionId}/download-url`, { headers: producer.headers })).status).toBe(200);
  expect((await call(`/versions/${versionId}/audio?quality=original`, { headers: viewer.headers })).status).toBe(403);
  expect((await call(`/versions/${versionId}/stream-url`, { headers: viewer.headers })).status).toBe(200);
});

test('stems and the ZIP follow the same right', async () => {
  expect((await call(`/stems/${stemId}/download-url`, { headers: viewer.headers })).status).toBe(403);
  expect((await call(`/stems/track/${trackId}/download-zip`, { headers: label.headers })).status).toBe(403);
  expect((await call(`/stems/${stemId}/download-url`, { headers: producer.headers })).status).toBe(200);
});

test('a version is renamed by its uploader or the owner, not by another uploader', async () => {
  const rename = (p: Person, label: string) => call(`/versions/${versionId}`, { method: 'PATCH', body: { label }, headers: p.headers });
  expect((await rename(engineer, 'Mix 2')).status).toBe(403);
  expect((await rename(producer, 'Mix 2')).status).toBe(200);
  expect((await rename(owner, 'Mix 3')).status).toBe(200);
});

test('tempo and key corrected by hand count as analysed, a key needs its scale', async () => {
  const correct = (body: object) => call(`/versions/${versionId}`, { method: 'PATCH', body, headers: producer.headers });
  expect((await correct({ keyRoot: 'D' })).status).toBe(400);
  expect((await correct({ keyRoot: 'H', keyScale: 'minor' })).status).toBe(400);
  expect((await correct({ bpm: 84, keyRoot: 'D', keyScale: 'minor' })).status).toBe(200);
  const [corrected] = await db.select().from(versions).where(eq(versions.id, versionId));
  expect(corrected).toMatchObject({ bpm: 84, keyRoot: 'D', keyScale: 'minor' });
  expect(corrected.analyzedAt).not.toBeNull();
  expect((await correct({ bpm: null, keyRoot: null, keyScale: null })).status).toBe(200);
});

test('a parent version must be a live version of the same track', async () => {
  const [other] = await db.insert(tracks).values({ projectId, name: 'Anderswo', createdById: owner.id }).returning();
  const foreign = await version(other.id, 1, owner.id);
  const register = (parentVersionId: string) =>
    call(`/versions/track/${trackId}`, {
      method: 'POST',
      headers: producer.headers,
      body: {
        fileKey: `projects/${projectId}/tracks/${trackId}/versions/${crypto.randomUUID()}/original/mix.wav`,
        originalFileName: 'mix.wav',
        mimeType: 'audio/wav',
        fileSize: 1234,
        parentVersionId,
        branchLabel: 'Variante',
      },
    });
  expect((await register(foreign)).status).toBe(400);
  expect((await register(crypto.randomUUID())).status).toBe(400);
});

test('a share link grants at most what its creator may', async () => {
  const share = async (p: Person) => {
    const res = await call(`/share/version/${versionId}`, { method: 'POST', body: { allowComments: true, allowDownload: true }, headers: p.headers });
    expect(res.status).toBe(201);
    return json<{ link: { token: string; allowComments: boolean; allowDownload: boolean } }>(res);
  };
  const listenOnly = await share(viewer);
  expect(listenOnly.link).toMatchObject({ allowComments: false, allowDownload: false });
  const publicPage = await json<{ downloadUrl: string | null; allowComments: boolean; comments: unknown[] }>(await call(`/share/public/${listenOnly.link.token}`));
  expect(publicPage).toMatchObject({ downloadUrl: null, allowComments: false, comments: [] });
  expect((await call(`/share/public/${listenOnly.link.token}/comments`, { method: 'POST', body: { body: 'Hi', guestName: 'Kim' } })).status).toBe(403);

  expect((await share(label)).link).toMatchObject({ allowComments: true, allowDownload: false });
  const full = await share(producer);
  expect(full.link).toMatchObject({ allowComments: true, allowDownload: true });
  expect((await json<{ downloadUrl: string | null }>(await call(`/share/public/${full.link.token}`))).downloadUrl).toBe('https://bucket.test/get');
});

test('a link loses what its creator lost, and shows comments only while comments are allowed', async () => {
  const created = await call(`/share/version/${versionId}`, { method: 'POST', body: { allowDownload: true }, headers: producer.headers });
  const { link } = await json<{ link: { token: string } }>(created);
  const member = await call(`/comments/version/${versionId}`, { method: 'POST', body: { body: 'Snare zu laut' }, headers: owner.headers });
  expect(member.status).toBe(201);
  let page = await json<{ downloadUrl: string | null; allowComments: boolean; comments: unknown[] }>(await call(`/share/public/${link.token}`));
  expect(page.downloadUrl).toBe('https://bucket.test/get');
  expect(page.allowComments).toBe(true);
  expect(page.comments.length).toBeGreaterThan(0);

  await setRole(producer.id, 'viewer', false);
  page = await json(await call(`/share/public/${link.token}`));
  expect(page).toMatchObject({ downloadUrl: null, allowComments: false, comments: [] });
  expect((await call(`/share/public/${link.token}/comments`, { method: 'POST', body: { body: 'Hi', guestName: 'Kim' } })).status).toBe(403);
  expect((await call(`/share/public/${link.token}/review`, { method: 'POST', body: { verdict: 'fine', guestName: 'Kim' } })).status).toBe(403);
  await setRole(producer.id, 'producer', true);
});

test('progress updates stop with an expired link', async () => {
  const created = await call(`/share/version/${versionId}`, { method: 'POST', body: {}, headers: producer.headers });
  const { link } = await json<{ link: { id: string; token: string } }>(created);
  const opened = await call(`/share/public/${link.token}/listen`, { method: 'POST', headers: { 'x-forwarded-for': crypto.randomUUID() } });
  expect(opened.status).toBe(201);
  const { eventId } = await json<{ eventId: string }>(opened);
  await db.update(shareLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(shareLinks.id, link.id));
  const update = await call(`/share/public/${link.token}/listen/${eventId}`, { method: 'PATCH', body: { listenSeconds: 30 } });
  expect(update.status).toBe(410);
});

test('a reply needs a live top-level comment of the same version', async () => {
  const other = await version(trackId, 2, producer.id);
  const post = (body: unknown, versionOf = versionId) => call(`/comments/version/${versionOf}`, { method: 'POST', body, headers: owner.headers });
  expect((await post({ body: 'Antwort', parentId: crypto.randomUUID() })).status).toBe(404);
  const { comment } = await json<{ comment: { id: string } }>(await post({ body: 'Hall zu lang' }, other));
  expect((await post({ body: 'Antwort', parentId: comment.id })).status).toBe(404);
  const { comment: reply } = await json<{ comment: { id: string } }>(await post({ body: 'Stimmt', parentId: comment.id }, other));
  expect((await post({ body: 'Noch tiefer', parentId: reply.id }, other)).status).toBe(400);
});
