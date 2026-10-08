import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    connection: { timezone: 'UTC' },
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

// Several API instances and the worker may start at once. A session-level
// advisory lock on a single connection makes them migrate one after another.
export async function migrateDb(connectionString: string) {
  const migrationsFolder = path.join(import.meta.dir, 'migrations');
  const client = postgres(connectionString, { max: 1, connection: { timezone: 'UTC' }, onnotice: () => {} });
  try {
    await client`SELECT pg_advisory_lock(hashtext('migrations'))`;

    // Databases set up by the former raw-SQL runner contain migrations 0000–0008
    // but no drizzle bookkeeping; record those as applied before migrating.
    await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await client`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
    const [{ tracked, legacy }] = await client<{ tracked: number; legacy: boolean }[]>`
      SELECT (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS tracked,
             to_regclass('public.users') IS NOT NULL AS legacy`;
    if (tracked === 0 && legacy) {
      for (const m of readMigrationFiles({ migrationsFolder }).slice(0, 9)) {
        await client`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${m.hash}, ${m.folderMillis})`;
      }
      console.log('[Boot] Recorded legacy migrations 0000–0008 as applied.');
    }

    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

export * from './schema/index.js';
