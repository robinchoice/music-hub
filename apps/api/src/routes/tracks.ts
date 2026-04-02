import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc } from 'drizzle-orm';
import { createTrackSchema, updateTrackSchema } from '@music-hub/shared';
import { tracks, projectMembers } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const trackRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Get all tracks for a project
  .get('/project/:projectId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);

    if (!membership) return c.json({ error: 'Not found' }, 404);

    const projectTracks = await db
      .select()
      .from(tracks)
      .where(eq(tracks.projectId, projectId))
      .orderBy(asc(tracks.sortOrder), asc(tracks.createdAt));

    return c.json({ tracks: projectTracks });
  })

  .post('/:projectId', zValidator('json', createTrackSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');
    const input = c.req.valid('json');

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);

    if (!membership || !membership.canUpload) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [track] = await db
      .insert(tracks)
      .values({ ...input, projectId, createdById: userId })
      .returning();

    return c.json({ track }, 201);
  })

  .patch('/:id', zValidator('json', updateTrackSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('id');
    const input = c.req.valid('json');

    const [track] = await db
      .select()
      .from(tracks)
      .where(eq(tracks.id, trackId))
      .limit(1);

    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);

    if (!membership || !membership.canUpload) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [updated] = await db
      .update(tracks)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tracks.id, trackId))
      .returning();

    return c.json({ track: updated });
  })

  .delete('/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('id');

    const [track] = await db
      .select()
      .from(tracks)
      .where(eq(tracks.id, trackId))
      .limit(1);

    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, track.projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.role, 'owner'),
        ),
      )
      .limit(1);

    if (!membership) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await db.delete(tracks).where(eq(tracks.id, trackId));
    return c.json({ message: 'Track deleted' });
  });
