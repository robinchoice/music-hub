import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, taskDismissals, users } from '@music-hub/db';
import { resetTestAccount } from './lib/test-account.js';
import { TEST_ACCOUNT_EMAIL } from './lib/users.js';

// Runs against DATABASE_URL and resets its test account; the other rows are its own and go again at the end
const db = createDb(process.env.DATABASE_URL!);
let otherId: string;

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [{ id: otherId }] = await db
    .insert(users)
    .values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Other' })
    .returning({ id: users.id });
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.createdById, otherId));
  await db.delete(users).where(eq(users.id, otherId));
  await db.$client.end();
});

test('reset leaves the test account as if it just signed up', async () => {
  await resetTestAccount(db);
  const [tester] = await db.select().from(users).where(eq(users.email, TEST_ACCOUNT_EMAIL));

  const [own] = await db.insert(projects).values({ name: 'Own', createdById: tester.id }).returning();
  const [foreign] = await db.insert(projects).values({ name: 'Foreign', createdById: otherId }).returning();
  await db.insert(projectMembers).values([
    { projectId: own.id, userId: tester.id, role: 'owner' },
    { projectId: foreign.id, userId: otherId, role: 'owner' },
    { projectId: foreign.id, userId: tester.id, role: 'viewer' },
  ]);
  await db.insert(taskDismissals).values({ userId: tester.id, taskKey: 'listen:x' });
  await db.update(users).set({ tracksSeenAt: new Date(), createdAt: new Date(0) }).where(eq(users.id, tester.id));

  expect(await resetTestAccount(db)).toBeString();

  const [after] = await db.select().from(users).where(eq(users.email, TEST_ACCOUNT_EMAIL));
  expect(after.id).toBe(tester.id);
  expect(after.tracksSeenAt).toBeNull();
  expect(after.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  expect(await db.select().from(projects).where(eq(projects.id, own.id))).toHaveLength(0);
  expect(await db.select().from(projectMembers).where(eq(projectMembers.userId, tester.id))).toHaveLength(0);
  expect(await db.select().from(taskDismissals).where(eq(taskDismissals.userId, tester.id))).toHaveLength(0);
  expect(await db.select().from(projectMembers).where(eq(projectMembers.projectId, foreign.id))).toHaveLength(1);
});
