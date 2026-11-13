import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { and, asc, eq, inArray, like } from 'drizzle-orm';
import {
  comments,
  createDb,
  migrateDb,
  openTracks,
  projectFiles,
  projectMembers,
  projects,
  projectShareLinks,
  sessions,
  shareLinks,
  stemRevisions,
  stems,
  tracks,
  users,
  versions,
} from '@music-hub/db';
import { generateToken, hashToken } from './middleware/auth.js';
import { fileRoutes } from './routes/files.js';
import { trackRoutes } from './routes/tracks.js';
import { versionRoutes } from './routes/versions.js';
import { storageOf } from './lib/storage.js';
import type { AppEnv } from './types.js';

// Moving tracks, merging them and moving versions. Runs against DATABASE_URL with rows of its own, which go again at the end.
const storage = { ...await import('./storage/s3.js') };
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/files', fileRoutes)
  .route('/tracks', trackRoutes)
  .route('/versions', versionRoutes);
const run = crypto.randomUUID();
const userIds: string[] = [];
type Person = { id: string; headers: Record<string, string> };
let robin: Person, kai: Person, mara: Person;
let band: string, demos: string, solo: string, foreign: string;

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
const owner = { role: 'owner' as const, canDownload: true, canInvite: true, canUpload: true, canComment: true, canApprove: true };
const producer = { role: 'producer' as const, canDownload: true, canUpload: true, canComment: true, canApprove: false };
const project = async (name: string, by: Person) => {
  const [p] = await db.insert(projects).values({ name, createdById: by.id }).returning();
  await db.insert(projectMembers).values({ projectId: p.id, userId: by.id, ...owner });
  return p.id;
};
const track = async (projectId: string, name: string, extra: Partial<typeof tracks.$inferInsert> = {}) =>
  (await db.insert(tracks).values({ projectId, name, createdById: robin.id, ...extra }).returning())[0];
const version = async (trackId: string, versionNumber: number, by: Person, sha256: string | null = null, size = 100) =>
  (
    await db
      .insert(versions)
      .values({
        trackId,
        versionNumber,
        originalFileName: `v${versionNumber}.wav`,
        mimeType: 'audio/wav',
        fileSize: size,
        originalFileKey: `test/${run}/${crypto.randomUUID()}.wav`,
        sha256,
        status: 'ready',
        createdById: by.id,
      })
      .returning()
  )[0];
const stem = async (trackId: string, name: string, by: Person, size: number, at: Date, sha256: string | null = null) =>
  (
    await db
      .insert(stems)
      .values({ trackId, name, originalFileName: `${name}.wav`, mimeType: 'audio/wav', fileSize: size, fileKey: `test/${run}/${crypto.randomUUID()}.wav`, sha256, createdById: by.id, createdAt: at })
      .returning()
  )[0];
const numbers = async (trackId: string) =>
  (await db.select().from(versions).where(eq(versions.trackId, trackId)).orderBy(asc(versions.versionNumber))).map((v) => ({
    n: v.versionNumber,
    trashed: v.deletedAt !== null,
  }));

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  mock.module('./storage/s3.js', () => ({ ...storage, createDownloadUrl: async (key: string) => `https://bucket.test/${key}` }));
  [robin, kai, mara] = await Promise.all([user('Robin'), user('Kai'), user('Mara')]);
  [band, demos, solo] = await Promise.all([project('Fernlicht', robin), project('Fernlicht Demos', robin), project('Robin solo', robin)]);
  foreign = await project('Studio Nordlicht', mara);
  await db.insert(projectMembers).values([
    { projectId: demos, userId: kai.id, ...producer },
    { projectId: foreign, userId: robin.id, ...producer },
  ]);
});

afterAll(async () => {
  mock.module('./storage/s3.js', () => storage);
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(like(users.email, `%${run}%`));
  await db.$client.end();
});

