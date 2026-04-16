import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { requestUploadUrlSchema, createVersionSchema, updateVersionSchema } from '@music-hub/shared';
import { tracks, versions, projectMembers } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createUploadUrl, createDownloadUrl } from '../storage/s3.js';
import { processVersion } from '../services/audio-processor.js';
import type { AppEnv } from '../types.js';

export const versionRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Get all versions for a track
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

    const trackVersions = await db
      .select()
      .from(versions)
      .where(eq(versions.trackId, trackId))
      .orderBy(desc(versions.versionNumber));

    return c.json({ versions: trackVersions });
  })

  // Request presigned upload URL
  .post(
    '/track/:trackId/upload-url',
    zValidator('json', requestUploadUrlSchema),
    async (c) => {
      const db = c.get('db');
      const userId = c.get('userId');
      const trackId = c.req.param('trackId');
      const { fileName, mimeType, fileSize } = c.req.valid('json');

      const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
      if (!track) return c.json({ error: 'Not found' }, 404);

      const [membership] = await db
        .select()
        .from(projectMembers)
        .where(
          and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)),
        )
        .limit(1);

      if (!membership || !membership.canUpload) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      const versionId = crypto.randomUUID();
      const fileKey = `projects/${track.projectId}/tracks/${trackId}/versions/${versionId}/original/${fileName}`;

      const uploadUrl = await createUploadUrl(fileKey, mimeType, fileSize);

      return c.json({ uploadUrl, fileKey, versionId });
    },
  )

  // Register version after upload
  .post('/track/:trackId', zValidator('json', createVersionSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('trackId');
    const input = c.req.valid('json');

    const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)),
      )
      .limit(1);

    if (!membership || !membership.canUpload) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const expectedPrefix = `projects/${track.projectId}/tracks/${trackId}/`;
    if (!input.fileKey.startsWith(expectedPrefix)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Get next version number
    const [latest] = await db
      .select({ maxVersion: sql<number>`coalesce(max(${versions.versionNumber}), 0)` })
      .from(versions)
      .where(eq(versions.trackId, trackId));

    const versionNumber = (latest?.maxVersion ?? 0) + 1;

    const [version] = await db
      .insert(versions)
      .values({
        trackId,
        versionNumber,
        label: input.label,
        notes: input.notes,
        status: 'uploaded',
        parentVersionId: input.parentVersionId,
        branchLabel: input.branchLabel,
        originalFileName: input.originalFileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        originalFileKey: input.fileKey,
        createdById: userId,
      })
      .returning();

    // Background processing (fire and forget)
    processVersion(db, version.id).catch((err) =>
      console.error(`[Worker] Failed: ${err.message}`),
    );

    return c.json({ version }, 201);
  })

  // Update label/notes/branchLabel
  .patch('/:id', zValidator('json', updateVersionSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');
    const input = c.req.valid('json');

    const [version] = await db
      .select()
      .from(versions)
      .where(eq(versions.id, versionId))
      .limit(1);
    if (!version) return c.json({ error: 'Not found' }, 404);

    const [track] = await db
      .select()
      .from(tracks)
      .where(eq(tracks.id, version.trackId))
      .limit(1);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)),
      )
      .limit(1);

    if (!membership || !membership.canUpload) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [updated] = await db
      .update(versions)
      .set(input)
      .where(eq(versions.id, versionId))
      .returning();

    return c.json({ version: updated });
  })

  // Delete version
  .delete('/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const [version] = await db
      .select()
      .from(versions)
      .where(eq(versions.id, versionId))
      .limit(1);
    if (!version) return c.json({ error: 'Not found' }, 404);

    const [track] = await db
      .select()
      .from(tracks)
      .where(eq(tracks.id, version.trackId))
      .limit(1);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)),
      )
      .limit(1);

    if (!membership || membership.role !== 'owner') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await db.delete(versions).where(eq(versions.id, versionId));
    return c.json({ message: 'Version deleted' });
  })

  // Get version tree (graph) for a track
  .get('/track/:trackId/tree', async (c) => {
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

    const nodes = await db
      .select({
        id: versions.id,
        parentVersionId: versions.parentVersionId,
        branchLabel: versions.branchLabel,
        versionNumber: versions.versionNumber,
        label: versions.label,
        status: versions.status,
        createdById: versions.createdById,
        createdAt: versions.createdAt,
      })
      .from(versions)
      .where(eq(versions.trackId, trackId))
      .orderBy(asc(versions.createdAt));

    return c.json({ nodes });
  })

  // Promote a version to mainline (clears branchLabel)
  .post('/:id/promote', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const [version] = await db
      .select()
      .from(versions)
      .where(eq(versions.id, versionId))
      .limit(1);
    if (!version) return c.json({ error: 'Not found' }, 404);

    const [track] = await db
      .select()
      .from(tracks)
      .where(eq(tracks.id, version.trackId))
      .limit(1);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)),
      )
      .limit(1);

    if (!membership || !membership.canApprove) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [updated] = await db
      .update(versions)
      .set({ branchLabel: null })
      .where(eq(versions.id, versionId))
      .returning();

    return c.json({ version: updated });
  })

  // Get stream URL
  .get('/:id/stream-url', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const [version] = await db.select().from(versions).where(eq(versions.id, versionId)).limit(1);
    if (!version) return c.json({ error: 'Not found' }, 404);

    const [track] = await db.select().from(tracks).where(eq(tracks.id, version.trackId)).limit(1);
    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Not found' }, 404);

    const key = version.streamFileKey || version.originalFileKey;
    const url = await createDownloadUrl(key);

    return c.json({ url });
  })

  // Get download URL
  .get('/:id/download-url', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const [version] = await db.select().from(versions).where(eq(versions.id, versionId)).limit(1);
    if (!version) return c.json({ error: 'Not found' }, 404);

    const [track] = await db.select().from(tracks).where(eq(tracks.id, version.trackId)).limit(1);
    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Not found' }, 404);

    const url = await createDownloadUrl(version.originalFileKey);
    return c.json({ url });
  })

  // Get waveform data
  .get('/:id/waveform', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const [version] = await db.select().from(versions).where(eq(versions.id, versionId)).limit(1);
    if (!version || !version.waveformDataKey) return c.json({ error: 'Not found' }, 404);

    const [track] = await db.select().from(tracks).where(eq(tracks.id, version.trackId)).limit(1);
    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Not found' }, 404);

    const url = await createDownloadUrl(version.waveformDataKey);
    return c.json({ url });
  })

  // Approve version
  .post('/:id/approve', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const [version] = await db
      .select()
      .from(versions)
      .where(eq(versions.id, versionId))
      .limit(1);

    if (!version) return c.json({ error: 'Not found' }, 404);

    const [track] = await db
      .select()
      .from(tracks)
      .where(eq(tracks.id, version.trackId))
      .limit(1);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)),
      )
      .limit(1);

    if (!membership || !membership.canApprove) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [updated] = await db
      .update(versions)
      .set({ status: 'approved' })
      .where(eq(versions.id, versionId))
      .returning();

    return c.json({ version: updated });
  })

  // Reject version
  .post('/:id/reject', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const [version] = await db
      .select()
      .from(versions)
      .where(eq(versions.id, versionId))
      .limit(1);

    if (!version) return c.json({ error: 'Not found' }, 404);

    const [track] = await db
      .select()
      .from(tracks)
      .where(eq(tracks.id, version.trackId))
      .limit(1);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)),
      )
      .limit(1);

    if (!membership || !membership.canApprove) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [updated] = await db
      .update(versions)
      .set({ status: 'rejected' })
      .where(eq(versions.id, versionId))
      .returning();

    return c.json({ version: updated });
  });
