import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, magicLinks, migrateDb, projectMembers, projects, sessions, users } from '@music-hub/db';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { MAX_USERS } from '../../api/src/lib/users';
import { generateToken, hashToken } from '../../api/src/middleware/auth';
import { authRoutes } from '../../api/src/routes/auth';
import { deviceRoutes } from '../../api/src/routes/device';
import { projectRoutes } from '../../api/src/routes/projects';
import type { AppEnv } from '../../api/src/types';
import { run } from './cli';
import { SLUG, sessionFile } from './config';
import { texts } from './texts';

// The CLI runs in-process against the API routes it uses on a free port, with the test database
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.set('db', db);
    await next();
  })
  .basePath('/api/v1')
  .route('/auth', authRoutes)
  .route('/auth/device', deviceRoutes)
  .route('/projects', projectRoutes);
let server: ReturnType<typeof Bun.serve>;
let url = '';

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  server = Bun.serve({ port: 0, fetch: app.fetch });
  url = server.url.origin;
});
afterAll(async () => {
  await server.stop(true);
  await db.$client.end();
});

const storedSchema = z.object({ token: z.string() });

// An account with a browser session, as someone logged into the web
async function person(name = 'Ada') {
  const [user] = await db.insert(users).values({ email: `cli-${crypto.randomUUID()}@example.com`, name }).returning();
  const browser = generateToken();
  await db.insert(sessions).values({ userId: user!.id, tokenHash: await hashToken(browser), expiresAt: new Date(Date.now() + 300_000) });
  return { ...user!, browser };
}

// A login link as login-link.ts prints it
async function loginLink(email: string) {
  const token = generateToken();
  await db.insert(magicLinks).values({ email, token: await hashToken(token), expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
  return `${url}/auth/verify?token=${token}`;
}

// One device: its own config folder, so its own token. `approveAs` confirms the
// code of the device login in the browser of that person while the CLI waits.
async function device() {
  const env = { XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'cli-')) };
  // Adds --url of the test API unless raw or the call names one
  const cli = async (args: string[], { stdin = '', raw = false, approveAs = '' } = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(raw || args.length === 0 || args.includes('--url') ? args : [...args, '--url', url], {
      env,
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      stdin: async () => stdin,
      sleep: async () => {
        const userCode = err.at(-1)?.match(/Code (\S+)\.$/)?.[1];
        if (!approveAs || !userCode) return;
        await fetch(`${url}/api/v1/auth/device/approve`, {
          method: 'POST',
          headers: { authorization: `Bearer ${approveAs}`, 'content-type': 'application/json' },
          body: JSON.stringify({ userCode }),
        });
      },
    });
    return { code, out: out.join('\n'), err: err.join('\n'), json: () => JSON.parse(out.join('\n')) };
  };
  const token = async () => storedSchema.parse(JSON.parse(await readFile(sessionFile(env), 'utf8'))).token;
  return { cli, token, env };
}

const sessionOf = async (token: string) =>
  (await db.select({ client: sessions.client }).from(sessions).where(eq(sessions.tokenHash, await hashToken(token))))[0];

test('login confirmed in the browser stores a token only the user can read', async () => {
  const ada = await person();
  const { cli, token, env } = await device();

  const login = await cli(['login', '--json'], { approveAs: ada.browser });
  expect(login.code).toBe(0);
  expect(login.json()).toMatchObject({ user: { email: ada.email } });
  expect(login.err).toMatch(/Öffne .*\/device\?code=\S+ und bestätige dort den Code \S+\./);
  expect((await stat(sessionFile(env))).mode & 0o777).toBe(0o600);
  // A session of its own, which the admin pages don't count as plugin
  expect(await sessionOf(await token())).toEqual({ client: 'cli' });

  expect(await cli(['whoami'])).toMatchObject({ code: 0, out: `Ada <${ada.email}>` });
  expect((await cli(['whoami', '--json'])).json()).toMatchObject({ user: { email: ada.email, isAdmin: false } });
});