test('a track moves with everything below it, keeps its files and drops the old project links', async () => {
  const t = await track(demos, 'Neon', { section: 'Demos 2025' });
  const v = await version(t.id, 1, robin);
  const [file] = await db
    .insert(projectFiles)
    .values({ projectId: demos, trackId: t.id, originalFileName: 'Lyrics.pdf', mimeType: 'application/pdf', fileSize: 10, fileKey: `projects/${demos}/uploads/${crypto.randomUUID()}/file/Lyrics.pdf`, createdById: robin.id })
    .returning();
  const [projectLink] = await db.insert(projectShareLinks).values({ projectId: demos, token: generateToken(), createdById: robin.id }).returning();
  await db.insert(shareLinks).values([
    { versionId: v.id, token: generateToken(), createdById: robin.id, projectLinkId: projectLink.id, trackId: t.id, follows: 'latest' },
    { versionId: v.id, token: generateToken(), createdById: robin.id, follows: 'version' },
  ]);
  const before = await storageOf(db, robin.id);

  // A dry run changes nothing
  const dry = await call(`/tracks/${t.id}/move`, { method: 'POST', body: { projectId: solo, dryRun: true }, headers: robin.headers });
  expect(dry.status).toBe(200);
  expect((await db.select().from(tracks).where(eq(tracks.id, t.id)))[0].projectId).toBe(demos);

  const res = await call(`/tracks/${t.id}/move`, { method: 'POST', body: { projectId: solo }, headers: robin.headers });
  expect(res.status).toBe(200);
  const moved = (await db.select().from(tracks).where(eq(tracks.id, t.id)))[0];
  expect(moved).toMatchObject({ projectId: solo, section: 'Demos 2025' });
  expect((await db.select().from(projectFiles).where(eq(projectFiles.id, file.id)))[0]).toMatchObject({ projectId: solo, trackId: t.id, fileKey: file.fileKey });
  const links = await db.select().from(shareLinks).where(eq(shareLinks.versionId, v.id));
  expect(links.map((l) => l.follows)).toEqual(['version']);
  expect(await storageOf(db, robin.id)).toEqual(before);

  // The section can be set along the way, or cleared
  await call(`/tracks/${t.id}/move`, { method: 'POST', body: { projectId: band, section: 'Nachtbus EP' }, headers: robin.headers });
  expect((await db.select().from(tracks).where(eq(tracks.id, t.id)))[0]).toMatchObject({ projectId: band, section: 'Nachtbus EP' });
});

test('only the owner of both projects moves, and nobody who uploaded loses their files', async () => {
  const t = await track(demos, 'Kreisel');
  await version(t.id, 1, kai);
  expect((await call(`/tracks/${t.id}/move`, { method: 'POST', body: { projectId: band }, headers: kai.headers })).status).toBe(404);
  expect((await call(`/tracks/${t.id}/move`, { method: 'POST', body: { projectId: foreign }, headers: robin.headers })).status).toBe(403);

  const refused = await call(`/tracks/${t.id}/move`, { method: 'POST', body: { projectId: band, dryRun: true }, headers: robin.headers });
  expect(refused.status).toBe(409);
  const body = (await refused.json()) as { error: string; problems: { code: string; names?: string[] }[] };
  expect(body.problems).toEqual([expect.objectContaining({ code: 'uploaders_missing', names: ['Kai'] })]);
  expect(body.error).toContain('Kai');

  await db.insert(projectMembers).values({ projectId: band, userId: kai.id, ...producer });
  expect((await call(`/tracks/${t.id}/move`, { method: 'POST', body: { projectId: band }, headers: robin.headers })).status).toBe(200);
});

test('an open track stays where it is', async () => {
  const t = await track(demos, 'Offen');
  const v = await version(t.id, 1, robin);
  await db.insert(openTracks).values({ trackId: t.id, versionId: v.id, license: 'cc-by', requestedById: robin.id });
  const res = await call(`/tracks/${t.id}/move`, { method: 'POST', body: { projectId: solo }, headers: robin.headers });
  expect(res.status).toBe(409);
  expect(((await res.json()) as { problems: { code: string }[] }).problems.map((p) => p.code)).toEqual(['track_open']);
});

