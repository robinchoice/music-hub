import { sql } from 'drizzle-orm';
import { check, customType, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { AppFeedbackContext } from '@music-hub/shared';
import { users } from './users.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// Bug reports and ideas about the app itself from the bug button (README, „Feedback zur App“),
// also mailed and filed as GitHub issues. Not the feedback on tracks, that is `reviews`. The table
// is named like in robinchoice/starter, so the tools that read tester reports find it.
export const appFeedback = pgTable(
  'feedback',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: varchar('kind', { length: 10 }).notNull(),
    message: text('message').notNull(),
    screenshot: bytea('screenshot'),
    context: jsonb('context').$type<AppFeedbackContext & { api: string }>().notNull(),
    issueUrl: varchar('issue_url', { length: 300 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [check('feedback_kind', sql`${t.kind} in ('bug', 'idea')`)],
);
