import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import fc from 'fast-check';
import { and, asc, eq, inArray, like } from 'drizzle-orm';
import {
  comments,
  deliveries,
  deliveryTracks,
  imports,
  importItems,
  listenEvents,
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
import { stemRoutes } from './routes/stems.js';
import { shareRoutes } from './routes/share.js';
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
  .route('/versions', versionRoutes)
  .route('/share', shareRoutes)
  .route('/stems', stemRoutes);
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

test('a track moves with everything below it and keeps its files and link history', async () => {
  const t = await track(demos, 'Neon', { section: 'Demos 2025' });
  const v = await version(t.id, 1, robin);
  const [file] = await db
    .insert(projectFiles)
    .values({ projectId: demos, trackId: t.id, originalFileName: 'Lyrics.pdf', mimeType: 'application/pdf', fileSize: 10, fileKey: `projects/${demos}/uploads/${crypto.randomUUID()}/file/Lyrics.pdf`, createdById: robin.id })
    .returning();
  const [projectLink] = await db.insert(projectShareLinks).values({ projectId: demos, token: generateToken(), createdById: robin.id }).returning();
  const createdLinks = await db.insert(shareLinks).values([
    { versionId: v.id, token: generateToken(), createdById: robin.id, projectLinkId: projectLink.id, trackId: t.id, follows: 'latest' },
    { versionId: v.id, token: generateToken(), createdById: robin.id, follows: 'version' },
  ]).returning();
  await db.insert(listenEvents).values({ shareLinkId: createdLinks[0].id, listenSeconds: 45 });
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
  expect(links.map((l) => l.follows).sort()).toEqual(['latest', 'version']);
  expect((await db.select().from(listenEvents).where(eq(listenEvents.shareLinkId, createdLinks[0].id)))).toHaveLength(1);
  expect((await call(`/share/public/${createdLinks[0].token}`)).status).toBe(410);
  expect((await call(`/share/public/${createdLinks[1].token}`)).status).toBe(200);
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

test('identical stems keep unique earlier revisions and project references do not collide when moved', async () => {
  const a = await track(band, 'Archive A');
  const b = await track(demos, 'Archive B');
  const current = await stem(a.id, 'Drums', robin, 20, new Date(), 'e'.repeat(64));
  const duplicate = await stem(b.id, 'Drums', robin, 20, new Date(), 'e'.repeat(64));
  const [revision] = await db.insert(stemRevisions).values({ stemId: duplicate.id, fileKey: `test/${run}/earlier.wav`, originalFileName: 'earlier.wav', mimeType: 'audio/wav', fileSize: 12, createdById: robin.id, createdAt: new Date(), replacedAt: new Date() }).returning();
  const before = await storageOf(db, robin.id);
  expect((await call(`/tracks/${b.id}/merge`, { method: 'POST', body: { intoTrackId: a.id }, headers: robin.headers })).status).toBe(200);
  expect((await db.select().from(stemRevisions).where(eq(stemRevisions.id, revision.id)))[0].stemId).toBe(current.id);
  expect(await storageOf(db, robin.id)).toEqual(before);
  const c = await track(demos, 'Reference');
  const ref = (projectId: string, trackId: string | null) => ({ projectId, trackId, reference: true, originalFileName: 'ref.wav', mimeType: 'audio/wav', fileSize: 1, fileKey: `test/${run}/${crypto.randomUUID()}.wav`, createdById: robin.id });
  const [moving] = await db.insert(projectFiles).values(ref(demos, c.id)).returning();
  const [existing] = await db.insert(projectFiles).values(ref(solo, null)).returning();
  expect((await call(`/tracks/${c.id}/move`, { method: 'POST', body: { projectId: solo }, headers: robin.headers })).status).toBe(200);
  expect((await db.select().from(projectFiles).where(eq(projectFiles.id, moving.id)))[0].reference).toBe(false);
  expect((await db.select().from(projectFiles).where(eq(projectFiles.id, existing.id)))[0].reference).toBe(true);
});

test('concurrent merges consume a source once and aliases survive clearing the trash', async () => {
  const { purgeTrash } = await import('./lib/trash.js');
  const { trashRoutes } = await import('./routes/trash.js');
  const trashApp = new Hono<AppEnv>().use('*', async (c, next) => { c.set('db', db); await next(); }).route('/trash', trashRoutes);
  const a = await track(band, 'Destination A');
  const b = await track(band, 'Destination B');
  const source = await track(band, 'Merge once');
  await version(source.id, 1, robin);
  const results = await Promise.all([a, b].map((target) => call(`/tracks/${source.id}/merge`, { method: 'POST', body: { intoTrackId: target.id }, headers: robin.headers })));
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const [alias] = await db.select().from(tracks).where(eq(tracks.id, source.id));
  const restore = await trashApp.request(`/trash/track/${source.id}/restore`, { method: 'POST', headers: robin.headers });
  expect(restore.status).toBe(404);
  await db.update(tracks).set({ deletedAt: new Date('2020-01-01'), discardedAt: new Date('2020-01-01') }).where(eq(tracks.id, source.id));
  await purgeTrash(db);
  const lookup = await call(`/tracks/${source.id}`, { headers: robin.headers });
  expect(((await lookup.json()) as { track: { id: string } }).track.id).toBe(alias.mergedIntoId!);
});


test('merging preserves target numbers and appends after the maximum, including trashed versions', async () => {
  await fc.assert(fc.asyncProperty(
    fc.uniqueArray(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 4 }),
    fc.uniqueArray(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 4 }),
    async (targetNumbers, sourceNumbers) => {
      const target = await track(band, 'Property target');
      const source = await track(band, 'Property source');
      for (const n of targetNumbers) {
        const v = await version(target.id, n, robin);
        await db.update(versions).set({ deletedAt: new Date() }).where(eq(versions.id, v.id));
      }
      for (const n of sourceNumbers) await version(source.id, n, robin);
      const res = await call(`/tracks/${source.id}/merge`, { method: 'POST', body: { intoTrackId: target.id }, headers: robin.headers });
      expect(res.status).toBe(200);
      const appended = sourceNumbers.map((_, i) => Math.max(...targetNumbers) + i + 1);
      expect((await numbers(target.id)).map((v) => v.n)).toEqual([...targetNumbers, ...appended].sort((a, b) => a - b));
    },
  ), { numRuns: 6 });
});


test('orders and pending imports block track moves, merges and version moves', async () => {
  const a = await track(band, 'With order');
  const b = await track(demos, 'With import');
  const target = await track(solo, 'Unrestricted');
  const av = await version(a.id, 1, robin);
  const bv = await version(b.id, 1, robin);
  const [link] = await db.insert(projectShareLinks).values({ projectId: band, token: generateToken(), createdById: robin.id }).returning();
  const [delivery] = await db.insert(deliveries).values({ projectId: band, projectLinkId: link.id, createdById: robin.id, clientName: 'Client' }).returning();
  await db.insert(deliveryTracks).values({ deliveryId: delivery.id, trackId: a.id, priceCents: 100 });
  const [job] = await db.insert(imports).values({ userId: robin.id, rootPath: '/test', entries: [], status: 'running' }).returning();
  await db.insert(importItems).values({ importId: job.id, entry: 0, position: 0, kind: 'version', name: 'Mix', projectId: demos, trackId: b.id, fileName: 'Mix.wav', rev: 'test', fileSize: 100 });
  for (const [tr, v, code] of [[a, av, 'in_delivery'], [b, bv, 'importing']] as const) {
    for (const [path, body] of [
      [`/tracks/${tr.id}/move`, { projectId: solo }],
      [`/tracks/${tr.id}/merge`, { intoTrackId: target.id }],
      [`/versions/${v.id}/move`, { trackId: target.id }],
    ] as const) {
      const res = await call(path, { method: 'POST', body, headers: robin.headers });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { problems: { code: string }[] }).problems.some((p) => p.code === code)).toBe(true);
    }
  }
});


