import { pgTable, uuid, varchar, timestamp, unique } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// Tasks on the "Für dich" page that a user marked as done. The key names what the task is about
// (e.g. "listen:<versionId>"), so new activity produces a new key and the task shows up again.
export const taskDismissals = pgTable(
  'task_dismissals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    taskKey: varchar('task_key', { length: 200 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.userId, table.taskKey)],
);
