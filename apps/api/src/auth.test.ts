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

test('a browser session in use is renewed, a bearer session is not', async () => {
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
  expect(await cookieExpiry()).toBeGreaterThan(Date.now() + 29 * DAY);

  // Renewed sessions are left alone for a day
  const again = await app.request('/auth/me', { headers: { cookie: `session=${cookieToken}` } });
  expect(again.headers.get('set-cookie')).toBeNull();

  // The plugin keeps the expiry it was given
  const bearerToken = generateToken();
  const bearerExpiry = await session(bearerToken);
  await app.request('/auth/me', { headers: { authorization: `Bearer ${bearerToken}` } });
  expect(await bearerExpiry()).toBeLessThan(Date.now() + 60_000);
});
