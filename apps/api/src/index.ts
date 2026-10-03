import { captureException } from './monitoring';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import path from 'path';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '@music-hub/db';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { trackRoutes } from './routes/tracks.js';
import { versionRoutes } from './routes/versions.js';
import { commentRoutes } from './routes/comments.js';
import { shareRoutes } from './routes/share.js';
import { uploadRoutes } from './routes/uploads.js';
import { activityRoutes } from './routes/activity.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { stemRoutes } from './routes/stems.js';
import { pushRoutes } from './routes/push.js';
import { sseRoutes } from './routes/sse.js';
import { allowBrowserAccess } from './storage/s3.js';
import type { AppEnv } from './types.js';

const db = createDb(process.env.DATABASE_URL!);

// Auto-migrate on startup. A failed migration aborts the boot.
{
  const migrationsFolder = path.resolve(import.meta.dir, '../../../packages/db/src/migrations');

  // Databases set up by the former raw-SQL runner contain migrations 0000–0008
  // but no drizzle bookkeeping; record those as applied before migrating.
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  const [{ tracked, legacy }] = await db.execute<{ tracked: number; legacy: boolean }>(
    sql`SELECT (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS tracked, to_regclass('public.users') IS NOT NULL AS legacy`,
  );
  if (tracked === 0 && legacy) {
    for (const m of readMigrationFiles({ migrationsFolder }).slice(0, 9)) {
      await db.execute(
        sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${m.hash}, ${m.folderMillis})`,
      );
    }
    console.log('[Boot] Recorded legacy migrations 0000–0008 as applied.');
  }

  await migrate(db, { migrationsFolder });
  console.log('[Boot] Migrations up to date.');
}

const allowedOrigins = [
  process.env.APP_URL || 'http://localhost:5173',
  ...(process.env.ADDITIONAL_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
];

{
  allowBrowserAccess(allowedOrigins)
    .then(() => console.log(`[Boot] Bucket CORS allows ${allowedOrigins.join(', ')}.`))
    .catch((err) => console.error(`[Boot] Bucket CORS not updated: ${err.message}`));
}

const app = new Hono<AppEnv>()
  .use('*', logger())
  .use(
    '*',
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  )
  .use('*', async (c, next) => {
    c.set('db', db);
    await next();
  })
  .onError((err, c) => {
    console.error('Unhandled error:', err);
    captureException(err);
    return c.json({ error: 'Internal server error' }, 500);
  })
  .get('/health', (c) => c.json({ status: 'ok' }))
  .basePath('/api/v1')
  .route('/auth', authRoutes)
  .route('/projects', projectRoutes)
  .route('/tracks', trackRoutes)
  .route('/versions', versionRoutes)
  .route('/comments', commentRoutes)
  .route('/share', shareRoutes)
  .route('/uploads', uploadRoutes)
  .route('/activity', activityRoutes)
  .route('/onboarding', onboardingRoutes)
  .route('/stems', stemRoutes)
  .route('/push', pushRoutes)
  .route('/sse', sseRoutes);

const port = parseInt(process.env.PORT || '3000');
console.log(`Music Hub API running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