test('projects lists the own projects with roles and tracks', async () => {
  const ada = await person();
  const { cli } = await device();
  expect(await cli(['projects'])).toMatchObject({ code: 3, err: texts.notLoggedIn(SLUG) });
  await cli(['login'], { approveAs: ada.browser });
  expect(await cli(['projects'])).toMatchObject({ code: 0, out: texts.noProjects });

  const [fernlicht] = await db.insert(projects).values({ name: 'Fernlicht', artist: 'Ada', createdById: ada.id }).returning();
  const [old] = await db.insert(projects).values({ name: 'Altbau', createdById: ada.id, isArchived: true }).returning();
  await db.insert(projectMembers).values([
    { projectId: fernlicht!.id, userId: ada.id, role: 'owner', extraRoles: ['producer'] },
    { projectId: old!.id, userId: ada.id, role: 'viewer' },
  ]);

  expect((await cli(['projects'])).out).toBe('Fernlicht – Ada · Besitzer, Produktion · 0 Tracks');
  expect((await cli(['projects', '--json'])).json()).toEqual({
    projects: [{ id: fernlicht!.id, name: 'Fernlicht', artist: 'Ada', roles: ['owner', 'producer'], trackCount: 0 }],
  });
  expect((await cli(['projects', '--archived'])).out).toBe('Altbau · Nur Zuhören · 0 Tracks');
});

test('every device has its own token, logout revokes only that one', async () => {
  const ada = await person();
  const laptop = await device();
  const server = await device();
  await laptop.cli(['login'], { approveAs: ada.browser });
  await server.cli(['login', '--link', '-'], { stdin: await loginLink(ada.email) });
  const laptopToken = await laptop.token();
  expect(laptopToken).not.toBe(await server.token());

  expect(await laptop.cli(['logout'])).toMatchObject({ code: 0, out: texts.loggedOut });
  expect(await sessionOf(laptopToken)).toBeUndefined();
  expect(await laptop.cli(['whoami'])).toMatchObject({ code: 3, err: texts.notLoggedIn(SLUG) });
  expect((await laptop.cli(['whoami', '--json'])).json()).toEqual({ error: texts.notLoggedIn(SLUG) });

  expect((await server.cli(['whoami'])).code).toBe(0);

  // Logging in again replaces the token of the device and revokes the old one
  const oldToken = await server.token();
  await server.cli(['login'], { approveAs: ada.browser });
  expect(await sessionOf(oldToken)).toBeUndefined();
  expect(await sessionOf(await server.token())).toEqual({ client: 'cli' });
});

test('a session revoked on the server logs the CLI out', async () => {
  const ada = await person();
  const { cli, token } = await device();
  await cli(['login'], { approveAs: ada.browser });
  await db.delete(sessions).where(eq(sessions.tokenHash, await hashToken(await token())));
  expect((await cli(['whoami'])).code).toBe(3);
  expect(await cli(['projects', '--json'])).toMatchObject({ code: 3 });
});

test('agents log in with a login link from stdin', async () => {
  const ada = await person();
  const link = await loginLink(ada.email);
  const { cli, token } = await device();

  expect((await cli(['login', '--link', '-'], { stdin: `${link}\n` })).code).toBe(0);
  expect((await cli(['whoami', '--json'])).json()).toMatchObject({ user: { email: ada.email } });
  expect(await sessionOf(await token())).toEqual({ client: 'cli' });

  const again = await device();
  expect(await again.cli(['login', '--link', link])).toMatchObject({ code: 1, err: 'Der Link ist abgelaufen oder wurde schon benutzt.' });
  expect(await again.cli(['login', '--link', 'https://example.com/'])).toMatchObject({ code: 2, err: texts.linkIncomplete });
});

