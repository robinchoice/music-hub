import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { inArray } from 'drizzle-orm';
import { createDb, migrateDb, sessions, users } from '@music-hub/db';
import { generateToken, hashToken } from './middleware/auth.js';
import { ADMIN_EMAILS } from './lib/admin.js';
import { adminRoutes } from './routes/admin.js';
import type { AppEnv } from './types.js';

// ADMIN_EMAILS is read once on import, other test files may have imported it already.
const ADMIN = `admin-${crypto.randomUUID()}@example.com`;
ADMIN_EMAILS.add(ADMIN);

// The admin pages open only for addresses in ADMIN_EMAILS. Runs against DATABASE_URL with rows of its own.
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/admin', adminRoutes);
const userIds: string[] = [];
const session = async (email: string) => {
  const [u] = await db.insert(users).values({ email, name: 'Admin test' }).returning();
  userIds.push(u.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  return { id: u.id, headers: { authorization: `Bearer ${token}` } };
};
let admin: { id: string; headers: Record<string, string> }, member: { id: string; headers: Record<string, string> };

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  admin = await session(ADMIN);
  member = await session(`test-${crypto.randomUUID()}@example.com`);
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('the admin pages answer 401 without a session and 403 to everyone else', async () => {
  expect((await app.request('/admin/users')).status).toBe(401);
  expect((await app.request('/admin/users', { headers: member.headers })).status).toBe(403);
  expect((await app.request(`/admin/users/${admin.id}/block`, { method: 'POST', headers: member.headers })).status).toBe(403);
  expect((await app.request('/admin/overview', { headers: member.headers })).status).toBe(403);
});

test('an admin sees the people', async () => {
  const res = await app.request('/admin/users', { headers: admin.headers });
  expect(res.status).toBe(200);
  const { people } = (await res.json()) as { people: { id: string }[] };
  expect(people.map((p) => p.id)).toEqual(expect.arrayContaining([admin.id, member.id]));
});
