import { pgTable, uuid, varchar, boolean, timestamp, integer, unique } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { projects } from './projects.js';
import { tracks, versions } from './tracks.js';

// One link for a whole project. Each of its tracks plays through a share link of its own
// (share_links.project_link_id), made when a guest first opens the project link.
export const projectShareLinks = pgTable('project_share_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  expiresAt: timestamp('expires_at'),
  allowComments: boolean('allow_comments').default(true).notNull(),
  allowDownload: boolean('allow_download').default(false).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }),
  // 'latest' or 'approved', like share_links.follows
  follows: varchar('follows', { length: 16 }).default('latest').notNull(),
  // The tracks the link shows; null shows all of them, later ones included
  trackIds: uuid('track_ids').array(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const shareLinks = pgTable('share_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  versionId: uuid('version_id')
    .references(() => versions.id, { onDelete: 'cascade' })
    .notNull(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  expiresAt: timestamp('expires_at'),
  allowComments: boolean('allow_comments').default(true).notNull(),
  allowDownload: boolean('allow_download').default(false).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }),
  // 'version' shows versionId, 'latest' and 'approved' the newest (approved) version of its track
  follows: varchar('follows', { length: 16 }).default('version').notNull(),
  // Set when the link plays one track of a project link
  projectLinkId: uuid('project_link_id').references(() => projectShareLinks.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id').references(() => tracks.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique('share_links_project_link_track').on(t.projectLinkId, t.trackId)]);

export const listenEvents = pgTable('listen_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  shareLinkId: uuid('share_link_id')
    .references(() => shareLinks.id, { onDelete: 'cascade' })
    .notNull(),
  listenerName: varchar('listener_name', { length: 255 }),
  ipHash: varchar('ip_hash', { length: 64 }),
  userAgent: varchar('user_agent', { length: 500 }),
  openedAt: timestamp('opened_at').defaultNow().notNull(),
  firstPlayAt: timestamp('first_play_at'),
  listenSeconds: integer('listen_seconds').default(0).notNull(),
  completed: boolean('completed').default(false).notNull(),
});
