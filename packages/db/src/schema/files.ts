import { pgTable, uuid, varchar, text, bigint, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { projects } from './projects.js';
import { tracks } from './tracks.js';

// Any file in a project that is no version and no stem: a sound, a DAW session, MIDI, lyrics.
// trackId only files it next to a song; the file stays when the song goes.
export const projectFiles = pgTable('project_files', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  trackId: uuid('track_id').references(() => tracks.id, { onDelete: 'set null' }),
  originalFileName: varchar('original_file_name', { length: 500 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  fileKey: text('file_key').notNull().unique(),
  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
  deletedById: uuid('deleted_by_id').references(() => users.id),
  discardedAt: timestamp('discarded_at'),
}, (t) => [index().on(t.projectId), check('project_file_size_nonnegative', sql`${t.fileSize} >= 0`)]);
