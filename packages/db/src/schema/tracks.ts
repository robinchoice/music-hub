import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  real,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { projects } from './projects.js';

export const versionStatusEnum = pgEnum('version_status', [
  'uploaded',
  'processing',
  'ready',
  'approved',
  'rejected',
]);

export const tracks = pgTable('tracks', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const versions = pgTable(
  'versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'cascade' })
      .notNull(),
    versionNumber: integer('version_number').notNull(),
    label: varchar('label', { length: 100 }),
    notes: text('notes'),
    status: versionStatusEnum('status').default('uploaded').notNull(),

    originalFileName: varchar('original_file_name', { length: 500 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    duration: real('duration'),
    sampleRate: integer('sample_rate'),
    bitDepth: integer('bit_depth'),

    originalFileKey: text('original_file_key').notNull(),
    streamFileKey: text('stream_file_key'),
    waveformDataKey: text('waveform_data_key'),

    createdById: uuid('created_by_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.trackId, table.versionNumber)],
);
