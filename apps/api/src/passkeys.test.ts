import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { createDb, migrateDb, passkeys, passkeyChallenges, sessions, users } from '@music-hub/db';
import { passkeyRoutes } from './routes/passkeys.js';
import { generateToken, hashToken } from './middleware/auth.js';
import type { AppEnv } from './types.js';

const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>().use('*', async (c, next) => { c.set('db', db); await next(); }).route('/passkeys', passkeyRoutes);
const ids: string[] = [];
const challenges: string[] = [];

beforeAll(() => migrateDb(process.env.DATABASE_URL!));
afterAll(async () => {
  if (challenges.length) await db.delete(passkeyChallenges).where(inArray(passkeyChallenges.challenge, challenges));
  if (ids.length) await db.delete(users).where(inArray(users.id, ids));
  await db.$client.end();
});

async function account() {
  const [user] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Lena' }).returning();
  ids.push(user.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: user.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 600000) });
  return { user, cookie: `session=${token}` };
}

function post(path: string, response: unknown, cookie = '') {
  return app.request(`/passkeys${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': crypto.randomUUID(), cookie }, body: JSON.stringify({ response }) });
}

const credential = (id: string) => ({
  id, rawId: id, type: 'public-key', clientExtensionResults: {},
  response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
});

test('passkey management needs a session', async () => {
  expect((await app.request('/passkeys')).status).toBe(401);
  expect((await post('/register/options', {})).status).toBe(401);
  expect((await post('/register', {})).status).toBe(401);
  expect((await app.request('/passkeys/id', { method: 'DELETE' })).status).toBe(401);
});

test('registration challenges are account-bound, exclude existing keys and use the app URL', async () => {
  const { user, cookie } = await account();
  const res = await post('/register/options', {}, cookie);
  expect(res.status).toBe(200);
  const options = await res.json();
  challenges.push(options.challenge);
  const [row] = await db.select().from(passkeyChallenges).where(eq(passkeyChallenges.challenge, options.challenge));
  expect(row.userId).toBe(user.id);
  expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 290000);
  expect(options.rp.id).toBe(new URL(process.env.APP_URL || 'http://localhost:5173').hostname);
  expect(options.authenticatorSelection.residentKey).toBe('required');
  expect((await post('/register', { id: 'bad' }, cookie)).status).toBe(400);
});

test('login challenges persist across requests and malformed credentials return 400', async () => {
  const res = await post('/login/options', {});
  const options = await res.json();
  challenges.push(options.challenge);
  const [row] = await db.select().from(passkeyChallenges).where(eq(passkeyChallenges.challenge, options.challenge));
  expect(row.userId).toBeNull();
  const bad = await post('/login', credential('unknown'));
  expect(bad.status).toBe(400);
  expect((await bad.json()).code).toBe('passkeyUnknown');
});

test('a user can only list and delete their own keys, and blocked users cannot use them', async () => {
  const owner = await account();
  const other = await account();
  const id = generateToken();
  await db.insert(passkeys).values({ id, userId: owner.user.id, publicKey: Buffer.from([1]), counter: 0, backedUp: false });
  const keys = await app.request('/passkeys', { headers: { cookie: owner.cookie } });
  expect((await keys.json()).passkeys.map((k: { id: string }) => k.id)).toEqual([id]);
  const foreign = await app.request(`/passkeys/${id}`, { method: 'DELETE', headers: { cookie: other.cookie } });
  expect(foreign.status).toBe(404);
  await db.update(users).set({ blockedAt: new Date() }).where(eq(users.id, owner.user.id));
  expect((await post('/login', credential(id))).status).toBe(403);
  await db.update(users).set({ blockedAt: null }).where(eq(users.id, owner.user.id));
  const removed = await app.request(`/passkeys/${id}`, { method: 'DELETE', headers: { cookie: owner.cookie } });
  expect(removed.status).toBe(200);
  expect((await post('/login', credential(id))).status).toBe(400);
});
