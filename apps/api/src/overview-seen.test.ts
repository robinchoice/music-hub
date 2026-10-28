import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { inArray } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, sessions, users } from '@music-hub/db';
import { generateToken, hashToken } from './middleware/auth.js';
import { overviewRoutes } from './routes/overview.js';
import type { AppEnv } from './types.js';

// New markers count per project. Runs against DATABASE_URL with rows of its own, which go again at the end.
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/overview', overviewRoutes);
let userId: string;
let headers: Record<string, string>;
let first: string, second: string;

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Robin' }).returning();
  userId = u.id;
  const token = generateToken();
  await db.insert(sessions).values({ userId, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  headers = { authorization: `Bearer ${token}` };
  const rows = await db.insert(projects).values([{ name: 'Fernlicht', createdById: userId }, { name: 'Kreide', createdById: userId }]).returning();
  [first, second] = rows.map((p) => p.id);
  await db.insert(projectMembers).values(rows.map((p) => ({ projectId: p.id, userId, role: 'owner' as const, canUpload: true, canApprove: true })));
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, [userId]));
  await db.delete(users).where(inArray(users.id, [userId]));
  await db.$client.end();
});

const seenAtOf = async () => {
  const body = (await (await app.request('/overview', { headers })).json()) as { projects: { id: string; seenAt: string | null }[]; tracksSeenAt: string | null };
  const projectSeen: Record<string, string | null> = Object.fromEntries(body.projects.map((p) => [p.id, p.seenAt]));
  return { projectSeen, all: body.tracksSeenAt };
};

test('leaving one project marks only that one as seen', async () => {
  const res = await app.request('/overview/seen', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: first }) });
  expect(res.status).toBe(200);
  const seen = await seenAtOf();
  expect(seen.projectSeen[first]).toBeString();
  expect(seen.projectSeen[second]).toBeNull();
  expect(seen.all).toBeNull();
});

test('older web versions post without a body and mark all projects as before', async () => {
  expect((await app.request('/overview/seen', { method: 'POST', headers })).status).toBe(200);
  expect((await seenAtOf()).all).toBeString();
});
