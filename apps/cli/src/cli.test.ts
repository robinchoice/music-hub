import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, deliveryTracks, magicLinks, migrateDb, payments, projectMembers, projects, sessions, tracks, users, versions } from '@music-hub/db';
import { DELIVERY_ERRORS, formatEuro } from '@music-hub/shared';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { MAX_USERS } from '../../api/src/lib/users';
import { generateToken, hashToken } from '../../api/src/middleware/auth';
import { authRoutes } from '../../api/src/routes/auth';
import { deliveryRoutes } from '../../api/src/routes/deliveries';
import { deviceRoutes } from '../../api/src/routes/device';
import { projectRoutes } from '../../api/src/routes/projects';
import { shareRoutes } from '../../api/src/routes/share';
import { trackRoutes } from '../../api/src/routes/tracks';
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
  .route('/projects', projectRoutes)
  .route('/tracks', trackRoutes)
  .route('/share', shareRoutes)
  .route('/deliveries', deliveryRoutes);
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
        const userCode = err.at(-1)?.match(/code (\S+)\.$/)?.[1];
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
  expect(login.err).toMatch(/Open .*\/device\?code=\S+ and confirm the code \S+\./);
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

  expect((await cli(['projects'])).out).toBe('Fernlicht – Ada · Owner, Production · 0 tracks');
  expect((await cli(['projects', '--json'])).json()).toEqual({
    projects: [{ id: fernlicht!.id, name: 'Fernlicht', artist: 'Ada', roles: ['owner', 'producer'], trackCount: 0 }],
  });
  expect((await cli(['projects', '--archived'])).out).toBe('Altbau · Listen only · 0 tracks');
});

