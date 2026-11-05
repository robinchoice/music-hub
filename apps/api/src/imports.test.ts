import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb, dropboxConnections, importItems, imports, migrateDb, projectFiles, projects, sessions, stems, tracks, users, versions } from '@music-hub/db';
import type { ImportPlan } from '@music-hub/shared';
import { generateToken, hashToken } from './middleware/auth.js';
import type { AppEnv } from './types.js';

// Import from Dropbox against a fake Dropbox: connecting with PKCE, the scan, the plan and the worker's downloads.
// Runs against DATABASE_URL with rows of its own, which go again at the end.
const storage = { ...await import('./storage/s3.js') };
const stored = new Map<string, number>();
const deleted: string[] = [];

type FakeFile = { path: string; size: number; rev: string; hash: string };
let files: FakeFile[] = [];
const seen = { verifier: '', revoked: 0 };
const fake = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/oauth2/token') {
      const form = new URLSearchParams(await req.text());
      if (form.get('grant_type') === 'authorization_code') {
        seen.verifier = form.get('code_verifier') ?? '';
        if (form.get('code') !== 'good-code') return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({ access_token: 'access-1', expires_in: 14400, refresh_token: 'refresh-secret', account_id: 'dbid:1' });
      }
      return form.get('refresh_token') === 'refresh-secret'
        ? Response.json({ access_token: 'access-2', expires_in: 14400 })
        : Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    if (req.headers.get('authorization')?.startsWith('Bearer access-') !== true) return new Response('', { status: 401 });
    if (url.pathname === '/2/users/get_current_account') {
      return Response.json({ name: { display_name: 'Studio Nord' }, root_info: { root_namespace_id: '1', home_namespace_id: '1' } });
    }
    if (url.pathname === '/2/auth/token/revoke') {
      seen.revoked++;
      return Response.json(null);
    }
    if (url.pathname === '/2/files/list_folder' || url.pathname === '/2/files/list_folder/continue') {
      const body = await req.json() as { path?: string; recursive?: boolean; cursor?: string };
      const root = body.cursor ?? body.path ?? '';
      const below = files.filter((f) => f.path.toLowerCase().startsWith(`${root.toLowerCase()}/`));
      const entries = body.recursive || body.cursor
        ? below.map((f) => ({ '.tag': 'file', name: f.path.split('/').at(-1), path_lower: f.path.toLowerCase(), path_display: f.path, id: `id:${f.rev}`, rev: f.rev, size: f.size, server_modified: '2026-11-01T10:00:00Z', content_hash: f.hash }))
        : [...new Set(below.map((f) => f.path.slice(root.length + 1).split('/')[0]).filter((name, _, all) => all.length > 0 && below.some((f) => f.path.slice(root.length + 1).startsWith(`${name}/`))))]
            .map((name) => ({ '.tag': 'folder', name, path_lower: `${root}/${name}`.toLowerCase(), path_display: `${root}/${name}` }));
      // Two pages, so paging is tested too
      if (!body.cursor && entries.length > 2) return Response.json({ entries: entries.slice(0, 2), cursor: root, has_more: true });
      return Response.json({ entries: body.cursor ? entries.slice(2) : entries, cursor: 'end', has_more: false });
    }
    if (url.pathname === '/2/files/download') {
      const rev = (JSON.parse(req.headers.get('dropbox-api-arg') ?? '{}') as { path: string }).path.replace('rev:', '');
      const file = files.find((f) => f.rev === rev);
      if (!file) return Response.json({ error_summary: 'path/not_found/..' }, { status: 409 });
      return new Response(new Uint8Array(file.size).fill(7));
    }
    return new Response('', { status: 404 });
  },
});

process.env.DROPBOX_APP_KEY = 'testkey';
process.env.DROPBOX_TOKEN_KEY = randomBytes(32).toString('base64');
process.env.DROPBOX_AUTH_URL = `http://localhost:${fake.port}`;
process.env.DROPBOX_API_URL = `http://localhost:${fake.port}`;
process.env.DROPBOX_CONTENT_URL = `http://localhost:${fake.port}`;

const db = createDb(process.env.DATABASE_URL!);
let app: Hono<AppEnv>;
let processNext: (db: ReturnType<typeof createDb>, signal: AbortSignal) => Promise<boolean>;
const run = crypto.randomUUID();
let userId = '';
let headers: Record<string, string> = {};

