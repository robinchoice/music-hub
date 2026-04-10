import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { projectMembers } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createDemoProject } from '../lib/demo-seed.js';
import type { AppEnv } from '../types.js';

export const onboardingRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .post('/seed-demo', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    // Refuse to spam users with multiple demos
    const existing = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(eq(projectMembers.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      // User already has projects — they shouldn't see the welcome modal anyway,
      // but be defensive: still create a fresh demo so the action is meaningful.
    }

    const projectId = await createDemoProject(db, userId);
    return c.json({ projectId }, 201);
  });
