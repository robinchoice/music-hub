import { pgTable, uuid, varchar, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { tracks, versions } from './tracks.js';

// A track whose approved version and stems anyone may download and remix. It opens once everyone
// who uploaded to it agreed; until then openedAt is null. Closing it deletes the row.
export const openTracks = pgTable('open_tracks', {
  trackId: uuid('track_id')
    .primaryKey()
    .references(() => tracks.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id')
    .references(() => versions.id, { onDelete: 'cascade' })
    .notNull(),
  license: varchar('license', { length: 20 }).notNull(),
  requestedById: uuid('requested_by_id')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  openedAt: timestamp('opened_at'),
});

export const openConsents = pgTable(
  'open_consents',
  {
    trackId: uuid('track_id')
      .references(() => openTracks.trackId, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.trackId, table.userId] })],
);

// Reports from the public page, e.g. about someone else's samples; admins look at them
export const openReports = pgTable('open_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  trackId: uuid('track_id')
    .references(() => tracks.id, { onDelete: 'cascade' })
    .notNull(),
  reason: text('reason').notNull(),
  email: varchar('email', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});
