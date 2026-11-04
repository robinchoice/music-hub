import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray, like } from 'drizzle-orm';
import { createDb, migrateDb, projectFiles, projectMembers, projects, sessions, stemMixJobs, stems, tracks, users } from '@music-hub/db';
import { generateToken, hashToken } from './middleware/auth.js';
import { fileRoutes } from './routes/files.js';
import { stemRoutes } from './routes/stems.js';
import { trashRoutes } from './routes/trash.js';
import { storageOf, storageSummary } from './lib/storage.js';
import type { AppEnv } from './types.js';

// Files of a project and stems from the project's upload URL. Runs against DATABASE_URL with rows of its own, which go again at the end.
const storage = { ...await import('./storage/s3.js') };
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/files', fileRoutes)
  .route('/stems', stemRoutes)
  .route('/trash', trashRoutes);
const run = crypto.randomUUID();
const userIds: string[] = [];
type Person = { id: string; headers: Record<string, string> };
let owner: Person, producer: Person, viewer: Person;
let projectId: string, otherProjectId: string, trackId: string;

const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
const user = async (name: string): Promise<Person> => {
  const [u] = await db.insert(users).values({ email: `test-${run}-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  return { id: u.id, headers: { authorization: `Bearer ${token}` } };
};
const uploadKey = async (p: Person, fileName: string, mimeType = 'audio/wav', project = projectId) => {
  const res = await call(`/files/project/${project}/upload-url`, { method: 'POST', body: { fileName, mimeType, fileSize: 100 }, headers: p.headers });
  expect(res.status).toBe(200);
  return ((await res.json()) as { fileKey: string }).fileKey;
};
const register = (p: Person, fileKey: string, originalFileName: string, mimeType = 'audio/wav') =>
  call(`/files/project/${projectId}`, { method: 'POST', body: { fileKey, originalFileName, mimeType }, headers: p.headers });

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  mock.module('./storage/s3.js', () => ({
    ...storage,
    createUploadUrl: async (key: string) => `https://bucket.test/${key}?upload`,
    createDownloadUrl: async (key: string, _expiresIn?: number, downloadName?: string) => `https://bucket.test/${key}${downloadName ? '?download' : ''}`,
    getObjectSize: async () => 100,
  }));
  [owner, producer, viewer] = await Promise.all([user('Robin'), user('Kai'), user('Lea')]);
  const [project] = await db.insert(projects).values({ name: 'Werbespot', createdById: owner.id }).returning();
  const [other] = await db.insert(projects).values({ name: 'Anderes', createdById: owner.id }).returning();
  projectId = project.id;
  otherProjectId = other.id;
  await db.insert(projectMembers).values([
    { projectId, userId: owner.id, role: 'owner', canUpload: true, canComment: true, canApprove: true },
    { projectId, userId: producer.id, role: 'producer', canUpload: true, canComment: true, canApprove: false },
    { projectId, userId: viewer.id, role: 'viewer', canUpload: false, canComment: false, canApprove: false },
    { projectId: otherProjectId, userId: owner.id, role: 'owner', canUpload: true, canComment: true, canApprove: true },
  ]);
  const [track] = await db.insert(tracks).values({ projectId, name: 'Roller', createdById: owner.id }).returning();
  trackId = track.id;
});

afterAll(async () => {
  mock.module('./storage/s3.js', () => storage);
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(like(users.email, `%${run}%`));
  await db.$client.end();
});

test('any file goes into the project once, counts towards the uploader and is listed for every member', async () => {
  const forbidden = await call(`/files/project/${projectId}/upload-url`, { method: 'POST', body: { fileName: 'a.wav', mimeType: 'audio/wav', fileSize: 100 }, headers: viewer.headers });
  expect(forbidden.status).toBe(403);

  const sound = await uploadKey(producer, 'Vespa_Hupe.wav');
  const session = await uploadKey(producer, 'Roller.als', 'application/octet-stream');
  expect(sound.startsWith(`projects/${projectId}/uploads/`)).toBe(true);
  expect((await register(producer, sound, 'Vespa_Hupe.wav')).status).toBe(201);
  expect((await register(producer, sound, 'Vespa_Hupe.wav')).status).toBe(403);
  expect((await register(producer, session, 'Roller.als', 'application/octet-stream')).status).toBe(201);
  // A key of another project or a made-up one is refused
  expect((await register(owner, await uploadKey(owner, 'x.wav', 'audio/wav', otherProjectId), 'x.wav')).status).toBe(403);
  expect((await register(owner, `projects/${projectId}/uploads/whatever.wav`, 'x.wav')).status).toBe(403);

  expect((await storageOf(db, producer.id)).used).toBe(200);
  expect(await storageSummary(db, producer.id)).toMatchObject({ usedBytes: 200, fileBytes: 200 });

  const list = (await (await call(`/files/project/${projectId}`, { headers: viewer.headers })).json()) as {
    files: { id: string; originalFileName: string; playable: boolean; canChange: boolean }[];
    canDownload: boolean;
  };
  expect(list.canDownload).toBe(false);
  const byName = Object.fromEntries(list.files.map((f) => [f.originalFileName, f]));
  expect(byName['Vespa_Hupe.wav']).toMatchObject({ playable: false, canChange: false });
  expect(byName['Roller.als']).toMatchObject({ playable: false, canChange: false });

  // The stream is the original itself, so it needs the right to download too
  expect((await call(`/files/${byName['Vespa_Hupe.wav'].id}/stream-url`, { headers: viewer.headers })).status).toBe(403);
  expect((await call(`/files/${byName['Vespa_Hupe.wav'].id}/stream-url`, { headers: producer.headers })).status).toBe(200);
  expect((await call(`/files/${byName['Roller.als'].id}/stream-url`, { headers: producer.headers })).status).toBe(404);
  expect((await call(`/files/${byName['Roller.als'].id}/download-url`, { headers: viewer.headers })).status).toBe(403);
  expect((await call(`/files/${byName['Roller.als'].id}/download-url`, { headers: owner.headers })).status).toBe(200);
});