const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...headers, ...init.headers },
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
const drain = async () => {
  while (await processNext(db, new AbortController().signal)) { /* one file after the other */ }
};
type Scan = { id: string; rootName: string; entries: { path: string; size: number }[]; plan: ImportPlan; duplicates: number[] };
const scan = async (path = '/Studio') => {
  const res = await call('/imports/dropbox', { method: 'POST', body: { path } });
  expect(res.status).toBe(200);
  return await res.json() as Scan;
};
const start = (s: Scan, plan: ImportPlan = s.plan) => call(`/imports/${s.id}/start`, { method: 'POST', body: plan });

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  mock.module('./storage/s3.js', () => ({
    ...storage,
    putObjectFile: async (key: string, path: string) => void stored.set(key, Bun.file(path).size),
    deleteObject: async (key: string) => void deleted.push(key),
  }));
  const routes = await import('./routes/imports.js');
  processNext = (await import('./lib/imports.js')).processNextImportItem;
  app = new Hono<AppEnv>()
    .use('*', async (c, next) => { c.set('db', db); await next(); })
    .route('/dropbox', routes.dropboxRoutes)
    .route('/imports', routes.importRoutes);
  const [u] = await db.insert(users).values({ email: `test-${run}@example.com`, name: 'Robin' }).returning();
  userId = u.id;
  const token = generateToken();
  await db.insert(sessions).values({ userId, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  headers = { authorization: `Bearer ${token}` };
  files = [
    { path: '/Studio/Album/Kreise/Kreise.als', size: 2_000, rev: 'r1', hash: 'h1' },
    { path: '/Studio/Album/Kreise/Bounces/Kreise v2.wav', size: 6_000_000, rev: 'r2', hash: 'h2' },
    { path: '/Studio/Album/Kreise/Bounces/Kreise v1.wav', size: 6_000_000, rev: 'r3', hash: 'h3' },
    { path: '/Studio/Album/Kreise/Stems/Kick.wav', size: 6_000_000, rev: 'r4', hash: 'h4' },
    { path: '/Studio/Album/Kreise/Stems/Bass.wav', size: 6_000_000, rev: 'r5', hash: 'h5' },
    { path: '/Studio/Album/Nachtbus/Stems/Drums.wav', size: 7_000_000, rev: 'r6', hash: 'h6' },
    { path: '/Studio/Album/Nachtbus/Stems/Vox.wav', size: 7_000_000, rev: 'r7', hash: 'h7' },
    { path: '/Studio/Album/Notizen.pdf', size: 1_000, rev: 'r8', hash: 'h8' },
  ];
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.createdById, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.$client.end();
  fake.stop(true);
});

test('without a connection there is nothing to look at, connecting keeps only the encrypted refresh token', async () => {
  expect(await (await call('/dropbox')).json()).toEqual({ configured: true, connected: false, displayName: null });
  expect((await call('/imports/dropbox', { method: 'POST', body: { path: '/Studio' } })).status).toBe(409);

  const connect = await call('/dropbox/connect');
  expect(connect.status).toBe(302);
  const target = new URL(connect.headers.get('location')!);
  expect(target.pathname).toBe('/oauth2/authorize');
  expect(target.searchParams.get('code_challenge_method')).toBe('S256');
  const cookie = connect.headers.get('set-cookie')!.split(';')[0];
  const state = target.searchParams.get('state')!;

  // A wrong state never reaches Dropbox
  const forged = await call(`/dropbox/callback?code=good-code&state=other`, { headers: { cookie } });
  expect(forged.headers.get('location')).toBe('/import?dropbox=failed');

  const back = await call(`/dropbox/callback?code=good-code&state=${state}`, { headers: { cookie } });
  expect(back.headers.get('location')).toBe('/import');
  const verifier = cookie.split('=')[1].split('.')[1];
  expect(seen.verifier).toBe(verifier);
  expect(new Bun.CryptoHasher('sha256').update(verifier).digest('base64url')).toBe(target.searchParams.get('code_challenge')!);

  const [row] = await db.select().from(dropboxConnections).where(eq(dropboxConnections.userId, userId));
  expect(row.displayName).toBe('Studio Nord');
  expect(row.refreshTokenEnc).not.toContain('refresh-secret');
  expect(await (await call('/dropbox')).json()).toEqual({ configured: true, connected: true, displayName: 'Studio Nord' });
});

test('folders to pick from', async () => {
  const res = await call('/dropbox/folders?path=/Studio/Album');
  expect(await res.json()).toEqual({ folders: [{ name: 'Kreise', path: '/Studio/Album/Kreise' }, { name: 'Nachtbus', path: '/Studio/Album/Nachtbus' }] });
});

