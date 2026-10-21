import { z } from 'zod';
import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { createDb, magicLinks, migrateDb, sessions, updateDeliveries, updates, users } from '@music-hub/db';
import { ADMIN_EMAILS } from './lib/admin.js';
import { authRoutes } from './routes/auth.js';
import { updateRoutes } from './routes/updates.js';
import { generateToken, hashToken } from './middleware/auth.js';
import { updateMail } from './services/email.js';
import { deliverNext, parseDraft, readDrafts, redact } from './lib/updates.js';
import type { AppEnv } from './types.js';

// Runs against DATABASE_URL like auth.test.ts, with fresh accounts only.
// ADMIN_EMAILS is read once on import, other test files may have imported it already.
const ADMIN = `admin-${crypto.randomUUID()}@example.com`;
ADMIN_EMAILS.add(ADMIN);
process.env.APP_URL = 'https://app.test';

const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.set('db', db);
    await next();
  })
  .route('/auth', authRoutes)
  .route('/updates', updateRoutes);
const log = spyOn(console, 'log');
const emails: string[] = [];
const updateIds: string[] = [];

beforeAll(() => migrateDb(process.env.DATABASE_URL!));
afterAll(async () => {
  await db.delete(updates).where(inArray(updates.id, updateIds));
  await db.delete(users).where(inArray(users.email, emails));
  await db.delete(magicLinks).where(inArray(magicLinks.email, emails));
  await db.$client.end();
});

const ip = crypto.randomUUID();
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const content = { title: 'Spuren als <ZIP>', features: ['Ein Klick lädt alle Spuren', 'Auch am Handy'] };

// Existing accounts, so a full Music Hub (MAX_USERS) doesn't get in the way
async function account(email = `test-${crypto.randomUUID()}@example.com`) {
  emails.push(email);
  await db.insert(users).values({ email, name: 'Lena' });
  return email;
}

function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

async function body(res: Response | Promise<Response>): Promise<unknown> {
  return (await res).json();
}

const userAnswer = z.object({ user: z.object({ name: z.string(), updatesSince: z.string().nullable() }) });
const updateAnswer = z.object({ update: z.looseObject({ id: z.string(), hasImage: z.boolean(), sentAt: z.string().nullable(), pending: z.number().optional() }) });
async function read<T extends z.ZodType>(res: Response | Promise<Response>, schema: T): Promise<z.output<T>> {
  return schema.parse(await body(res));
}

const lastMail = () =>
  log.mock.calls
    .map((args) => String(args[0]))
    .findLast((line) => line.startsWith('[DEV] Magic link'))!;

async function logInWithLink(email: string, updates?: boolean) {
  await request('POST', '/auth/magic-link', { email, updates });
  const token = new URL(lastMail().split(': ').at(-1)!).searchParams.get('token');
  return read(request('POST', '/auth/verify', { token }), userAnswer);
}

async function session(email: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  const token = generateToken();
  await db.insert(sessions).values({ userId: user!.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 60_000) });
  return { cookie: `session=${token}` };
}

const userRow = async (email: string) => (await db.select().from(users).where(eq(users.email, email)))[0]!;

test('the ticked checkbox opts in once the link is opened, the unticked one changes nothing', async () => {
  const email = await account();
  await request('POST', '/auth/magic-link', { email, updates: true });
  const [link] = await db.select().from(magicLinks).where(eq(magicLinks.email, email));
  expect(link!.updatesOptIn).toBe(true);
  expect((await userRow(email)).updatesConsentAt).toBeNull();

  const token = new URL(lastMail().split(': ').at(-1)!).searchParams.get('token');
  const { user } = await read(request('POST', '/auth/verify', { token }), userAnswer);
  expect(user.updatesSince).toEqual(expect.any(String));

  // Consent keeps its first date, an unticked login leaves it on
  const again = await logInWithLink(email, false);
  expect(again.user.updatesSince).toBe(user.updatesSince);

  expect((await logInWithLink(await account())).user.updatesSince).toBeNull();
});

test('the account switch turns update mails on and off', async () => {
  const headers = await session(await account());
  const on = await read(request('PATCH', '/auth/me', { updates: true }, headers), userAnswer);
  expect(on.user.updatesSince).toEqual(expect.any(String));
  expect(on.user.name).toBe('Lena');
  const off = await read(request('PATCH', '/auth/me', { updates: false }, headers), userAnswer);
  expect(off.user.updatesSince).toBeNull();
});

