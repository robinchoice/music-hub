import { pgTable, uuid, varchar, text, integer, bigint, timestamp, jsonb, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { projects } from './projects.js';
import { tracks } from './tracks.js';

// A Dropbox account connected for reading. The refresh token is encrypted with DROPBOX_TOKEN_KEY
// and never leaves the API and the worker.
export const dropboxConnections = pgTable('dropbox_connections', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  accountId: varchar('account_id', { length: 100 }).notNull(),
  // Shown as "connected as …"
  displayName: varchar('display_name', { length: 255 }),
  // Team accounts keep shared folders in a namespace of their own; requests then start there
  rootNamespaceId: varchar('root_namespace_id', { length: 40 }),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// One look into a folder of someone's Dropbox and, once started, its import. entries holds what the
// scan found (path, size, date, file id, rev, content hash), so the import takes sizes from Dropbox
// and not from what the browser sends.
export const imports = pgTable('imports', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  source: varchar('source', { length: 20 }).notNull().default('dropbox'),
  rootPath: text('root_path').notNull(),
  entries: jsonb('entries').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('scanned'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
}, (t) => [
  index().on(t.userId),
  check('import_status', sql`${t.status} in ('scanned', 'running', 'done', 'cancelled')`),
  check('import_source', sql`${t.source} in ('dropbox')`),
]);

// A file on its way from Dropbox into a project. The worker takes them in order of position, so
// versions get their numbers in the order of the preview, and holds one until leasedUntil.
export const importItems = pgTable('import_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  importId: uuid('import_id').notNull().references(() => imports.id, { onDelete: 'cascade' }),
  entry: integer('entry').notNull(),
  position: integer('position').notNull(),
  kind: varchar('kind', { length: 10 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id').references(() => tracks.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  // The revision the scan saw: the import takes exactly that one, even if the file changes meanwhile
  rev: varchar('rev', { length: 64 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  // Dropbox's content hash: a second import of the same file finds it here
  contentHash: varchar('content_hash', { length: 64 }),
  status: varchar('status', { length: 10 }).notNull().default('pending'),
  attempts: integer('attempts').default(0).notNull(),
  leasedUntil: timestamp('leased_until'),
  error: text('error'),
  finishedAt: timestamp('finished_at'),
}, (t) => [
  index().on(t.importId, t.position),
  index().on(t.status),
  check('import_item_kind', sql`${t.kind} in ('version', 'stem', 'file')`),
  check('import_item_status', sql`${t.status} in ('pending', 'done', 'failed')`),
  check('import_item_attempts_nonnegative', sql`${t.attempts} >= 0`),
  check('import_item_size_nonnegative', sql`${t.fileSize} >= 0`),
]);
