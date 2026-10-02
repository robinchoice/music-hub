import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// Pending logins of native clients such as the DAW plugin: the client shows
// the user code, the user approves it in the browser, the client polls for
// its session.
export const deviceCodes = pgTable('device_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  deviceCodeHash: varchar('device_code_hash', { length: 128 }).notNull().unique(),
  userCode: varchar('user_code', { length: 16 }).notNull().unique(),
  client: varchar('client', { length: 100 }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  approvedAt: timestamp('approved_at'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