test('the token only goes to the address it was issued for', async () => {
  const seen: (string | null)[] = [];
  const other = Bun.serve({
    port: 0,
    fetch: (req) => {
      seen.push(req.headers.get('authorization'));
      return Response.json({ error: 'nope' }, { status: 401 });
    },
  });
  try {
    const ada = await person();
    const { cli } = await device();
    await cli(['login'], { approveAs: ada.browser });
    expect((await cli(['whoami', '--url', other.url.origin])).code).toBe(3);
    expect((await cli(['projects', '--url', other.url.origin])).code).toBe(3);
    expect(seen).toEqual([]);
    // The stored session stays for its own address, which later calls take without --url
    expect((await cli(['logout', '--url', other.url.origin])).code).toBe(0);
    expect((await cli(['whoami'], { raw: true })).code).toBe(0);
  } finally {
    await other.stop(true);
  }
});

test('help, wrong usage and an unreachable app', async () => {
  const { cli } = await device();
  const helpText = await cli([]);
  expect(helpText.code).toBe(0);
  expect(helpText.out).toContain(`${texts.commands}:`);
  expect(helpText.out).toContain('projects [--archived]');

  expect((await cli(['whoami', '--help', '--json'])).json()).toMatchObject({
    commands: expect.arrayContaining([{ usage: 'whoami', text: texts.whoamiHelp }]),
    exitCodes: { loggedOut: 3 },
  });

  expect(await cli(['frobnicate'])).toMatchObject({ code: 2, err: texts.unknownCommand('frobnicate', SLUG) });
  expect((await cli(['frobnicate', '--json'])).json()).toEqual({ error: texts.unknownCommand('frobnicate', SLUG) });
  expect((await cli(['whoami', '--nope'])).code).toBe(2);
  expect(await cli(['login', '--url', 'http://127.0.0.1:1'])).toMatchObject({
    code: 1,
    err: texts.unreachable('http://127.0.0.1:1'),
  });
});

test('an unwritable config folder ends with an error, not a crash', async () => {
  const ada = await person();
  const blocked = join(await mkdtemp(join(tmpdir(), 'cli-')), 'file');
  await Bun.write(blocked, '');
  const out: string[] = [];
  const code = await run(['login', '--link', await loginLink(ada.email), '--url', url, '--json'], {
    env: { XDG_CONFIG_HOME: blocked },
    out: (text) => out.push(text),
    err: () => {},
    stdin: async () => '',
    sleep: async () => {},
  });
  expect(code).toBe(1);
  expect(JSON.parse(out.join(''))).toEqual({ error: expect.any(String) });
});

test('the entry point passes the exit code to the shell', async () => {
  const env = { ...process.env, XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'cli-')) };
  const main = join(import.meta.dir, 'main.ts');
  // Async, so the API in this process keeps answering
  const whoami = Bun.spawn(['bun', main, 'whoami', '--json', '--url', url], { env, stdout: 'pipe' });
  expect(await whoami.exited).toBe(3);
  expect(JSON.parse(await new Response(whoami.stdout).text())).toEqual({ error: texts.notLoggedIn(SLUG) });
  expect(await Bun.spawn(['bun', main, '--help'], { env, stdout: 'ignore' }).exited).toBe(0);
});

// Last, since it fills Music Hub up
test('the CLI creates no account once Music Hub is full', async () => {
  const [{ count }] = await db.execute<{ count: number }>(sql`select count(*)::int as count from users`);
  for (let i = count; i < MAX_USERS; i++) await person();
  const email = `cli-${crypto.randomUUID()}@example.com`;
  const { cli } = await device();

  const login = await cli(['login', '--link', await loginLink(email), '--json']);
  expect(login.code).toBe(1);
  expect(login.json()).toEqual({ error: expect.stringContaining('Music Hub ist gerade voll') });
  expect(await db.select({ id: users.id }).from(users).where(eq(users.email, email))).toHaveLength(0);
});
