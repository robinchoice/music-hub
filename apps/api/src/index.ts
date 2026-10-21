import './env';
import { drainBackground, runInBackground } from './lib/background.js';
import { captureException } from './monitoring';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createDb, migrateDb, passkeyChallenges } from '@music-hub/db';
import { lt } from 'drizzle-orm';
import { passkeyRoutes } from './routes/passkeys.js';
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
import { openRoutes } from './routes/open.js';
import { syncRoutes } from './routes/sync.js';
import { noticeRoutes } from './routes/notices.js';
import { uploadLinkRoutes } from './routes/upload-links.js';
import { pruneNotifications } from './lib/push-notifications.js';
import { sendDueNotices } from './lib/notices.js';
import { sendDueFeedback } from './lib/reviews.js';
import { profileRoutes } from './routes/profiles.js';
import { requestRoutes } from './routes/requests.js';
import { agentRoutes } from './routes/agents.js';
import { updateRoutes } from './routes/updates.js';
import { deliverUpdates, importDrafts } from './lib/updates.js';
import { closeEventStreams, listenForEvents } from './services/sse.js';
import { allowBrowserAccess } from './storage/s3.js';
import type { AppEnv } from './types.js';

const db = createDb(process.env.DATABASE_URL!);

const stop = new AbortController();

async function shutdown() {
  if (stop.signal.aborted) return;
  stop.abort();
  const { server, interval, updates } = await startup;
  clearInterval(interval);
  const drained = server.stop();
  closeEventStreams();
  await drained;
  await updates;
  await drainBackground();
  await db.$client.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const startup = (async () => {
  // Auto-migrate on startup. A failed migration aborts the boot.
  await migrateDb(process.env.DATABASE_URL!);
  console.log('[Boot] Migrations up to date.');
  await importDrafts(db);

  // Delivers the events of all instances and the worker to this instance's SSE clients
  await listenForEvents(db);

  const allowedOrigins = [
    process.env.APP_URL || 'http://localhost:5173',
    ...(process.env.ADDITIONAL_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ];

  {
    runInBackground(allowBrowserAccess(allowedOrigins)
      .then(() => console.log(`[Boot] Bucket CORS allows ${allowedOrigins.join(', ')}.`))
      .catch((err) => console.error(`[Boot] Bucket CORS not updated: ${err.message}`)));
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
    // The CI compares revision with the deployed commit
    .get('/health', (c) => c.json({ status: 'ok', revision: process.env.APP_VERSION || 'dev' }))
    // /llms.txt, /llms-full.txt and <page>.md, forwarded by the web server
    .route('/', agentRoutes)
    .basePath('/api/v1')
    .get('/health', (c) => c.json({ status: 'ok', revision: process.env.APP_VERSION || 'dev' }))
    .route('/auth', authRoutes)
    .route('/auth/passkeys', passkeyRoutes)
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
    .route('/admin', adminRoutes)
    .route('/open', openRoutes)
    .route('/sync', syncRoutes)
    .route('/notices', noticeRoutes)
    .route('/upload-links', uploadLinkRoutes)
    .route('/profiles', profileRoutes)
    .route('/requests', requestRoutes)
    .route('/updates', updateRoutes);

  // Announces new versions once their uploader pauses. Runs in the API because it holds SMTP and VAPID, the worker doesn't.
  // Each instance runs it; taking a batch deletes it first, so none goes out twice.
  // Feedback whose author forgot "Fertig" goes out the same way, under a lock.
  const interval = setInterval(() => {
    runInBackground(pruneNotifications(db).catch((err) => console.error('[Push] Cleanup failed:', err)));
    runInBackground(db.delete(passkeyChallenges).where(lt(passkeyChallenges.expiresAt, new Date()))
      .catch((err) => console.error('[Passkeys] Cleanup failed:', err)));
    runInBackground(sendDueNotices(db).catch((err) => {
      console.error('[Notices] Sending failed:', err);
      captureException(err);
    }));
    runInBackground(sendDueFeedback(db).catch((err) => {
      console.error('[Reviews] Sending failed:', err);
      captureException(err);
    }));
  }, 30_000);

  // Update mails go out one by one in the background, see lib/updates.ts
  const updates = deliverUpdates(db, captureException, stop.signal);

  const server = Bun.serve({ port: Number(process.env.PORT || 3000), fetch: app.fetch });
  console.log(`Music Hub API running on port ${server.port}`);
  return { server, interval, updates };
})();

await startup;
