import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc } from 'drizzle-orm';
import { requestStemUploadUrlSchema, createStemSchema } from '@music-hub/shared';
import { tracks, stems, projectMembers } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createUploadUrl, getObjectBuffer, deleteObject } from '../storage/s3.js';
import { zipSync } from 'fflate';
import type { AppEnv } from '../types.js';

export const stemRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // List stems for a track
  .get('/track/:trackId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('trackId');

    const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Not found' }, 404);

    const trackStems = await db
      .select()
      .from(stems)
      .where(eq(stems.trackId, trackId))
      .orderBy(asc(stems.sortOrder), asc(stems.createdAt));

    return c.json({ stems: trackStems });
  })

  // Request presigned upload URL
  .post('/track/:trackId/upload-url', zValidator('json', requestStemUploadUrlSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('trackId');
    const { fileName, mimeType, fileSize } = c.req.valid('json');

    const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership || !membership.canUpload) return c.json({ error: 'Forbidden' }, 403);

    const stemId = crypto.randomUUID();
    const fileKey = `projects/${track.projectId}/tracks/${trackId}/stems/${stemId}/${fileName}`;
    const uploadUrl = await createUploadUrl(fileKey, mimeType, fileSize);

    return c.json({ uploadUrl, fileKey, stemId });
  })

  // Register stem after upload
  .post('/track/:trackId', zValidator('json', createStemSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('trackId');
    const input = c.req.valid('json');

    const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership || !membership.canUpload) return c.json({ error: 'Forbidden' }, 403);

    const [stem] = await db
      .insert(stems)
      .values({
        trackId,
        name: input.name,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        fileKey: input.fileKey,
        createdById: userId,
      })
      .returning();

    return c.json({ stem }, 201);
  })

  // Delete stem
  .delete('/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const stemId = c.req.param('id');

    const [stem] = await db.select().from(stems).where(eq(stems.id, stemId)).limit(1);
    if (!stem) return c.json({ error: 'Not found' }, 404);

    const [track] = await db.select().from(tracks).where(eq(tracks.id, stem.trackId)).limit(1);
    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)))
      .limit(1);

    if (!membership || (membership.role !== 'owner' && stem.createdById !== userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await deleteObject(stem.fileKey);
    await db.delete(stems).where(eq(stems.id, stemId));
    return c.json({ message: 'Stem deleted' });
  })

  // Download all stems as ZIP
  .get('/track/:trackId/download-zip', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('trackId');

    const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Forbidden' }, 403);

    const trackStems = await db
      .select()
      .from(stems)
      .where(eq(stems.trackId, trackId))
      .orderBy(asc(stems.sortOrder), asc(stems.createdAt));

    if (trackStems.length === 0) return c.json({ error: 'No stems found' }, 404);

    // Download all files and build ZIP
    const files: Record<string, Uint8Array> = {};
    await Promise.all(
      trackStems.map(async (stem) => {
        const buf = await getObjectBuffer(stem.fileKey);
        files[stem.originalFileName] = buf;
      }),
    );

    const zipped = zipSync(files);
    const zipName = `${track.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-stems.zip`;

    return new Response(zipped, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
        'Content-Length': String(zipped.length),
      },
    });
  });