test('version and stem registration refuse a track merged while the upload was being checked', async () => {
  const { mergeTracks } = await import('./lib/track-moves.js');
  for (const kind of ['versions', 'stems'] as const) {
    const source = await track(band, `Upload source ${kind}`);
    const target = await track(band, `Upload target ${kind}`);
    const fileKey = `projects/${band}/tracks/${source.id}/${kind}/${crypto.randomUUID()}/${kind === 'versions' ? 'original/' : ''}mix.wav`;
    mock.module('./storage/s3.js', () => ({ ...storage, getObjectSize: async () => {
      expect((await mergeTracks(db, source.id, target.id, robin.id)).ok).toBe(true);
      return 100;
    } }));
    try {
      const res = await call(`/${kind}/track/${source.id}`, { method: 'POST', headers: robin.headers, body: { name: 'Mix', originalFileName: 'mix.wav', mimeType: 'audio/wav', fileSize: 100, fileKey } });
      expect(res.status).toBe(409);
      expect(await db.select().from(versions).where(eq(versions.trackId, source.id))).toHaveLength(0);
      expect(await db.select().from(stems).where(eq(stems.trackId, source.id))).toHaveLength(0);
    } finally {
      mock.module('./storage/s3.js', () => ({ ...storage, createDownloadUrl: async (key: string) => `https://bucket.test/${key}` }));
    }
  }
});

test('splitting preserves remix credit, and moving a version cannot drop its license', async () => {
  const original = await track(band, 'Original');
  const remix = await track(band, 'CC remix', { forkedFromId: original.id, license: 'cc-by-sa', credit: 'Original by Mara' });
  const plain = await track(band, 'Plain track');
  const v = await version(remix.id, 1, robin);
  const refused = await call(`/versions/${v.id}/move`, { method: 'POST', headers: robin.headers, body: { trackId: plain.id } });
  expect(refused.status).toBe(409);
  const split = await call(`/versions/${v.id}/split`, { method: 'POST', headers: robin.headers, body: {} });
  expect(split.status).toBe(201);
  expect(((await split.json()) as { track: unknown }).track).toMatchObject({ forkedFromId: original.id, license: 'cc-by-sa', credit: 'Original by Mara' });
});

test('moving the last version keeps the source project link and its listening history paused', async () => {
  const source = await track(band, 'Last version source');
  const target = await track(solo, 'Last version target');
  const v = await version(source.id, 1, robin);
  const [projectLink] = await db.insert(projectShareLinks).values({ projectId: band, createdById: robin.id, token: generateToken() }).returning();
  const [link] = await db.insert(shareLinks).values({ projectLinkId: projectLink.id, trackId: source.id, versionId: v.id, follows: 'latest', createdById: robin.id, token: generateToken() }).returning();
  await db.insert(listenEvents).values({ shareLinkId: link.id, listenSeconds: 42 });
  expect((await call(`/versions/${v.id}/move`, { method: 'POST', headers: robin.headers, body: { trackId: target.id } })).status).toBe(200);
  expect(await db.select().from(shareLinks).where(eq(shareLinks.id, link.id))).toHaveLength(1);
  expect(await db.select().from(listenEvents).where(eq(listenEvents.shareLinkId, link.id))).toHaveLength(1);
  expect((await call(`/share/public/${link.token}`)).status).toBe(410);
});
