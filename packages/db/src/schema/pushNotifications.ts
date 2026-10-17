import { pgTable, bigserial, uuid, text, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { projects } from './projects.js';
import { tracks } from './tracks.js';
import { contactRequests } from './profiles.js';

export const pushNotifications = pgTable('push_notifications', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id').references(() => tracks.id, { onDelete: 'cascade' }),
  requestId: uuid('request_id').references(() => contactRequests.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  url: text('url').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('push_notifications_user_cursor_idx').on(t.userId, t.id),
  index('push_notifications_created_at_idx').on(t.createdAt),
  check('push_notifications_scope', sql`(${t.projectId} is not null) <> (${t.requestId} is not null)`),
]);
