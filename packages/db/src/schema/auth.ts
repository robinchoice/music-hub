import { pgTable, uuid, varchar, text, timestamp, boolean, integer, bigint, jsonb, customType, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const magicLinks = pgTable('magic_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  codeHash: varchar('code_hash', { length: 64 }),
  codeAttempts: integer('code_attempts').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  name: varchar('name', { length: 255 }),
  passwordHash: text('password_hash'),
  // Ticked "send me updates", applied when the link is opened (double opt-in)
  updatesOptIn: boolean('updates_opt_in').default(false).notNull(),
});

export const sessions = pgTable('sessions', {
  client: varchar('client', { length: 10 }),
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index().on(t.userId)]);

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const passkeys = pgTable('passkeys', {
  id: varchar('id', { length: 1400 }).primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  publicKey: bytea('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull(),
  transports: jsonb('transports').$type<string[]>(),
  backedUp: boolean('backed_up').notNull(),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const passkeyChallenges = pgTable('passkey_challenges', {
  challenge: varchar('challenge', { length: 100 }).primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
});
