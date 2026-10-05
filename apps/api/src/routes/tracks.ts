import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc, sql, isNull } from 'drizzle-orm';
import { createTrackSchema, updateTrackSchema } from '@music-hub/shared';
import { tracks, projectMembers } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createDownloadUrl } from '../storage/s3.js';
import { liveTrack } from '../lib/trash.js';
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
      .select({
        id: tracks.id,
        projectId: tracks.projectId,
        name: tracks.name,
        description: tracks.description,
        coverImageUrl: tracks.coverImageUrl,
        status: tracks.status,
        section: tracks.section,
        sortOrder: tracks.sortOrder,
        createdById: tracks.createdById,
        createdAt: tracks.createdAt,
        updatedAt: tracks.updatedAt,
        // Written out: drizzle leaves columns of a single-table select unqualified, which would bind to versions here
        versionCount: sql<number>`(select count(*)::int from versions v where v.track_id = tracks.id and v.deleted_at is null)`,
        branchCount: sql<number>`(select count(distinct v.branch_label)::int from versions v where v.track_id = tracks.id and v.branch_label is not null and v.deleted_at is null)`,
      })
      .from(tracks)
      .where(and(eq(tracks.projectId, projectId), isNull(tracks.deletedAt)))
      .orderBy(asc(tracks.sortOrder), asc(tracks.createdAt));

    const enriched = await Promise.all(
      projectTracks.map(async (t) => ({
        ...t,
        coverUrl: t.coverImageUrl ? await createDownloadUrl(t.coverImageUrl) : null,
      })),
    );
    return c.json({ tracks: enriched });
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

    const track = await liveTrack(db, trackId);
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

    const track = await liveTrack(db, trackId);
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

    // Into the project's trash, with everything below it
    await db.update(tracks).set({ deletedAt: new Date(), deletedById: userId }).where(eq(tracks.id, trackId));
    return c.json({ message: 'Track deleted' });
  });