test('merging appends the versions, leaves the same file out and joins stems of the same name', async () => {
  const a = await track(band, 'Ränder');
  const b = await track(demos, 'Ränder (neu)', { coverImageUrl: 'covers/00000000-0000-0000-0000-000000000000.jpg' });
  const a1 = await version(a.id, 1, robin, 'a'.repeat(64));
  await version(a.id, 2, robin, 'b'.repeat(64));
  const b1 = await version(b.id, 1, robin, 'a'.repeat(64));
  const b2 = await version(b.id, 2, kai, 'c'.repeat(64));
  const [note] = await db.insert(comments).values({ versionId: b1.id, userId: robin.id, body: 'Bass zu laut' }).returning();
  const [fixed] = await db.insert(shareLinks).values({ versionId: b1.id, token: generateToken(), createdById: robin.id, follows: 'version' }).returning();
  const [following] = await db.insert(shareLinks).values({ versionId: b2.id, token: generateToken(), createdById: robin.id, follows: 'latest' }).returning();
  const oldDrums = await stem(a.id, 'Drums', robin, 300, new Date('2026-01-01'));
  const newDrums = await stem(b.id, 'drums', kai, 400, new Date('2026-06-01'));
  const bass = await stem(b.id, 'Bass', robin, 50, new Date('2026-06-01'));
  const before = await Promise.all([storageOf(db, robin.id), storageOf(db, kai.id)]);

  const dry = await call(`/tracks/${b.id}/merge`, { method: 'POST', body: { intoTrackId: a.id, dryRun: true }, headers: robin.headers });
  expect(dry.status).toBe(200);
  const preview = ((await dry.json()) as { preview: { versions: unknown[]; stems: unknown } }).preview;
  expect(preview.versions).toEqual([
    { id: b1.id, from: 1, to: 3, duplicateOf: 1 },
    { id: b2.id, from: 2, to: 4, duplicateOf: null },
  ]);
  expect(preview.stems).toEqual({ added: 1, revised: 1, duplicates: 0 });
  expect(await numbers(b.id)).toHaveLength(2);

  expect((await call(`/tracks/${b.id}/merge`, { method: 'POST', body: { intoTrackId: a.id }, headers: robin.headers })).status).toBe(200);

  expect(await numbers(a.id)).toEqual([
    { n: 1, trashed: false },
    { n: 2, trashed: false },
    { n: 3, trashed: true },
    { n: 4, trashed: false },
  ]);
  expect((await db.select().from(comments).where(eq(comments.id, note.id)))[0].versionId).toBe(a1.id);
  expect((await db.select().from(shareLinks).where(eq(shareLinks.id, fixed.id)))[0].versionId).toBe(a1.id);
  expect((await db.select().from(shareLinks).where(eq(shareLinks.id, following.id)))[0].versionId).toBe(b2.id);

  // The newer drums are current, the older ones history; bass joins as it is
  const drums = await db.select().from(stems).where(and(eq(stems.trackId, a.id), eq(stems.name, 'Drums')));
  expect(drums).toHaveLength(1);
  expect(drums[0]).toMatchObject({ id: oldDrums.id, fileKey: newDrums.fileKey, createdById: kai.id });
  expect((await db.select().from(stemRevisions).where(eq(stemRevisions.stemId, oldDrums.id))).map((r) => r.fileKey)).toEqual([oldDrums.fileKey]);
  expect((await db.select().from(stems).where(eq(stems.id, bass.id)))[0].trackId).toBe(a.id);

  const [gone] = await db.select().from(tracks).where(eq(tracks.id, b.id));
  expect(gone.deletedAt).not.toBeNull();
  expect(gone.mergedIntoId).toBe(a.id);
  expect((await db.select().from(tracks).where(eq(tracks.id, a.id)))[0].coverImageUrl).toBe(b.coverImageUrl);

  // Nobody pays more or less than before
  expect(await Promise.all([storageOf(db, robin.id), storageOf(db, kai.id)])).toEqual(before);

  // Clients that stored the old id land on the merged track
  const lookup = await call(`/tracks/${b.id}`, { headers: robin.headers });
  expect(((await lookup.json()) as { track: { id: string; projectId: string } }).track).toMatchObject({ id: a.id, projectId: band });
  const list = (await (await call(`/versions/track/${b.id}`, { headers: robin.headers })).json()) as { versions: { versionNumber: number }[] };
  expect(list.versions.map((v) => v.versionNumber)).toEqual([4, 2, 1]);
});

