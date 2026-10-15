import { pgTable, uuid, varchar, jsonb, integer, timestamp, unique, customType } from 'drizzle-orm/pg-core';
import type { UpdateContent } from '@music-hub/shared';
import { users } from './users.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// Update mails about new features, see README „Update-Mails“. Drafts from
// updates/<slug>.md carry the slug, sentAt marks the moment an admin sent it.
export const updates = pgTable('updates', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 200 }).unique(),
  content: jsonb('content').$type<UpdateContent>().notNull(),
  image: bytea('image'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// One row per recipient of a sent update, the API works through the pending ones
export const updateDeliveries = pgTable(
  'update_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    updateId: uuid('update_id')
      .references(() => updates.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    // pending, sent, failed, or skipped when the user unsubscribed in between
    status: varchar('status', { length: 10 }).default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    // Last try, the send time once sent. Paces all API instances together.
    attemptedAt: timestamp('attempted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.updateId, table.userId)],
);