test('a file goes into the trash and comes back', async () => {
  const key = await uploadKey(producer, 'Notizen.pdf', 'application/pdf');
  const { file } = (await (await register(producer, key, 'Notizen.pdf', 'application/pdf')).json()) as { file: { id: string } };
  expect((await call(`/files/${file.id}`, { method: 'DELETE', headers: viewer.headers })).status).toBe(403);
  expect((await call(`/files/${file.id}`, { method: 'DELETE', headers: owner.headers })).status).toBe(200);
  expect((await call(`/files/${file.id}/download-url`, { headers: owner.headers })).status).toBe(404);

  const trash = (await (await call(`/trash/project/${projectId}`, { headers: producer.headers })).json()) as { entries: { kind: string; id: string }[] };
  expect(trash.entries).toContainEqual(expect.objectContaining({ kind: 'file', id: file.id }));
  expect((await call(`/trash/file/${file.id}/restore`, { method: 'POST', headers: producer.headers })).status).toBe(200);
  expect((await call(`/files/${file.id}/download-url`, { headers: owner.headers })).status).toBe(200);
});

test('a file becomes a stem with the same object and the same payer, and stems without a mix stay unmixed', async () => {
  const key = await uploadKey(producer, 'Vespa_Leerlauf.wav');
  const { file } = (await (await register(producer, key, 'Vespa_Leerlauf.wav')).json()) as { file: { id: string } };
  const before = (await storageOf(db, producer.id)).used;
  const pdfKey = await uploadKey(producer, 'Text.pdf', 'application/pdf');
  const { file: pdf } = (await (await register(producer, pdfKey, 'Text.pdf', 'application/pdf')).json()) as { file: { id: string } };
  expect((await call(`/files/${pdf.id}/stem`, { method: 'POST', body: { trackId }, headers: producer.headers })).status).toBe(400);
  // A DAW session arrives as application/octet-stream and must not become a stem either
  const alsKey = await uploadKey(producer, 'Roller2.als', 'application/octet-stream');
  const { file: als } = (await (await register(producer, alsKey, 'Roller2.als', 'application/octet-stream')).json()) as { file: { id: string } };
  expect((await call(`/files/${als.id}/stem`, { method: 'POST', body: { trackId }, headers: producer.headers })).status).toBe(400);

  const res = await call(`/files/${file.id}/stem`, { method: 'POST', body: { trackId, mix: false }, headers: producer.headers });
  expect(res.status).toBe(201);
  const [stem] = await db.select().from(stems).where(eq(stems.fileKey, key));
  expect(stem).toMatchObject({ trackId, createdById: producer.id, name: 'Vespa_Leerlauf' });
  expect(await db.select().from(projectFiles).where(eq(projectFiles.id, file.id))).toHaveLength(0);
  expect((await storageOf(db, producer.id)).used).toBe(before + 200);
  expect((await db.select().from(tracks).where(eq(tracks.id, trackId)))[0].stemMix).toBe(false);
  expect(await db.select().from(stemMixJobs).where(eq(stemMixJobs.trackId, trackId))).toHaveLength(0);

  // A stem straight from the project's upload URL; asking for a mix turns mixing back on
  const stemKey = await uploadKey(owner, 'Kick.wav');
  const created = await call(`/stems/track/${trackId}`, {
    method: 'POST',
    body: { fileKey: stemKey, name: 'Kick', originalFileName: 'Kick.wav', mimeType: 'audio/wav', fileSize: 100, mix: true },
    headers: owner.headers,
  });
  expect(created.status).toBe(201);
  expect((await db.select().from(tracks).where(eq(tracks.id, trackId)))[0].stemMix).toBe(true);
  expect(await db.select().from(stemMixJobs).where(eq(stemMixJobs.trackId, trackId))).toHaveLength(1);
  // The same upload can't also become a file
  expect((await register(owner, stemKey, 'Kick.wav')).status).toBe(403);
});
