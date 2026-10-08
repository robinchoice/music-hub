import { captureException } from './monitoring';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createDb, migrateDb } from '@music-hub/db';
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
import { deviceRoutes } from './routes/device.js';
import { overviewRoutes } from './routes/overview.js';
import { trashRoutes } from './routes/trash.js';
import { adminRoutes } from './routes/admin.js';
import { purgeTrash } from './lib/trash.js';
import { listenForEvents } from './services/sse.js';
import { allowBrowserAccess } from './storage/s3.js';
import type { AppEnv } from './types.js';

const db = createDb(process.env.DATABASE_URL!);

// Auto-migrate on startup. A failed migration aborts the boot.
await migrateDb(process.env.DATABASE_URL!);
console.log('[Boot] Migrations up to date.');

// Delivers the events of all instances and the worker to this instance's SSE clients
await listenForEvents(db);

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
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/auth', authRoutes)
  .route('/auth/device', deviceRoutes)
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
  .route('/sse', sseRoutes)
  .route('/overview', overviewRoutes)
  .route('/trash', trashRoutes)
  .route('/admin', adminRoutes);

// Deletes for good what left the trash long enough ago: a minute after boot, then every six hours.
// Each API instance runs it; a second run finds nothing left to delete.
{
  const purge = () =>
    purgeTrash(db).catch((err) => {
      console.error('[Trash] Purge failed:', err);
      captureException(err);
    });
  setTimeout(purge, 60_000);
  setInterval(purge, 6 * 60 * 60_000);
}

const port = parseInt(process.env.PORT || '3000');
console.log(`Music Hub API running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
