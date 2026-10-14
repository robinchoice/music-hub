import { pgTable, pgEnum, uuid, varchar, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { versions } from './tracks.js';

export const reviewVerdictEnum = pgEnum('review_verdict', ['approve', 'fine', 'changes', 'notes']);

// A finished listening pass on a version: "Fertig mit V4" with a verdict, or, without one, the summary
// the API sends on its own once someone has stopped commenting. The pass covers the author's comments
// since their previous review; the uploader gets one push or mail for it.
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    versionId: uuid('version_id')
      .references(() => versions.id, { onDelete: 'cascade' })
      .notNull(),
    // A member, or a guest on a share link who is known only by name
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    guestName: varchar('guest_name', { length: 100 }),
    // Null for the automatic summary
    verdict: reviewVerdictEnum('verdict'),
    note: text('note'),
    commentCount: integer('comment_count').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index().on(table.versionId)],
);