test('a track cannot be merged into itself, and a remix only with a remix of the same original', async () => {
  const a = await track(band, 'Stillstand');
  expect((await call(`/tracks/${a.id}/merge`, { method: 'POST', body: { intoTrackId: a.id }, headers: robin.headers })).status).toBe(409);
  const original = await track(foreign, 'Weitblick');
  const remix = await track(band, 'Weitblick Remix', { forkedFromId: original.id, license: 'cc-by' });
  const res = await call(`/tracks/${remix.id}/merge`, { method: 'POST', body: { intoTrackId: a.id }, headers: robin.headers });
  expect(((await res.json()) as { problems: { code: string }[] }).problems.map((p) => p.code)).toEqual(['remix']);
});

test('a version moves into another track with the next number, links following the old track stay there', async () => {
  const from = await track(band, 'Halbmond');
  const to = await track(band, 'Halbmond Skizze');
  const v1 = await version(from.id, 1, robin);
  const v2 = await version(from.id, 2, robin);
  await version(to.id, 1, robin);
  const [following] = await db.insert(shareLinks).values({ versionId: v2.id, token: generateToken(), createdById: robin.id, follows: 'latest' }).returning();

  const res = await call(`/versions/${v2.id}/move`, { method: 'POST', body: { trackId: to.id }, headers: robin.headers });
  expect(res.status).toBe(200);
  expect((await db.select().from(versions).where(eq(versions.id, v2.id)))[0]).toMatchObject({ trackId: to.id, versionNumber: 2 });
  expect((await db.select().from(shareLinks).where(eq(shareLinks.id, following.id)))[0].versionId).toBe(v1.id);

  // Split: a new track next to the old one
  const split = await call(`/versions/${v1.id}/split`, { method: 'POST', body: {}, headers: robin.headers });
  expect(split.status).toBe(201);
  const { track: created } = (await split.json()) as { track: { id: string; name: string; projectId: string } };
  expect(created).toMatchObject({ name: 'Halbmond (V1)', projectId: band });
  expect((await db.select().from(versions).where(eq(versions.id, v1.id)))[0]).toMatchObject({ trackId: created.id, versionNumber: 1 });
});

test('a file is renamed, given to a track and moved into another project of the same owner', async () => {
  const t = await track(solo, 'Kreisel Instrumental');
  const [file] = await db
    .insert(projectFiles)
    .values({ projectId: band, originalFileName: 'Notizen.txt', mimeType: 'text/plain', fileSize: 5, fileKey: `projects/${band}/uploads/${crypto.randomUUID()}/file/Notizen.txt`, createdById: robin.id })
    .returning();
  const renamed = await call(`/files/${file.id}`, { method: 'PATCH', body: { originalFileName: 'Text.txt' }, headers: robin.headers });
  expect(renamed.status).toBe(200);
  expect((await call(`/files/${file.id}`, { method: 'PATCH', body: { trackId: t.id }, headers: robin.headers })).status).toBe(404);
  const moved = await call(`/files/${file.id}`, { method: 'PATCH', body: { projectId: solo, trackId: t.id }, headers: robin.headers });
  expect(moved.status).toBe(200);
  expect((await db.select().from(projectFiles).where(eq(projectFiles.id, file.id)))[0]).toMatchObject({ projectId: solo, trackId: t.id, originalFileName: 'Text.txt' });
  expect((await call(`/files/${file.id}`, { method: 'PATCH', body: { projectId: foreign }, headers: robin.headers })).status).toBe(403);
});

test('possible duplicates come from similar names and the same file, across own projects only', async () => {
  const x = await track(band, 'Nachtbus');
  const y = await track(demos, 'Nachtbus – Demo 3');
  const z = await track(solo, 'Ganz anders');
  await version(x.id, 1, robin, 'd'.repeat(64));
  await version(z.id, 1, robin, 'd'.repeat(64));
  await track(foreign, 'Nachtbus');
  const res = await call('/tracks/duplicates', { headers: robin.headers });
  const { groups } = (await res.json()) as { groups: { reasons: string[]; tracks: { id: string }[] }[] };
  const group = groups.find((g) => g.tracks.some((t) => t.id === x.id))!;
  expect(group.tracks.map((t) => t.id).sort()).toEqual([x.id, y.id, z.id].sort());
  expect(group.reasons).toEqual(['file', 'name']);
});
