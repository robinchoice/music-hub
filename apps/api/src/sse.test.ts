import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, sessions, tracks, users } from '@music-hub/db';
import { hashToken } from './middleware/auth.js';
import { HEARTBEAT_MS, sseRoutes } from './routes/sse.js';
import type { AppEnv } from './types.js';

// Runs against DATABASE_URL; the rows are its own and go again at the end
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>().use('*', async (c, next) => { c.set('db', db); await next(); }).route('/sse', sseRoutes);
const token = crypto.randomUUID();
let userId: string;
let projectId: string;
let trackId: string;

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [{ id: userId }] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'SSE test' }).returning({ id: users.id });
  await db.insert(sessions).values({ userId, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) });
  [{ id: projectId }] = await db.insert(projects).values({ name: 'SSE test', createdById: userId }).returning({ id: projects.id });
  await db.insert(projectMembers).values({ projectId, userId, role: 'owner' });
  [{ id: trackId }] = await db.insert(tracks).values({ projectId, name: 'SSE test', createdById: userId }).returning({ id: tracks.id });
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(eq(users.id, userId));
  await db.$client.end();
});

test('an idle stream sends a heartbeat before the 10-second idle timeout of Bun', async () => {
  expect(HEARTBEAT_MS).toBeLessThan(10_000);
  const abort = new AbortController();
  const res = await app.request(`/sse/track/${trackId}`, { headers: { cookie: `session=${token}` }, signal: abort.signal });
  expect(res.status).toBe(200);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const started = performance.now();
  let received = '';
  while (!received.includes(': ping')) received += (await reader.read()).value ?? '';
  expect(received.startsWith(': connected')).toBe(true);
  expect(performance.now() - started).toBeLessThan(HEARTBEAT_MS + 1000);
  abort.abort();
}, 15_000);
