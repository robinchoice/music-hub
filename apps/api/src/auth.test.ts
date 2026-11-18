import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { createDb, magicLinks, migrateDb, sessions, users } from '@music-hub/db';
import { authRoutes } from './routes/auth.js';
import { generateToken, hashToken } from './middleware/auth.js';
import type { AppEnv } from './types.js';

// Runs against DATABASE_URL. Only adds rows with fresh addresses and removes them at the end.
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.set('db', db);
    await next();
  })
  .route('/auth', authRoutes);
const emails: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

function freshEmail() {
  const email = `test-${crypto.randomUUID()}@example.com`;
  emails.push(email);
  return email;
}

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.email, emails));
  await db.delete(magicLinks).where(inArray(magicLinks.email, emails));
  await db.$client.end();
});

test('login-link prints a magic link that logs in', async () => {
  const email = freshEmail();
  const run = Bun.spawnSync(['bun', 'src/login-link.ts', email], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, APP_URL: 'https://app.test' },
  });
  const link = new URL(run.stdout.toString().trim());
  expect(link.origin + link.pathname).toBe('https://app.test/auth/verify');

  const verify = await app.request('/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: link.searchParams.get('token') }),
  });
  expect((await verify.json()).user.email).toBe(email);
});

test('browser and bearer sessions renew for a year, at most once daily', async () => {
  const [user] = await db.insert(users).values({ email: freshEmail(), name: 'Lena' }).returning({ id: users.id });
  const session = async (token: string) => {
    const [row] = await db
      .insert(sessions)
      .values({ userId: user.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 60_000) })
      .returning({ id: sessions.id });
    return async () => (await db.select().from(sessions).where(eq(sessions.id, row.id)))[0].expiresAt.getTime();
  };

  const cookieToken = generateToken();
  const cookieExpiry = await session(cookieToken);
  const me = await app.request('/auth/me', { headers: { cookie: `session=${cookieToken}` } });
  expect(me.headers.get('set-cookie')).toContain(`session=${cookieToken}`);
  expect(await cookieExpiry()).toBeGreaterThan(Date.now() + 364 * DAY);

  // Renewed sessions are left alone for a day
  const again = await app.request('/auth/me', { headers: { cookie: `session=${cookieToken}` } });
  expect(again.headers.get('set-cookie')).toBeNull();

  // The plugin renews too, without setting a browser cookie
  const bearerToken = generateToken();
  const bearerExpiry = await session(bearerToken);
  const bearer = await app.request('/auth/me', { headers: { authorization: `Bearer ${bearerToken}` } });
  expect(bearer.headers.get('set-cookie')).toBeNull();
  expect(await bearerExpiry()).toBeGreaterThan(Date.now() + 364 * DAY);
});

