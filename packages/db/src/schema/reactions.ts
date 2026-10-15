import { pgTable, uuid, varchar, timestamp, unique } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { comments } from './comments.js';

// One row per person and emoji on a comment; reacting again removes it
export const commentReactions = pgTable(
  'comment_reactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    commentId: uuid('comment_id')
      .references(() => comments.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    emoji: varchar('emoji', { length: 16 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [unique().on(t.commentId, t.userId, t.emoji)],
);
