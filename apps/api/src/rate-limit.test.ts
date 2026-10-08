import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createDb, migrateDb } from '@music-hub/db';
import { rateLimit } from './lib/rate-limit.js';

// Runs against DATABASE_URL with fresh keys, so the local dev database is safe to use.
// Two clients stand for two API instances.
const a = createDb(process.env.DATABASE_URL!);
const b = createDb(process.env.DATABASE_URL!);

beforeAll(() => migrateDb(process.env.DATABASE_URL!));
afterAll(() => Promise.all([a.$client.end(), b.$client.end()]));

test('instances share one counter', async () => {
  const limit = rateLimit('test', 3, 60_000);
  const key = crypto.randomUUID();
  expect(await limit.hit(a, key)).toBe(true);
  expect(await limit.hit(b, key)).toBe(true);
  expect(await limit.hit(a, key)).toBe(true);
  expect(await limit.hit(b, key)).toBe(false);
});

test('parallel hits never overshoot', async () => {
  const limit = rateLimit('test', 5, 60_000);
  const key = crypto.randomUUID();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => limit.hit(i % 2 ? a : b, key)));
  expect(results.filter(Boolean).length).toBe(5);
});

test('amount and undo, as for the upload volume', async () => {
  const limit = rateLimit('test', 20e9, 60_000);
  const key = crypto.randomUUID();
  expect(await limit.hit(a, key, 15e9)).toBe(true);
  expect(await limit.hit(b, key, 6e9)).toBe(false);
  await limit.undo(b, key, 6e9);
  expect(await limit.hit(a, key, 5e9)).toBe(true);
  expect(await limit.hit(b, key, 1)).toBe(false);
});

test('a new window starts over', async () => {
  const limit = rateLimit('test', 1, 300);
  const key = crypto.randomUUID();
  expect(await limit.hit(a, key)).toBe(true);
  expect(await limit.hit(b, key)).toBe(false);
  await Bun.sleep(400);
  expect(await limit.hit(b, key)).toBe(true);
});
