import { pgTable, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
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
