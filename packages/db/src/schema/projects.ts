import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const projectRoleEnum = pgEnum('project_role', [
  'owner',
  'recording_engineer',
  'mixing_engineer',
  'mastering_engineer',
  'artist',
  'label',
  'management',
  'viewer',
]);

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  coverImageUrl: text('cover_image_url'),
  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  isArchived: boolean('is_archived').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: projectRoleEnum('role').notNull(),
    canUpload: boolean('can_upload').default(false).notNull(),
    canComment: boolean('can_comment').default(true).notNull(),
    canApprove: boolean('can_approve').default(false).notNull(),
    invitedAt: timestamp('invited_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.projectId, table.userId)],
);
