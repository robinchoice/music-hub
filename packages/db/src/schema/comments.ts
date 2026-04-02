import { pgTable, uuid, text, real, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { versions } from './tracks.js';

export const comments = pgTable('comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  versionId: uuid('version_id')
    .references(() => versions.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),
  body: text('body').notNull(),
  timestampSeconds: real('timestamp_seconds'),
  parentId: uuid('parent_id'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
