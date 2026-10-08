import { pgTable, varchar, bigint, timestamp } from 'drizzle-orm/pg-core';

// Counters of lib/rate-limit.ts in the API, shared by all API instances.
// bigint, because the daily upload volume counts bytes.
export const rateLimits = pgTable('rate_limits', {
  key: varchar('key', { length: 300 }).primaryKey(),
  count: bigint('count', { mode: 'number' }).notNull(),
  resetAt: timestamp('reset_at').notNull(),
});
