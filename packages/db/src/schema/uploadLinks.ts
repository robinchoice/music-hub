import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { projects } from './projects.js';

// A link through which people without an account add stems to the project.
// Their files count towards the storage of whoever created the link.
export const uploadLinks = pgTable('upload_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
