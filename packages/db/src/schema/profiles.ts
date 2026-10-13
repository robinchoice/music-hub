import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, primaryKey, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { tracks } from './tracks.js';
import { projects } from './projects.js';

// A public page under /@handle with the open tracks someone worked on. Nobody has one until
// they create it; `visible` takes it offline again without losing what they wrote.
export const profiles = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  handle: varchar('handle', { length: 30 }).notNull().unique(),
  visible: boolean('visible').default(true).notNull(),
  bio: varchar('bio', { length: 200 }),
  links: jsonb('links').$type<string[]>().default([]).notNull(),
  // Who may send a contact request: 'everyone' with an account, 'open' = people with an open track of their own, 'nobody'
  requestsFrom: varchar('requests_from', { length: 10 }).default('open').notNull(),
  showStats: boolean('show_stats').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// One star per account and open track
export const stars = pgTable(
  'stars',
  {
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.trackId] }), index('stars_track_id_idx').on(table.trackId)],
);

// A single message to someone with a public profile. There is no chat: accepting it puts both
// into a project, where the conversation goes on in comments. Declining is silent.
export const contactRequests = pgTable(
  'contact_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fromUserId: uuid('from_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    toUserId: uuid('to_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    // The open track it is about, if any
    trackId: uuid('track_id').references(() => tracks.id, { onDelete: 'set null' }),
    message: text('message').notNull(),
    // 'pending', 'accepted' or 'declined'
    status: varchar('status', { length: 10 }).default('pending').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    answeredAt: timestamp('answered_at'),
    reportedAt: timestamp('reported_at'),
  },
  (table) => [index('contact_requests_to_user_id_idx').on(table.toUserId)],
);

// Someone who may not send this user requests any more
export const userBlocks = pgTable(
  'user_blocks',
  {
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    blockedUserId: uuid('blocked_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.blockedUserId] })],
);
