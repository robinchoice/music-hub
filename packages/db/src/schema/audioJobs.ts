import { pgTable, uuid, integer, timestamp, check, text, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { tracks, versions } from './tracks.js';

// Versions waiting for the audio worker. A worker holds a job until lockedUntil
// and keeps extending it while it runs; a job whose worker died is picked up
// again once that time has passed.
export const audioJobs = pgTable('audio_jobs', {
  versionId: uuid('version_id')
    .primaryKey()
    .references(() => versions.id, { onDelete: 'cascade' }),
  attempts: integer('attempts').default(0).notNull(),
  lockedUntil: timestamp('locked_until'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// A pause between stem changes becomes one mix. An edit during rendering changes revision
// without releasing the worker's lease, so the obsolete render cannot become a version.
export const stemMixJobs = pgTable('stem_mix_jobs', {
  trackId: uuid('track_id').primaryKey().references(() => tracks.id, { onDelete: 'cascade' }),
  revision: uuid('revision').defaultRandom().notNull(),
  createdById: uuid('created_by_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  lockedUntil: timestamp('locked_until'),
  attempts: integer('attempts').default(0).notNull(),
}, (t) => [check('stem_mix_attempts_nonnegative', sql`${t.attempts} >= 0`)]);

// Outstanding presigned uploads hold a batch open, including parallel transfers. Abandoned URLs expire.
export const stemMixUploads = pgTable('stem_mix_uploads', {
  fileKey: text('file_key').primaryKey(),
  trackId: uuid('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
}, (t) => [index().on(t.expiresAt)]);
