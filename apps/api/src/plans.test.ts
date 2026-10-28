import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb, migrateDb, users } from '@music-hub/db';
import { MAX_STORAGE_PER_USER, PLAN_STORAGE } from '@music-hub/shared';
import { storageLimitOf, storageOf } from './lib/storage.js';
import { MAX_USERS, registrationOpen, TEST_ACCOUNT_EMAIL } from './lib/users.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const userIds: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

const user = async (values: Partial<typeof users.$inferInsert> = {}) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Plan test', ...values }).returning();
  userIds.push(u.id);
  return u;
};

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('a running plan raises the storage limit, never lowers it, and an ended one gives the own limit back', async () => {
  const free = await user({ storageLimit: 5 });
  const pro = await user({ storageLimit: 5, plan: 'pro', planUntil: new Date(Date.now() + DAY) });
  const studio = await user({ plan: 'solo' });
  const ended = await user({ storageLimit: 5, plan: 'pro', planUntil: new Date(Date.now() - DAY) });
  const generous = await user({ storageLimit: PLAN_STORAGE.pro * 2, plan: 'pro' });

  for (const [u, limit] of [
    [free, 5],
    [pro, PLAN_STORAGE.pro],
    [studio, PLAN_STORAGE.solo],
    [ended, 5],
    [generous, PLAN_STORAGE.pro * 2],
  ] as const) {
    expect((await storageOf(db, u.id)).limit).toBe(limit);
    expect(storageLimitOf(u)).toBe(limit);
  }
  expect(storageLimitOf({ storageLimit: null, plan: null, planUntil: null })).toBe(MAX_STORAGE_PER_USER);
});

test("paying accounts don't count towards MAX_USERS", async () => {
  const counted = async () =>
    (
      await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM users
        WHERE email <> ${TEST_ACCOUNT_EMAIL} AND NOT (plan IS NOT NULL AND (plan_until IS NULL OR plan_until > now()))
      `)
    )[0].n;
  const missing = MAX_USERS - 1 - (await counted());
  if (missing < 0) throw new Error('The test database holds too many accounts for this test');
  for (let i = 0; i < missing; i++) await user();
  for (let i = 0; i < 3; i++) await user({ plan: 'pro', planUntil: new Date(Date.now() + DAY) });
  expect(await registrationOpen(db)).toBe(true);

  const lapsed = await user({ plan: 'pro', planUntil: new Date(Date.now() - DAY) });
  expect(await registrationOpen(db)).toBe(false);
  await db.update(users).set({ planUntil: null }).where(eq(users.id, lapsed.id));
  expect(await registrationOpen(db)).toBe(true);
});