test('the scan proposes songs, the import brings versions in order, stems and files, the worker downloads each', async () => {
  const s = await scan();
  expect(s.rootName).toBe('Studio');
  expect(s.entries.map((e) => e.path)).toContain('Album/Kreise/Bounces/Kreise v1.wav');
  expect(s.plan.projects).toEqual([{ name: 'Album' }]);
  expect(s.plan.tracks.map((t) => t.name)).toEqual(['Kreise', 'Nachtbus']);
  expect(s.duplicates).toEqual([]);

  // A plan that points elsewhere is refused
  expect((await start(s, { ...s.plan, items: [...s.plan.items, s.plan.items[0]] })).status).toBe(400);

  const renamed = { ...s.plan, projects: [{ name: 'Album 2026' }] };
  const res = await start(s, renamed);
  expect(await res.json()).toEqual({ ok: true, items: 7, duplicates: 0 });
  // The list of the whole folder is not kept once the import runs
  const [row] = await db.select().from(imports).where(eq(imports.id, s.id));
  expect(row.entries).toEqual([]);
  await drain();

  const [project] = await db.select().from(projects).where(and(eq(projects.createdById, userId), eq(projects.name, 'Album 2026')));
  const songs = await db.select().from(tracks).where(eq(tracks.projectId, project.id));
  const kreise = songs.find((t) => t.name === 'Kreise')!;
  const nachtbus = songs.find((t) => t.name === 'Nachtbus')!;
  // Only the song without a bounce gets mixed from its stems
  expect([kreise.stemMix, nachtbus.stemMix]).toEqual([false, true]);
  const kreiseVersions = await db.select().from(versions).where(eq(versions.trackId, kreise.id)).orderBy(versions.versionNumber);
  expect(kreiseVersions.map((v) => [v.versionNumber, v.label])).toEqual([[1, 'Kreise v1'], [2, 'Kreise v2']]);
  expect(kreiseVersions[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  expect((await db.select().from(stems).where(inArray(stems.trackId, [kreise.id, nachtbus.id]))).map((s) => s.name).sort()).toEqual(['Bass', 'Drums', 'Kick', 'Vox']);
  expect((await db.select().from(projectFiles).where(eq(projectFiles.projectId, project.id))).map((f) => f.originalFileName)).toEqual(['Kreise.als']);
  expect([...stored.values()].reduce((a, b) => a + b, 0)).toBe(6_000_000 * 4 + 7_000_000 * 2 + 2_000);
  expect([...stored.keys()].every((key) => key.startsWith(`projects/${project.id}/uploads/`))).toBe(true);

  const status = await (await call(`/imports/${s.id}`)).json() as { status: string; items: { status: string }[] };
  expect(status.status).toBe('done');
  expect(status.items.every((i) => i.status === 'done')).toBe(true);
});

test('a second import skips what came in before and adds a new bounce to the same song', async () => {
  files.push({ path: '/Studio/Album/Kreise/Bounces/Kreise v3.wav', size: 6_000_000, rev: 'r9', hash: 'h9' });
  const s = await scan();
  expect(s.duplicates.length).toBe(8 - 1);
  expect(await (await start(s)).json()).toEqual({ ok: true, items: 1, duplicates: 7 });
  await drain();
  const [kreise] = await db.select().from(tracks).innerJoin(projects, eq(projects.id, tracks.projectId))
    .where(and(eq(projects.createdById, userId), eq(tracks.name, 'Kreise')));
  const numbers = await db.select({ n: versions.versionNumber, label: versions.label }).from(versions).where(eq(versions.trackId, kreise.tracks.id)).orderBy(versions.versionNumber);
  expect(numbers.at(-1)).toEqual({ n: 3, label: 'Kreise v3' });
  expect((await db.select().from(projects).where(eq(projects.createdById, userId))).length).toBe(1);
});

test('a file gone from Dropbox fails without retrying, cancelling drops what still waits', async () => {
  files.push({ path: '/Studio/Neu/Song Mix 1.wav', size: 6_000_000, rev: 'gone', hash: 'h10' }, { path: '/Studio/Neu/Song Mix 2.wav', size: 6_000_000, rev: 'r11', hash: 'h11' });
  const s = await scan();
  files = files.filter((f) => f.rev !== 'gone');
  await start(s);
  expect(await processNext(db, new AbortController().signal)).toBe(true);
  const items = await db.select().from(importItems).where(eq(importItems.importId, s.id)).orderBy(importItems.position);
  expect([items[0].status, items[0].error]).toEqual(['failed', 'path/not_found/..']);
  expect((await call(`/imports/${s.id}/cancel`, { method: 'POST' })).status).toBe(200);
  expect(await db.select().from(importItems).where(and(eq(importItems.importId, s.id), eq(importItems.status, 'pending')))).toEqual([]);
  expect(await processNext(db, new AbortController().signal)).toBe(false);
});

test('a deleted rehearsal does not count as imported, the server checks kinds, a scan starts once', async () => {
  await db.update(projects).set({ isArchived: true }).where(eq(projects.createdById, userId));
  const s = await scan();
  expect(s.duplicates).toEqual([]);
  const session = s.plan.items.find((item) => s.entries[item.entry].path.endsWith('.als'))!;
  const wrong = { ...s.plan, items: s.plan.items.map((item) => (item === session ? { ...item, kind: 'version' as const } : item)) };
  expect((await start(s, wrong)).status).toBe(400);
  const [first, second] = await Promise.all([start(s), start(s)]);
  expect([first.status, second.status].sort()).toEqual([200, 404]);
  await call(`/imports/${s.id}/cancel`, { method: 'POST' });
});

test('disconnecting revokes the token at Dropbox and forgets it', async () => {
  expect((await call('/dropbox', { method: 'DELETE' })).status).toBe(200);
  expect(seen.revoked).toBe(1);
  expect(await db.select().from(dropboxConnections).where(eq(dropboxConnections.userId, userId))).toEqual([]);
});
