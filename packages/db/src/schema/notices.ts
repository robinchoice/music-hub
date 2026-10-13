import { pgTable, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { projects } from './projects.js';
import { versions } from './tracks.js';

// New versions not yet announced. The worker sends them once an uploader has paused for a while,
// so a batch from the sync app becomes one push and one mail instead of one per file.
export const versionNotices = pgTable(
  'version_notices',
  {
    versionId: uuid('version_id')
      .primaryKey()
      .references(() => versions.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    actorId: uuid('actor_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index().on(table.projectId, table.actorId)],
);
