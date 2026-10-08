import { pgTable, uuid, integer, timestamp } from 'drizzle-orm/pg-core';
import { versions } from './tracks.js';

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