const post = (path: string, body: unknown) => app.request(`/auth${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': crypto.randomUUID() },
  body: JSON.stringify(body),
});

async function codeLink(email: string, code = '123456', expiresAt = new Date(Date.now() + 60_000)) {
  const token = generateToken();
  await db.insert(magicLinks).values({ email, token: await hashToken(token), codeHash: await hashToken(code), expiresAt, updatesOptIn: true });
  return token;
}

test('requesting a login mail stores a hashed code', async () => {
  const email = freshEmail();
  await db.insert(users).values({ email, name: 'Lena' });
  const { spyOn } = await import('bun:test');
  // Local dev has no SMTP; capture the mail log without printing a login token.
  const log = spyOn(console, 'log').mockImplementation(() => {});
  try {
    expect((await post('/magic-link', { email })).status).toBe(200);
    const [link] = await db.select().from(magicLinks).where(eq(magicLinks.email, email));
    expect(link.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(link.codeAttempts).toBe(0);
  } finally { log.mockRestore(); }
});

test('a code issues only an httpOnly cookie and consumes the matching link, including consent', async () => {
  const email = freshEmail();
  await db.insert(users).values({ email, name: 'Lena' });
  const token = await codeLink(email);
  const res = await post('/code/verify', { email: email.toUpperCase(), code: '123456' });
  expect(res.status).toBe(200);
  expect(res.headers.get('set-cookie')).toContain('HttpOnly');
  expect(res.headers.get('set-cookie')).toContain('Max-Age=31536000');
  const body = await res.json();
  expect(body.token).toBeUndefined();
  expect(body.user.updatesSince).not.toBeNull();
  expect((await post('/verify', { token })).status).toBe(400);
  expect((await post('/code/verify', { email, code: '123456' })).status).toBe(400);
});

test('using the link also consumes its code', async () => {
  const email = freshEmail();
  await db.insert(users).values({ email, name: 'Lena' });
  const token = await codeLink(email);
  expect((await post('/verify', { token })).status).toBe(200);
  expect((await post('/code/verify', { email, code: '123456' })).status).toBe(400);
});

test('five wrong guesses lock every active code even with parallel requests and different IPs', async () => {
  const email = freshEmail();
  await codeLink(email);
  await codeLink(email, '654321');
  const guesses = await Promise.all(Array.from({ length: 5 }, () => post('/code/verify', { email, code: '000000' })));
  expect(guesses.every((r) => r.status === 400)).toBe(true);
  expect((await post('/code/verify', { email, code: '123456' })).status).toBe(400);
  expect((await post('/code/verify', { email, code: '654321' })).status).toBe(400);
});

test('a code cannot be redeemed concurrently twice, after expiry or for a blocked user', async () => {
  const email = freshEmail();
  await db.insert(users).values({ email, name: 'Lena' });
  await codeLink(email);
  const res = await Promise.all([post('/code/verify', { email, code: '123456' }), post('/code/verify', { email, code: '123456' })]);
  expect(res.map((r) => r.status).sort()).toEqual([200, 400]);
  await codeLink(email, '654321', new Date(Date.now() - 1000));
  expect((await post('/code/verify', { email, code: '654321' })).status).toBe(400);
  await db.update(users).set({ blockedAt: new Date() }).where(eq(users.email, email));
  await codeLink(email, '111111');
  expect((await post('/code/verify', { email, code: '111111' })).status).toBe(403);
});

test('renewal preserves the passkey login method for the admin history', async () => {
  const [user] = await db.insert(users).values({ email: freshEmail(), name: 'Lena' }).returning();
  const token = generateToken();
  const [session] = await db.insert(sessions).values({ userId: user.id, client: 'passkey', tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 60_000) }).returning();
  const res = await app.request('/auth/me', { headers: { cookie: `session=${token}` } });
  expect(res.status).toBe(200);
  const [renewed] = await db.select().from(sessions).where(eq(sessions.id, session.id));
  expect(renewed.client).toBe('passkey');
  expect(renewed.expiresAt.getTime()).toBeGreaterThan(Date.now() + 364 * DAY);
});

test('magic link verification limits each IP without consuming blocked links', async () => {
  const email = freshEmail();
  await db.insert(users).values({ email, name: 'Lena' });
  const token = await codeLink(email);
  const ip = crypto.randomUUID();
  const verify = (value: string, address = ip) => app.request('/auth/verify', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
    body: JSON.stringify({ token: value }),
  });
  const guesses = await Promise.all(Array.from({ length: 60 }, () => verify('invalid')));
  expect(guesses.map((res) => res.status)).toEqual(Array(60).fill(400));
  const blocked = await verify(token);
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get('set-cookie')).toBeNull();
  expect((await verify(token, crypto.randomUUID())).status).toBe(200);
  const next = await codeLink(email);
  const { rateLimits } = await import('@music-hub/db');
  await db.update(rateLimits).set({ resetAt: new Date(Date.now() - 1) }).where(eq(rateLimits.key, `link-checks-per-ip:${ip}`));
  expect((await verify(next)).status).toBe(200);
});

test('errors follow the locale cookie, else Accept-Language, and the web stores the language for mails', async () => {
  const wrong = async (headers: Record<string, string>) => {
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': crypto.randomUUID(), ...headers },
      body: JSON.stringify({ email: freshEmail(), password: 'not-the-password' }),
    });
    return res.json();
  };
  expect((await wrong({})).error).toBe('E-Mail oder Passwort falsch');
  expect((await wrong({ 'accept-language': 'en-GB,en;q=0.9' })).error).toBe('Wrong email or password');
  expect((await wrong({ 'accept-language': 'en', cookie: 'locale=de' })).error).toBe('E-Mail oder Passwort falsch');

  const [user] = await db.insert(users).values({ email: freshEmail(), name: 'Kim' }).returning({ id: users.id });
  const token = generateToken();
  await db.insert(sessions).values({ userId: user.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 60_000) });
  const locale = async () => (await db.select({ locale: users.locale }).from(users).where(eq(users.id, user.id)))[0].locale;
  // Plugin and CLI leave the language alone, even when they ask for English
  await app.request('/auth/me', { headers: { authorization: `Bearer ${token}`, 'accept-language': 'en' } });
  expect(await locale()).toBe('de');
  await app.request('/auth/me', { headers: { cookie: `session=${token}; locale=en` } });
  expect(await locale()).toBe('en');
});

test('a browser keeps up to five accounts signed in, switches between them and logs out one after another', async () => {
  const people = await db
    .insert(users)
    .values(Array.from({ length: 6 }, (_, i) => ({ email: freshEmail(), name: `Person ${i}` })))
    .returning({ id: users.id });
  const tokens = await Promise.all(people.map(async (person) => {
    const token = generateToken();
    await db.insert(sessions).values({ userId: person.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + DAY) });
    return token;
  }));
  const alive = async (token: string) => (await db.select().from(sessions).where(eq(sessions.tokenHash, await hashToken(token)))).length === 1;

  // A cookie jar like the browser's
  const jar = new Map<string, string>();
  const send = async (path: string, method = 'GET', body?: unknown) => {
    const res = await app.request(`/auth${path}`, {
      method,
      headers: {
        cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, value] = pair.split('=');
      if (/Max-Age=0/.test(cookie) || !value) jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  };
  const accounts = async () =>
    ((await (await send('/accounts')).json()).accounts as { id: string; active: boolean }[]).map((a) => `${a.id}${a.active ? '*' : ''}`);

  jar.set('session', tokens[0]);
  expect(await accounts()).toEqual([`${people[0].id}*`]);

  // Adding one sets the active account aside; signing in sets the new one active
  expect((await send('/accounts/add', 'POST')).status).toBe(200);
  expect(jar.has('session')).toBe(false);
  expect(await accounts()).toEqual([people[0].id]);
  jar.set('session', tokens[1]);
  expect(await accounts()).toEqual([`${people[1].id}*`, people[0].id]);

  const switched = await send('/accounts/switch', 'POST', { userId: people[0].id });
  expect((await switched.json()).user.id).toBe(people[0].id);
  expect(jar.get('session')).toBe(tokens[0]);
  expect(((await (await send('/me')).json()).user.id)).toBe(people[0].id);
  expect(await accounts()).toEqual([`${people[0].id}*`, people[1].id]);

  // Only accounts signed in here, never one by its ID alone
  expect((await send('/accounts/switch', 'POST', { userId: people[5].id })).status).toBe(404);

  // At most five
  for (const token of tokens.slice(2, 5)) {
    expect((await send('/accounts/add', 'POST')).status).toBe(200);
    jar.set('session', token);
  }
  expect(await accounts()).toHaveLength(5);
  expect((await send('/accounts/add', 'POST')).status).toBe(409);
  expect(jar.get('session')).toBe(tokens[4]);

  // A blocked account drops out of the list and cannot be switched to
  await db.update(users).set({ blockedAt: new Date() }).where(eq(users.id, people[3].id));
  expect(await accounts()).not.toContain(people[3].id);
  expect((await send('/accounts/switch', 'POST', { userId: people[3].id })).status).toBe(404);

  // Logging out ends only the active session, the next account takes over
  const logout = await send('/logout', 'POST');
  expect((await logout.json()).switched).toBe(true);
  expect(await alive(tokens[4])).toBe(false);
  expect(await alive(tokens[2])).toBe(true);
  expect(jar.has('session')).toBe(true);
  expect(await accounts()).toHaveLength(3);

  // ?all ends every session of this browser
  const signedInBefore = [jar.get('session')!, ...jar.get('accounts')!.split('.')];
  expect((await (await send('/logout?all', 'POST')).json()).switched).toBe(false);
  expect(jar.size).toBe(0);
  for (const token of signedInBefore) expect(await alive(token)).toBe(false);
});

test('regression: logging out of an account that was set aside and signed in again does not sign it back in', async () => {
  const [person] = await db.insert(users).values({ email: freshEmail(), name: 'Lena' }).returning({ id: users.id });
  const [first, second] = [generateToken(), generateToken()];
  for (const token of [first, second]) {
    await db.insert(sessions).values({ userId: person.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + DAY) });
  }
  const res = await app.request('/auth/logout', { method: 'POST', headers: { cookie: `session=${second}; accounts=${first}` } });
  expect((await res.json()).switched).toBe(false);
  expect(res.headers.getSetCookie().every((cookie) => /Max-Age=0/.test(cookie))).toBe(true);
  expect(await db.select().from(sessions).where(eq(sessions.userId, person.id))).toHaveLength(0);
});
