import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc } from 'drizzle-orm';
import { requestStemUploadUrlSchema, createStemSchema } from '@music-hub/shared';
import { tracks, stems, projectMembers } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createUploadUrl, getObjectBuffer, deleteObject } from '../storage/s3.js';
import { zip } from 'fflate';
import type { AppEnv } from '../types.js';

export const stemRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

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

  .delete('/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const stemId = c.req.param('id');

    const [stem] = await db.select().from(stems).where(eq(stems.id, stemId)).limit(1);
    if (!stem) return c.json({ error: 'Not found' }, 404);

    const [track] = await db.select().from(tracks).where(eq(tracks.id, stem.trackId)).limit(1);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);

    if (!membership || (membership.role !== 'owner' && stem.createdById !== userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await deleteObject(stem.fileKey);
    await db.delete(stems).where(eq(stems.id, stemId));
    return c.json({ message: 'Stem deleted' });
  })

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

    const fileEntries = await Promise.all(
      trackStems.map(async (stem) => [stem.originalFileName, await getObjectBuffer(stem.fileKey)] as const),
    );
    const files = Object.fromEntries(fileEntries) as Record<string, Uint8Array>;

    const zipped = await new Promise<Uint8Array>((resolve, reject) => {
      zip(files, (err, data) => (err ? reject(err) : resolve(data)));
    });
    const zipName = `${track.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-stems.zip`;
    const body = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;

    return new Response(new Blob([body], { type: 'application/zip' }), {
      headers: {
        'Content-Disposition': `attachment; filename="${zipName}"`,
        'Content-Length': String(zipped.byteLength),
      },
    });
  });
