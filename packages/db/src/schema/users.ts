import { pgTable, uuid, varchar, text, timestamp, bigint } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  passwordHash: text('password_hash'),
  avatarUrl: text('avatar_url'),
  // Last visit of the "Tracks" page; marks newer activity as new on every device
  tracksSeenAt: timestamp('tracks_seen_at'),
  // Last authenticated request, written at most every few minutes; the admin pages show who is online
  lastSeenAt: timestamp('last_seen_at'),
  // Set by an admin; a blocked account can't log in and its share links stop working
  blockedAt: timestamp('blocked_at'),
  // Bytes this account may upload; null means MAX_STORAGE_PER_USER
  storageLimit: bigint('storage_limit', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
