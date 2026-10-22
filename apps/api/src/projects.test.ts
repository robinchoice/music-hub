import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { and, eq, inArray, like } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, sessions, users } from '@music-hub/db';
import { generateToken, hashToken } from './middleware/auth.js';
import { projectRoutes } from './routes/projects.js';
import type { AppEnv } from './types.js';

// Who may change a project and invite into it. Runs against DATABASE_URL with rows of its own, which go again at the end.
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/projects', projectRoutes);
const run = crypto.randomUUID();
const userIds: string[] = [];
type Person = { id: string; headers: Record<string, string> };
let owner: Person, management: Person, artist: Person;
let projectId: string;

const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
const user = async (name: string, blockedAt?: Date): Promise<Person> => {
  const [u] = await db.insert(users).values({ email: `test-${run}-${crypto.randomUUID()}@example.com`, name, blockedAt }).returning();
  userIds.push(u.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  return { id: u.id, headers: { authorization: `Bearer ${token}` } };
};
const invite = (p: Person, email: string) => call(`/projects/${projectId}/members`, { method: 'POST', body: { email, roles: ['artist'] }, headers: p.headers });

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [owner, management, artist] = await Promise.all([user('Robin'), user('Sam'), user('Lea')]);
  const [project] = await db.insert(projects).values({ name: 'Fernlicht', createdById: owner.id }).returning();
  projectId = project.id;
  await db.insert(projectMembers).values([
    { projectId, userId: owner.id, role: 'owner', canUpload: true, canComment: true, canApprove: true },
    { projectId, userId: management.id, role: 'management', canUpload: false, canComment: true, canApprove: true },
    { projectId, userId: artist.id, role: 'artist', canUpload: false, canComment: true, canApprove: true },
  ]);
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(like(users.email, `%${run}%`));
  await db.$client.end();
});

test('only the owner changes, archives and restores the project', async () => {
  const patch = (p: Person) => call(`/projects/${projectId}`, { method: 'PATCH', body: { name: 'Fernlicht II' }, headers: p.headers });
  expect((await patch(artist)).status).toBe(403);
  expect((await patch(management)).status).toBe(403);
  expect((await patch(owner)).status).toBe(200);
  expect((await call(`/projects/${projectId}`, { method: 'DELETE', headers: artist.headers })).status).toBe(403);
  expect((await call(`/projects/${projectId}/restore`, { method: 'POST', headers: artist.headers })).status).toBe(403);
  expect((await call(`/projects/${projectId}`, { headers: artist.headers })).status).toBe(200);
});

test('owner and management invite, an artist does not, a blocked account stays out', async () => {
  expect((await invite(artist, `invitee-${run}-a@example.com`)).status).toBe(403);
  const created = await invite(management, `invitee-${run}-b@example.com`);
  expect(created.status).toBe(201);
  const [account] = await db.select({ id: users.id, storageLimit: users.storageLimit }).from(users).where(eq(users.email, `invitee-${run}-b@example.com`));
  expect(account).toBeDefined();
  expect((await invite(owner, `invitee-${run}-b@example.com`)).status).toBe(409);

  const blocked = await user('Blocked', new Date());
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, blocked.id));
  expect((await invite(owner, row.email)).status).toBe(403);
  const [membership] = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, blocked.id)));
  expect(membership).toBeUndefined();
});

test('invitations are rate limited per inviter, 20 an hour', async () => {
  // Management sent one invitation above
  const statuses: number[] = [];
  for (let i = 0; i < 20; i++) statuses.push((await invite(management, `invitee-${run}-${i}@example.com`)).status);
  expect(statuses).toEqual([...Array(19).fill(201), 429]);
});

test('changing a member answers 404 for an unknown member and 403 for yourself', async () => {
  const patch = (memberId: string) => call(`/projects/${projectId}/members/${memberId}`, { method: 'PATCH', body: { roles: ['label'] }, headers: owner.headers });
  expect((await patch(crypto.randomUUID())).status).toBe(404);
  const [own] = await db.select({ id: projectMembers.id }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, owner.id)));
  expect((await patch(own.id)).status).toBe(403);
  const [member] = await db.select({ id: projectMembers.id }).from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, artist.id)));
  expect((await patch(member.id)).status).toBe(200);
  expect((await call(`/projects/${projectId}/members/${member.id}`, { method: 'PATCH', body: { roles: ['label'] }, headers: artist.headers })).status).toBe(403);
});
