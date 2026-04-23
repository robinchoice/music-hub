import { pgTable, uuid, varchar, boolean, timestamp, integer } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { versions } from './tracks.js';

export const shareLinks = pgTable('share_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  versionId: uuid('version_id')
    .references(() => versions.id, { onDelete: 'cascade' })
    .notNull(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  expiresAt: timestamp('expires_at'),
  allowComments: boolean('allow_comments').default(true).notNull(),
  allowDownload: boolean('allow_download').default(false).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const listenEvents = pgTable('listen_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  shareLinkId: uuid('share_link_id')
    .references(() => shareLinks.id, { onDelete: 'cascade' })
    .notNull(),
  listenerName: varchar('listener_name', { length: 255 }),
  ipHash: varchar('ip_hash', { length: 64 }),
  userAgent: varchar('user_agent', { length: 500 }),
  openedAt: timestamp('opened_at').defaultNow().notNull(),
  firstPlayAt: timestamp('first_play_at'),
  listenSeconds: integer('listen_seconds').default(0).notNull(),
  completed: boolean('completed').default(false).notNull(),
});