test('share prints the own link of a project, found by name or ID', async () => {
  const ada = await person();
  const { cli } = await device();
  await cli(['login'], { approveAs: ada.browser });
  const [nachtbus] = await db.insert(projects).values({ name: 'Nachtbus EP', createdById: ada.id }).returning();
  await db.insert(projectMembers).values({ projectId: nachtbus!.id, userId: ada.id, role: 'owner' });

  const byName = await cli(['share', '--project', 'nachtbus ep']);
  expect(byName.code).toBe(0);
  expect(byName.out).toMatch(new RegExp(`^${url}/album/[\\w-]+$`));
  const byId = (await cli(['share', '--project', nachtbus!.id, '--json'])).json();
  expect(byId).toMatchObject({ project: { id: nachtbus!.id }, url: byName.out, link: { follows: 'latest', allowComments: true } });

  expect(await cli(['share', '--project', 'Altbau'])).toMatchObject({ code: 1, err: texts.noSuchProject('Altbau', SLUG) });
  expect((await cli(['share'])).code).toBe(2);
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
  expect(await again.cli(['login', '--link', link])).toMatchObject({ code: 1, err: 'The link has expired or has already been used.' });
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

// A project of its owner with songs, in this order
async function projectWithTracks(owner: { id: string }, name: string, songs: string[]) {
  const [project] = await db.insert(projects).values({ name, createdById: owner.id }).returning();
  await db.insert(projectMembers).values({ projectId: project!.id, userId: owner.id, role: 'owner', canUpload: true });
  const rows = await db
    .insert(tracks)
    .values(songs.map((song, i) => ({ projectId: project!.id, name: song, sortOrder: i, createdById: owner.id })))
    .returning();
  return { project: project!, tracks: rows };
}

const deliveryJson = z.object({
  delivery: z.looseObject({ id: z.string(), linkToken: z.string(), status: z.string() }),
  url: z.string(),
});

test('deliveries: a studio with the Solo plan creates, lists and shows a delivery and confirms the transfer', async () => {
  const ada = await person();
  const { cli } = await device();
  await cli(['login'], { approveAs: ada.browser });
  const { tracks: songs } = await projectWithTracks(ada, 'Klanglabor Album', ['Morgenrot', 'Abendrot']);
  const create = ['deliveries', 'create', '--project', 'klanglabor album', '--client', 'Kim', '--price', '120'];

  expect(await cli(create)).toMatchObject({ code: 1, err: DELIVERY_ERRORS.en.plan_required });
  await db.update(users).set({ plan: 'solo' }).where(eq(users.id, ada.id));

  expect((await cli([...create.slice(0, -1), '12.345'])).code).toBe(2);
  expect((await cli([...create, '--rounds', '21'])).code).toBe(2);
  expect((await cli(create.filter((arg) => arg !== '--client' && arg !== 'Kim'))).code).toBe(2);
  expect(await cli([...create, '--track', 'Mittag'])).toMatchObject({ code: 1, err: texts.noSuchTrack('Mittag') });

  const created = await cli([
    ...create,
    ...['--extra', '40,5', '--rounds', '3', '--reference', 'KL-7', '--email', 'kim@example.com', '--no-stems', '--track', 'Morgenrot', '--json'],
  ]);
  expect(created.code).toBe(0);
  const { delivery, url: albumUrl } = deliveryJson.parse(created.json());
  expect(albumUrl).toBe(`${url}/album/${delivery.linkToken}`);
  expect(delivery).toMatchObject({
    status: 'open',
    clientName: 'Kim',
    clientEmail: 'kim@example.com',
    reference: 'KL-7',
    includedRounds: 3,
    extraRoundCents: 4050,
    includeStems: false,
    tracks: [{ trackId: songs[0]!.id, name: 'Morgenrot', priceCents: 12000, roundsUsed: 0, roundsIncluded: 3 }],
    totals: { totalCents: 12000, trackCount: 1, approvedCount: 0 },
  });
  expect(await cli(create)).toMatchObject({ code: 1, err: DELIVERY_ERRORS.en.delivery_exists });

  const line = [delivery.id, 'Klanglabor Album', 'Kim', 'open', '0/1 approved', formatEuro(12000, 'en')].join(' · ');
  expect(await cli(['deliveries', 'list'])).toMatchObject({ code: 0, out: line });
  expect((await cli(['deliveries', 'list', '--project', 'Klanglabor Album', '--json'])).json()).toMatchObject({
    deliveries: [{ id: delivery.id }],
  });
  const shown = await cli(['deliveries', 'show', delivery.id]);
  expect(shown.code).toBe(0);
  expect(shown.out).toContain('Order for Kim · open');
  expect(shown.out).toContain(`Link: ${albumUrl}`);
  expect(shown.out).toContain('Reference: KL-7');
  expect(shown.out).toContain(`  Morgenrot · ${formatEuro(12000, 'en')} · `);
  expect(shown.out).toContain(`Total: ${formatEuro(12000, 'en')}`);

  // The client approved V1 and said "Ich habe überwiesen", the studio confirms the money arrived
  expect(await cli(['deliveries', 'confirm-payment', delivery.id])).toMatchObject({ code: 1, err: texts.noOpenTransfer });
  const [v1] = await db
    .insert(versions)
    .values({ trackId: songs[0]!.id, versionNumber: 1, status: 'ready', originalFileName: 'mix.wav', mimeType: 'audio/wav', fileSize: 10, originalFileKey: `test/${crypto.randomUUID()}`, createdById: ada.id })
    .returning();
  await db.update(deliveryTracks).set({ approvedVersionId: v1!.id, approvedAt: new Date(), approvedByName: 'Kim' }).where(eq(deliveryTracks.deliveryId, delivery.id));
  await db.insert(payments).values({ deliveryId: delivery.id, method: 'transfer', amountCents: 12000, status: 'announced' });
  expect(await cli(['deliveries', 'confirm-payment', delivery.id])).toMatchObject({
    code: 0,
    out: texts.paymentConfirmed(formatEuro(12000, 'en')),
  });
  expect((await cli(['deliveries', 'show', delivery.id, '--json'])).json()).toMatchObject({
    delivery: { status: 'paid', payments: [{ method: 'transfer', status: 'paid', confirmedByName: 'Ada' }] },
  });
  expect(await cli(['deliveries', 'confirm-payment', delivery.id])).toMatchObject({ code: 1, err: texts.noOpenTransfer });
  expect(await cli(['deliveries', 'cancel', delivery.id])).toMatchObject({ code: 1, err: DELIVERY_ERRORS.en.not_open });
});

test('deliveries: cancelling frees the link for a new one, others in the project only see their refusal', async () => {
  const ada = await person();
  const bob = await person('Bob');
  await db.update(users).set({ plan: 'solo' }).where(eq(users.id, ada.id));
  const studio = await device();
  const guest = await device();
  await studio.cli(['login'], { approveAs: ada.browser });
  await guest.cli(['login'], { approveAs: bob.browser });
  const { project } = await projectWithTracks(ada, 'Nachtfahrt', ['Tunnel', 'Brücke']);
  await db.insert(projectMembers).values({ projectId: project.id, userId: bob.id, role: 'producer' });
  const create = ['deliveries', 'create', '--project', project.id, '--client', 'Lea', '--price', '80', '--json'];

  const first = deliveryJson.parse((await studio.cli(create)).json()).delivery;
  expect(first).toMatchObject({ tracks: [{ name: 'Tunnel' }, { name: 'Brücke' }], totals: { totalCents: 16000 }, includeStems: true });

  expect(await guest.cli(['deliveries', 'list'])).toMatchObject({ code: 0, out: texts.noDeliveries });
  expect(await guest.cli(['deliveries', 'create', '--project', 'Nachtfahrt', '--client', 'Lea', '--price', '80'])).toMatchObject({
    code: 1,
    err: texts.notOwner('Nachtfahrt'),
  });
  expect((await guest.cli(['deliveries', 'cancel', first.id])).code).toBe(1);

  const cancelled = await studio.cli(['deliveries', 'cancel', first.id]);
  expect(cancelled.code).toBe(0);
  expect(cancelled.out).toContain('Order for Lea · canceled');

  const second = deliveryJson.parse((await studio.cli(create)).json()).delivery;
  expect(second.linkToken).toBe(first.linkToken);
  expect((await studio.cli(['deliveries', 'list', '--json'])).json()).toEqual({ deliveries: [expect.objectContaining({ id: second.id, status: 'open' })] });

  expect((await studio.cli(['deliveries'])).code).toBe(2);
  expect((await studio.cli(['deliveries', 'show'])).code).toBe(2);
  expect((await studio.cli(['deliveries', 'frobnicate'])).code).toBe(2);
  expect((await studio.cli(['--help'])).out).toContain('deliveries confirm-payment <ID>');
});

test('board lists the tracks by stage and moves one, as far as the role allows', async () => {
  const ada = await person();
  const bob = await person('Bob');
  const studio = await device();
  const listener = await device();
  await studio.cli(['login'], { approveAs: ada.browser });
  await listener.cli(['login'], { approveAs: bob.browser });
  const { project, tracks: songs } = await projectWithTracks(ada, 'Nachtfahrt', ['Morgenrot', 'Abendrot']);
  await db.insert(projectMembers).values({ projectId: project.id, userId: bob.id, role: 'viewer' });

  expect((await studio.cli(['board'])).out).toBe('Demo (2)\n  Morgenrot · Nachtfahrt\n  Abendrot · Nachtfahrt');

  const move = ['board', 'move', 'mixing', '--project', 'nachtfahrt', '--track', 'abendrot'];
  expect(await studio.cli(move)).toMatchObject({ code: 0, out: 'Abendrot is now in Mix.' });
  expect((await db.select({ status: tracks.status }).from(tracks).where(eq(tracks.id, songs[1]!.id)))[0]).toEqual({ status: 'mixing' });
  expect((await studio.cli(['board', '--project', project.id])).out).toBe('Demo (1)\n  Morgenrot\n\nMix (1)\n  Abendrot');
  expect((await studio.cli(['board', '--json'])).json()).toEqual({
    tracks: [
      { id: songs[0]!.id, name: 'Morgenrot', status: 'sketch', projectId: project.id, project: 'Nachtfahrt' },
      { id: songs[1]!.id, name: 'Abendrot', status: 'mixing', projectId: project.id, project: 'Nachtfahrt' },
    ],
  });

  // Listening only: the API refuses, the stage stays
  expect((await listener.cli(['board', 'move', 'final', '--project', 'Nachtfahrt', '--track', 'Morgenrot'])).code).toBe(1);
  expect((await db.select({ status: tracks.status }).from(tracks).where(eq(tracks.id, songs[0]!.id)))[0]).toEqual({ status: 'sketch' });

  // in_progress only stays for tracks that have it, nothing moves there
  expect((await studio.cli([...move.slice(0, 2), 'in_progress', ...move.slice(3)])).code).toBe(2);
  expect(await studio.cli(['board', 'move', 'final', '--project', 'Nachtfahrt', '--track', 'Mittag'])).toMatchObject({ code: 1, err: texts.noSuchTrack('Mittag') });
  expect((await studio.cli(['board', 'move', 'final', '--project', 'Nachtfahrt'])).code).toBe(2);
  expect((await studio.cli(['board', 'frobnicate'])).code).toBe(2);
});

// Last, since it fills Music Hub up
test('the CLI creates no account once Music Hub is full', async () => {
  const [{ count }] = await db.execute<{ count: number }>(sql`select count(*)::int as count from users`);
  for (let i = count; i < MAX_USERS; i++) await person();
  const email = `cli-${crypto.randomUUID()}@example.com`;
  const { cli } = await device();

  const login = await cli(['login', '--link', await loginLink(email), '--json']);
  expect(login.code).toBe(1);
  expect(login.json()).toEqual({ error: expect.stringContaining('Music Hub is full right now') });
  expect(await db.select({ id: users.id }).from(users).where(eq(users.email, email))).toHaveLength(0);
});