test('the unsubscribe link works without login, also as one-click POST', async () => {
  const email = await account();
  await logInWithLink(email, true);
  const { mailToken, versionMails } = await userRow(email);

  // What mail clients send for List-Unsubscribe-Post
  const res = await app.request(`/updates/unsubscribe?t=${mailToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  expect(res.status).toBe(200);
  expect((await userRow(email)).updatesConsentAt).toBeNull();
  // The version mails have their own switch
  expect((await userRow(email)).versionMails).toBe(versionMails);

  expect((await request('POST', `/updates/subscribe?t=${mailToken}`)).status).toBe(200);
  expect((await userRow(email)).updatesConsentAt).not.toBeNull();
});

test('only admins see and write updates', async () => {
  const headers = await session(await account());
  expect((await request('GET', '/updates', undefined, headers)).status).toBe(403);
  expect((await request('POST', '/updates', { content }, headers)).status).toBe(403);
  expect((await request('GET', '/updates')).status).toBe(401);
});

test('the admin drafts, previews, tests and sends; the API delivers to opted-in accounts', async () => {
  const admin = await session(await account(ADMIN));
  const subscriber = await account();
  const leaving = await account();
  const bystander = await account();
  await logInWithLink(subscriber, true);
  await logInWithLink(leaving, true);
  await logInWithLink(bystander);

  const created = await read(request('POST', '/updates', { content: { title: 'Spuren', features: [] } }, admin), updateAnswer);
  const id = created.update.id;
  updateIds.push(id);
  expect(created.update).toMatchObject({ slug: null, sentAt: null, hasImage: false });

  // Incomplete drafts save, but don't send
  expect((await request('POST', `/updates/${id}/send`, undefined, admin)).status).toBe(400);
  const saved = await read(request('PUT', `/updates/${id}`, { content, image: PNG.toString('base64') }, admin), updateAnswer);
  expect(saved.update.hasImage).toBe(true);
  expect((await request('PUT', `/updates/${id}`, { content, image: Buffer.from('nope').toString('base64') }, admin)).status).toBe(400);

  // The preview escapes the content, the image is public by its id
  const preview = await (await request('GET', `/updates/${id}/preview`, undefined, admin)).text();
  expect(preview).toContain('Spuren als &lt;ZIP&gt;');
  const image = await request('GET', `/updates/${id}/image`);
  expect(image.headers.get('content-type')).toBe('image/png');

  expect((await request('POST', `/updates/${id}/test`, undefined, admin)).status).toBe(200);

  const before = (await read(request('GET', '/updates', undefined, admin), z.object({ subscribers: z.number() }))).subscribers;
  const sent = await read(request('POST', `/updates/${id}/send`, undefined, admin), updateAnswer);
  expect(sent.update.sentAt).toEqual(expect.any(String));
  expect(sent.update.pending).toBe(before);
  // Twice is harmless, and a sent update stays as it went out
  expect((await request('POST', `/updates/${id}/send`, undefined, admin)).status).toBe(409);
  expect((await request('PUT', `/updates/${id}`, { content }, admin)).status).toBe(409);
  expect((await request('DELETE', `/updates/${id}`, undefined, admin)).status).toBe(409);

  // Unsubscribed after the send: skipped instead of mailed
  await request('POST', `/updates/unsubscribe?t=${(await userRow(leaving)).mailToken}`);
  // The API that the browser tests start delivers from the same database, so
  // either may send a row: the statuses count, not who sent them
  const statuses = async () =>
    Object.fromEntries(
      (
        await db
          .select({ email: users.email, status: updateDeliveries.status })
          .from(updateDeliveries)
          .innerJoin(users, eq(users.id, updateDeliveries.userId))
          .where(eq(updateDeliveries.updateId, id))
      ).map((row) => [row.email, row.status]),
    );
  for (let i = 0; i < 50 && Object.values(await statuses()).includes('pending'); i++) {
    if ((await deliverNext(db, 0)) === 'idle') await Bun.sleep(100);
  }
  const delivered = await statuses();
  expect(delivered[subscriber]).toBe('sent');
  expect(delivered[leaving]).toBe('skipped');
  expect(delivered[bystander]).toBeUndefined();
});

test('the update mail carries one-click unsubscribe and escapes its content', () => {
  const token = crypto.randomUUID();
  const mail = updateMail({ id: crypto.randomUUID(), content, hasImage: false, date: new Date(2026, 9, 16) }, token);
  expect(mail.subject).toBe('Neu in Music Hub: Spuren als <ZIP>');
  expect(mail.headers['List-Unsubscribe']).toBe(`<https://app.test/api/v1/updates/unsubscribe?t=${token}>`);
  expect(mail.html).toContain(`https://app.test/abbestellen?liste=updates&t=${token}`);
  expect(mail.html).not.toContain('<ZIP>');
  expect(mail.text).toContain('16. Oktober 2026');
});

test('drafts parse from updates/*.md, broken ones say where', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'updates-'));
  writeFileSync(path.join(dir, 'zip.png'), PNG);
  const draft = parseDraft('zip', '# Spuren als ZIP\n- Ein Klick lädt alle Spuren\n\n![](zip.png)\n', dir);
  expect(draft.content).toEqual({ title: 'Spuren als ZIP', features: ['Ein Klick lädt alle Spuren'] });
  expect(draft.image).toEqual(PNG);
  expect(() => parseDraft('x', '# Nur ein Titel', dir)).toThrow('needs a title and at least one feature');
  expect(() => parseDraft('x', '# Titel\nFließtext', dir)).toThrow('line 2');
  // Every draft in the repo parses, so a deploy never imports a broken one
  expect(() => readDrafts()).not.toThrow();
});

test('SMTP errors lose the address before they reach the log', () => {
  const err = Object.assign(new Error('550 Mailbox lena@example.com unavailable'), { responseCode: 550 });
  expect(redact(err)).toBe('550 550 Mailbox <address> unavailable');
});
