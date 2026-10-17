import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb, migrateDb, users, sessions, projects, projectMembers, tracks, contactRequests, pushNotifications } from '@music-hub/db';
import { hashToken } from './middleware/auth.js';
import { pushRoutes } from './routes/push.js';
import { saveNotifications } from './lib/push-notifications.js';
import { pushSignal } from './services/push.js';
import type { AppEnv } from './types.js';

const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>().use('*', async (c, next) => { c.set('db', db); await next(); }).route('/push', pushRoutes);
const userIds: string[] = [];
let owner: string, recipient: string, outsider: string, projectId: string, trackId: string;
const tokens = new Map<string, string>();
const request = (path: string, userId?: string) => app.request(`/push/notifications${path}`, { headers: userId ? { cookie: `session=${tokens.get(userId)}` } : {} });
const save = () => saveNotifications(db, [recipient], { projectId, trackId, title: 'Private title', body: 'Private person and track', url: `/projects/${projectId}/tracks/${trackId}` });

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  for (let i = 0; i < 3; i++) {
    const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Push test' }).returning();
    userIds.push(u.id);
    const token = crypto.randomUUID();
    tokens.set(u.id, token);
    await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 86400000) });
  }
  [owner, recipient, outsider] = userIds;
  const [p] = await db.insert(projects).values({ name: 'Push test', createdById: owner }).returning();
  projectId = p.id;
  await db.insert(projectMembers).values({ projectId, userId: recipient, role: 'viewer' });
  const [t] = await db.insert(tracks).values({ projectId, createdById: owner, name: 'Private track' }).returning();
  trackId = t.id;
});
afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('wire payload is an explicit allowlist, never notification details', () => {
  const payload = pushSignal(42n);
  expect(payload).toEqual({ type: 'notification', id: '42' });
  expect(Object.keys(payload).sort()).toEqual(['id', 'type']);
});

test('details require auth, recipient ownership and current membership', async () => {
  const [n] = await save();
  expect((await request(`/${n.id}`)).status).toBe(401);
  expect((await request(`/${n.id}`, outsider)).status).toBe(404);
  const response = await request(`/${n.id}`, recipient);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).notification.body).toBe(n.body);
  await db.delete(projectMembers).where(eq(projectMembers.userId, recipient));
  expect((await request(`/${n.id}`, recipient)).status).toBe(404);
  await db.insert(projectMembers).values({ projectId, userId: recipient, role: 'viewer' });
  await db.update(tracks).set({ deletedAt: new Date() }).where(eq(tracks.id, trackId));
  expect((await request(`/${n.id}`, recipient)).status).toBe(404);
  await db.update(tracks).set({ deletedAt: null }).where(eq(tracks.id, trackId));
});

test('feed recovers lost signals, pages in cursor order and resets across accounts', async () => {
  const created = await Promise.all(Array.from({ length: 52 }, save));
  const ids = created.flat().map((n) => n.id.toString());
  let cursor = '0';
  const found: string[] = [];
  for (let i = 0; i < 3; i++) {
    const data = await (await request(`?account=${recipient}&since=${cursor}`, recipient)).json();
    found.push(...data.notifications.map((n: { id: string }) => n.id));
    cursor = data.cursor;
    if (!data.more) break;
  }
  expect(ids.every((id) => found.includes(id))).toBe(true);
  expect(new Set(found).size).toBe(found.length);
  expect((await (await request(`?account=${recipient}&since=${cursor}`, recipient)).json()).notifications).toEqual([]);
  expect((await (await request(`?account=${outsider}&since=${cursor}`, recipient)).json()).notifications.length).toBeGreaterThan(0);
  expect((await request(`?account=${recipient}&since=9223372036854775808`, recipient)).status).toBe(400);
  expect((await request('/nope', recipient)).status).toBe(404);
});

test('contact request details respect sender blocks, declines and recipient blocks', async () => {
  const [r] = await db.insert(contactRequests).values({ fromUserId: owner, toUserId: recipient, message: 'Private' }).returning();
  const [n] = await saveNotifications(db, [recipient], { requestId: r.id, title: 'Request', body: r.message, url: '/for-you' });
  expect((await request(`/${n.id}`, recipient)).status).toBe(200);
  await db.update(users).set({ blockedAt: new Date() }).where(eq(users.id, owner));
  expect((await request(`/${n.id}`, recipient)).status).toBe(404);
  const feed = await (await request(`?account=${recipient}&since=${n.id - 1n}`, recipient)).json();
  expect(feed.notifications.some((item: { id: string }) => item.id === n.id.toString())).toBe(false);
  await db.update(users).set({ blockedAt: null }).where(eq(users.id, owner));
  await db.update(contactRequests).set({ status: 'declined' }).where(eq(contactRequests.id, r.id));
  expect((await request(`/${n.id}`, recipient)).status).toBe(404);
  await db.update(users).set({ blockedAt: new Date() }).where(eq(users.id, recipient));
  expect((await request(`/${n.id}`, recipient)).status).toBe(401);
  await db.update(users).set({ blockedAt: null }).where(eq(users.id, recipient));
});

test('expired details are inaccessible', async () => {
  const [old] = await save();
  await db.update(pushNotifications).set({ createdAt: sql`now() - interval '8 days'` }).where(eq(pushNotifications.id, old.id));
  expect((await request(`/${old.id}`, recipient)).status).toBe(404);
});
