import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  real,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { projects } from './projects.js';

export const versionStatusEnum = pgEnum('version_status', [
  'uploaded',
  'processing',
  'ready',
  'approved',
  'rejected',
]);

// sketch is shown as Demo; in_progress stays for tracks that had it before the production stages
export const trackStatusEnum = pgEnum('track_status', [
  'sketch',
  'in_progress',
  'recording',
  'mixing',
  'mastering',
  'final',
  'released',
]);

export const tracks = pgTable('tracks', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  coverImageUrl: text('cover_image_url'),
  status: trackStatusEnum('status').default('sketch').notNull(),
  section: varchar('section', { length: 100 }),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // A remix: the CC license it took over from its original
  license: varchar('license', { length: 20 }),
  // The open track it was forked from, and the credit line it has to carry
  forkedFromId: uuid('forked_from_id').references((): AnyPgColumn => tracks.id, { onDelete: 'set null' }),
  credit: text('credit'),
  // Moved to the project's trash; discardedAt is set when it is deleted for good before its time runs out
  deletedAt: timestamp('deleted_at'),
  deletedById: uuid('deleted_by_id').references(() => users.id),
  discardedAt: timestamp('discarded_at'),
});

export const versions = pgTable('versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  trackId: uuid('track_id')
    .references(() => tracks.id, { onDelete: 'cascade' })
    .notNull(),
  versionNumber: integer('version_number').notNull(),
  label: varchar('label', { length: 100 }),
  notes: text('notes'),
  status: versionStatusEnum('status').default('uploaded').notNull(),
  // Who approved or rejected the version and when; null for decisions made before this was stored
  decidedById: uuid('decided_by_id').references(() => users.id),
  decidedAt: timestamp('decided_at'),

  parentVersionId: uuid('parent_version_id').references((): AnyPgColumn => versions.id, {
    onDelete: 'set null',
  }),
  branchLabel: varchar('branch_label', { length: 100 }),

  originalFileName: varchar('original_file_name', { length: 500 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  duration: real('duration'),
  sampleRate: integer('sample_rate'),
  bitDepth: integer('bit_depth'),
  // ffprobe sample_fmt, e.g. "s24", "flt"; null for versions measured before it was stored
  sampleFormat: varchar('sample_format', { length: 16 }),
  integratedLufs: real('integrated_lufs'),
  // EBU R128 loudness range in LU and true peak in dBTP; null for versions measured before they were stored
  loudnessRange: real('loudness_range'),
  truePeak: real('true_peak'),
  // Tempo and key detected by the worker with Essentia; null where it found none or hasn't got to it yet.
  // keyRoot as Essentia spells it (C, C#, D, Eb, E, F, F#, G, Ab, A, Bb, B), keyScale major or minor.
  bpm: real('bpm'),
  keyRoot: varchar('key_root', { length: 2 }),
  keyScale: varchar('key_scale', { length: 5 }),
  // When the worker took the version for that analysis
  analyzedAt: timestamp('analyzed_at'),

  originalFileKey: text('original_file_key').notNull(),
  streamFileKey: text('stream_file_key'),
  waveformDataKey: text('waveform_data_key'),
  // SHA-256 of the original file as hex, sent by the sync app to recognise files it already has
  sha256: varchar('sha256', { length: 64 }),

  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
  deletedById: uuid('deleted_by_id').references(() => users.id),
  discardedAt: timestamp('discarded_at'),
});

export const stems = pgTable('stems', {
  id: uuid('id').defaultRandom().primaryKey(),
  trackId: uuid('track_id')
    .references(() => tracks.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  originalFileName: varchar('original_file_name', { length: 500 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  fileKey: text('file_key').notNull(),
  sha256: varchar('sha256', { length: 64 }),
  // Taken over from an open track: the file belongs to the original and doesn't count towards storage
  forked: boolean('forked').default(false).notNull(),
  // Sent through the project's upload link by someone without an account; createdById is the link's creator
  guestName: varchar('guest_name', { length: 100 }),
  sortOrder: integer('sort_order').default(0).notNull(),
  // Who uploaded the current file
  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // When the current file replaced an earlier one; null while it is the first
  revisedAt: timestamp('revised_at'),
  deletedAt: timestamp('deleted_at'),
  deletedById: uuid('deleted_by_id').references(() => users.id),
  discardedAt: timestamp('discarded_at'),
});

// Earlier files of a stem. The stem row always holds the current one.
export const stemRevisions = pgTable('stem_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  stemId: uuid('stem_id')
    .references(() => stems.id, { onDelete: 'cascade' })
    .notNull(),
  originalFileName: varchar('original_file_name', { length: 500 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  fileKey: text('file_key').notNull(),
  sha256: varchar('sha256', { length: 64 }),
  forked: boolean('forked').default(false).notNull(),
  guestName: varchar('guest_name', { length: 100 }),
  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  // When this file was uploaded and when a newer one replaced it
  createdAt: timestamp('created_at').notNull(),
  replacedAt: timestamp('replaced_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
  deletedById: uuid('deleted_by_id').references(() => users.id),
  discardedAt: timestamp('discarded_at'),
});
