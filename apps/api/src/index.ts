import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
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
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { AppEnv } from './types.js';

const db = createDb(process.env.DATABASE_URL!);

// Auto-migrate on startup in production
if (process.env.NODE_ENV === 'production') {
  console.log('[Boot] Running migrations...');
  try {
    // Resolve relative to the working directory (which is /app in Docker)
    const path = await import('path');
    const folder = path.resolve(process.cwd(), 'packages/db/src/migrations');
    console.log(`[Boot] Migrations folder: ${folder}`);
    await migrate(db, { migrationsFolder: folder });
    console.log('[Boot] Migrations applied.');
  } catch (err) {
    console.error('[Boot] Migration failed:', err);
  }
}

const app = new Hono<AppEnv>()
  .use('*', logger())
  .use(
    '*',
    cors({
      origin: process.env.APP_URL || 'http://localhost:5173',
      credentials: true,
    }),
  )
  .use('*', async (c, next) => {
    c.set('db', db);
    await next();
  })
  .onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ error: err.message }, 500);
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
  .route('/onboarding', onboardingRoutes);

const port = parseInt(process.env.PORT || '3000');
console.log(`Music Hub API running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
