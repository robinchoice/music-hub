import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { projects } from './projects.js';
import { tracks } from './tracks.js';

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

// What a guest wrote to go with their files, shown with the song's stems
export const guestNotes = pgTable('guest_notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  trackId: uuid('track_id')
    .references(() => tracks.id, { onDelete: 'cascade' })
    .notNull(),
  guestName: varchar('guest_name', { length: 100 }).notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
