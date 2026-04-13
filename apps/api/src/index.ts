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
import type { AppEnv } from './types.js';

const db = createDb(process.env.DATABASE_URL!);

// Auto-migrate on startup — execute raw SQL from migration files
{
  const fs = await import('fs');
  const pathMod = await import('path');
  const { sql: dsql } = await import('drizzle-orm');
  const folder = pathMod.resolve(process.cwd(), 'packages/db/src/migrations');
  try {
    const journalPath = pathMod.join(folder, 'meta', '_journal.json');
    if (fs.existsSync(journalPath)) {
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      for (const entry of journal.entries) {
        const sqlFile = pathMod.join(folder, `${entry.tag}.sql`);
        if (!fs.existsSync(sqlFile)) continue;
        const rawSql = fs.readFileSync(sqlFile, 'utf8');
        const stmts = rawSql.split('--> statement-breakpoint').map((s: string) => s.trim()).filter(Boolean);
        for (const stmt of stmts) {
          try {
            await db.execute(dsql.raw(stmt));
          } catch (e: any) {
            if (!e.message?.includes('already exists') && !e.message?.includes('duplicate')) {
              console.error(`[Migrate] ${entry.tag}:`, e.message?.slice(0, 200));
            }
          }
        }
      }
      console.log(`[Boot] Migrations applied (${journal.entries.length} files).`);
    } else {
      console.log('[Boot] No migration journal found at', journalPath);
    }
  } catch (err: any) {
    console.error('[Boot] Migration error:', err.message);
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
  .get('/migrate', async (c) => {
    try {
      const fs = await import('fs');
      const pathMod = await import('path');
      const { sql: dsql } = await import('drizzle-orm');
      const folder = pathMod.resolve(process.cwd(), 'packages/db/src/migrations');
      const journal = JSON.parse(fs.readFileSync(pathMod.join(folder, 'meta', '_journal.json'), 'utf8'));
      const results: string[] = [];
      for (const entry of journal.entries) {
        const sqlFile = pathMod.join(folder, `${entry.tag}.sql`);
        if (!fs.existsSync(sqlFile)) { results.push(`skip: ${entry.tag} (not found)`); continue; }
        const rawSql = fs.readFileSync(sqlFile, 'utf8');
        const statements = rawSql.split('--> statement-breakpoint').map((s: string) => s.trim()).filter(Boolean);
        for (const stmt of statements) {
          try {
            await db.execute(dsql.raw(stmt));
          } catch (err: any) {
            if (err.message?.includes('already exists') || err.message?.includes('duplicate')) continue;
            results.push(`error in ${entry.tag}: ${err.message?.slice(0, 150)}`);
          }
        }
        results.push(`ok: ${entry.tag}`);
      }
      return c.json({ status: 'ok', results });
    } catch (err: any) {
      return c.json({ status: 'error', message: err.message }, 500);
    }
  })
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
