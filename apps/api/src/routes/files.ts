import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createProjectFileSchema, requestFileUploadUrlSchema, updateProjectFileSchema } from '@music-hub/shared';
import { projectFiles, stemMixJobs, stems, tracks, users, type Database } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createDownloadUrl, createUploadUrl, getObjectSize } from '../storage/s3.js';
import { fits, lockStorage, storageFull, storageOf, takeUploadVolume, uploadVolumeExceeded } from '../lib/storage.js';
import { mayDownload, membershipOf } from '../lib/access.js';
import { isAudioFile, isAudioUploadKey, isProjectUploadKey, playableInline, projectUploadPrefix, uploadKeyInUse } from '../lib/files.js';
import { queueStemMix } from '../services/stem-mixes.js';
import { t } from '../lib/i18n.js';
import type { AppEnv } from '../types.js';
import { refuse, updateFile } from '../lib/track-moves.js';

const toStemSchema = z.object({ trackId: z.string().uuid(), mix: z.boolean().optional() });
const referenceSchema = z.object({ reference: z.boolean() });

// The file with the user's membership in its project; null if it is gone, in the trash or the user is no member
async function fileAccess(db: Database, fileId: string, userId: string) {
  const [file] = await db.select().from(projectFiles).where(and(eq(projectFiles.id, fileId), isNull(projectFiles.deletedAt))).limit(1);
  if (!file) return null;
  const membership = await membershipOf(db, file.projectId, userId);
  return membership ? { file, membership } : null;
}

// A live track of the project, so a file never points into another project
async function trackOfProject(db: Pick<Database, 'select'>, projectId: string, trackId: string) {
  const [track] = await db
    .select({ id: tracks.id, projectId: tracks.projectId })
    .from(tracks)
    .where(and(eq(tracks.id, trackId), eq(tracks.projectId, projectId), isNull(tracks.deletedAt)))
    .limit(1);
  return track;
}

const mayChange = (a: NonNullable<Awaited<ReturnType<typeof fileAccess>>>, userId: string) =>
  a.membership.canUpload && (a.membership.role === 'owner' || a.file.createdById === userId);

export const fileRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/project/:projectId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');
    const membership = await membershipOf(db, projectId, userId);
    if (!membership) return c.json({ error: 'Not found' }, 404);

    const rows = await db
      .select({
        id: projectFiles.id,
        originalFileName: projectFiles.originalFileName,
        mimeType: projectFiles.mimeType,
        fileSize: projectFiles.fileSize,
        trackId: projectFiles.trackId,
        createdById: projectFiles.createdById,
        createdByName: users.name,
        createdAt: projectFiles.createdAt,
        reference: projectFiles.reference,
      })
      .from(projectFiles)
      .innerJoin(users, eq(users.id, projectFiles.createdById))
      .where(and(eq(projectFiles.projectId, projectId), isNull(projectFiles.deletedAt)))
      .orderBy(desc(projectFiles.createdAt));

    return c.json({
      files: rows.map((f) => ({
        ...f,
        playable: mayDownload(membership) && playableInline(f.mimeType),
        // The file is its own original, so playing it needs the right to download
        canChange: membership.canUpload && (membership.role === 'owner' || f.createdById === userId),
        // Anyone who may upload picks the reference track, among the audio files
        markable: membership.canUpload && isAudioFile(f.originalFileName, f.mimeType),
      })),
      canDownload: mayDownload(membership),
    });
  })

  // One upload URL for everything dropped on a project: the file becomes a version, a stem or a file of the project afterwards
  .post('/project/:projectId/upload-url', zValidator('json', requestFileUploadUrlSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');
    const { fileName, mimeType, fileSize } = c.req.valid('json');
    const membership = await membershipOf(db, projectId, userId);
    if (!membership?.canUpload) return c.json({ error: 'Forbidden' }, 403);
    const storage = await storageOf(db, userId);
    if (!fits(storage, fileSize)) return storageFull(c, storage);
    if (!(await takeUploadVolume(db, userId, fileSize))) return uploadVolumeExceeded(c);
    const folder = /^audio\//.test(mimeType) ? 'original' : 'file';
    const fileKey = `${projectUploadPrefix(projectId)}${crypto.randomUUID()}/${folder}/${fileName}`;
    return c.json({ uploadUrl: await createUploadUrl(fileKey, mimeType, fileSize), fileKey });
  })

  .post('/project/:projectId', zValidator('json', createProjectFileSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');
    const input = c.req.valid('json');
    const membership = await membershipOf(db, projectId, userId);
    if (!membership?.canUpload) return c.json({ error: 'Forbidden' }, 403);
    if (!isProjectUploadKey(projectId, input.fileKey, ['original', 'file']) || (await uploadKeyInUse(db, input.fileKey))) return c.json({ error: 'Forbidden' }, 403);
    if (input.trackId && !(await trackOfProject(db, projectId, input.trackId))) return c.json({ error: 'Not found' }, 404);

    // The stored file decides the size, not what the client claims
    const fileSize = await getObjectSize(input.fileKey);
    if (fileSize === null) return c.json({ error: t(c).errors.fileMissing }, 400);

    const file = await db.transaction(async (tx) => {
      await lockStorage(tx, userId);
      // Checked again under the lock, so the same upload sent twice at once becomes one file
      if (await uploadKeyInUse(tx, input.fileKey)) return 'taken' as const;
      if (!fits(await storageOf(tx, userId), fileSize)) return null;
      const [row] = await tx
        .insert(projectFiles)
        .values({
          projectId,
          trackId: input.trackId ?? null,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          fileSize,
          fileKey: input.fileKey,
          createdById: userId,
        })
        .returning();
      return row;
    });
    if (file === 'taken') return c.json({ error: 'Forbidden' }, 403);
    if (!file) return storageFull(c, await storageOf(db, userId));
    return c.json({ file }, 201);
  })

  .get('/:id/download-url', async (c) => {
    const db = c.get('db');
    const access = await fileAccess(db, c.req.param('id'), c.get('userId'));
    if (!access) return c.json({ error: 'Not found' }, 404);
    if (!mayDownload(access.membership)) return c.json({ error: 'Forbidden' }, 403);
    // The type comes from the uploading client; a download is only ever bytes to save, never a page to show
    return c.json({ url: await createDownloadUrl(access.file.fileKey, 3600, access.file.originalFileName, 'application/octet-stream') });
  })

  // There is no compressed copy to listen to: the stream is the original, so it needs the right to download like the original.
  // Only audio a browser plays is served inline.
  .get('/:id/stream-url', async (c) => {
    const db = c.get('db');
    const access = await fileAccess(db, c.req.param('id'), c.get('userId'));
    if (!access) return c.json({ error: 'Not found' }, 404);
    if (!mayDownload(access.membership)) return c.json({ error: 'Forbidden' }, 403);
    if (!playableInline(access.file.mimeType)) return c.json({ error: 'Not found' }, 404);
    return c.json({ url: await createDownloadUrl(access.file.fileKey, 3600, undefined, access.file.mimeType) });
  })

  // Rename, give to another track (null: to none) or move into another project of the same owner
  .patch('/:id', zValidator('json', updateProjectFileSchema), async (c) => {
    const result = await updateFile(c.get('db'), c.req.param('id'), c.req.valid('json'), c.get('userId'));
    if (!result.ok) return refuse(c, result);
    return c.json({ file: result.file });
  })

  // Into the project's trash; the file in the bucket goes when it is deleted for good
  .delete('/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const access = await fileAccess(db, c.req.param('id'), userId);
    if (!access) return c.json({ error: 'Not found' }, 404);
    if (!mayChange(access, userId)) return c.json({ error: 'Forbidden' }, 403);
    await db.update(projectFiles).set({ deletedAt: new Date(), deletedById: userId }).where(eq(projectFiles.id, access.file.id));
    return c.json({ ok: true });
  })

  // The reference track of the project, that every version is compared with: one audio file, set by anyone who
  // may upload. Marking another file takes the mark from the previous one.
  .put('/:id/reference', zValidator('json', referenceSchema), async (c) => {
    const db = c.get('db');
    const { reference } = c.req.valid('json');
    const access = await fileAccess(db, c.req.param('id'), c.get('userId'));
    if (!access) return c.json({ error: 'Not found' }, 404);
    if (!access.membership.canUpload) return c.json({ error: 'Forbidden' }, 403);
    if (reference && !isAudioFile(access.file.originalFileName, access.file.mimeType)) return c.json({ error: t(c).errors.notAudio }, 400);
    await db.transaction(async (tx) => {
      if (reference) await tx.update(projectFiles).set({ reference: false }).where(and(eq(projectFiles.projectId, access.file.projectId), eq(projectFiles.reference, true)));
      // A file the worker couldn't measure gets another try when it is marked again
      await tx.update(projectFiles).set({ reference, ...(reference && !access.file.measurements && { measuredAt: null }) }).where(eq(projectFiles.id, access.file.id));
    });
    return c.json({ ok: true });
  })

  // The file becomes a stem of a track in the same project, with the same object in the bucket.
  // It stays with whoever uploaded it, so the storage it takes doesn't move to someone else.
  .post('/:id/stem', zValidator('json', toStemSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { trackId, mix } = c.req.valid('json');
    const access = await fileAccess(db, c.req.param('id'), userId);
    if (!access) return c.json({ error: 'Not found' }, 404);
    if (!mayChange(access, userId)) return c.json({ error: 'Forbidden' }, 403);
    const track = await trackOfProject(db, access.file.projectId, trackId);
    if (!track) return c.json({ error: 'Not found' }, 404);
    if (!isAudioFile(access.file.originalFileName, access.file.mimeType) || !isAudioUploadKey(access.file.fileKey)) {
      return c.json({ error: t(c).errors.notAudio }, 400);
    }

    const stem = await db.transaction(async (tx) => {
      const [moved] = await tx
        .delete(projectFiles)
        .where(and(eq(projectFiles.id, access.file.id), isNull(projectFiles.deletedAt)))
        .returning();
      if (!moved) return null;
      const [row] = await tx
        .insert(stems)
        .values({
          trackId,
          name: moved.originalFileName.replace(/\.[^.]+$/, '') || moved.originalFileName,
          originalFileName: moved.originalFileName,
          mimeType: moved.mimeType,
          fileSize: moved.fileSize,
          fileKey: moved.fileKey,
          createdById: moved.createdById,
        })
        .returning();
      if (mix !== undefined) await tx.update(tracks).set({ stemMix: mix }).where(eq(tracks.id, trackId));
      if (mix === false) await tx.delete(stemMixJobs).where(eq(stemMixJobs.trackId, trackId));
      else await queueStemMix(tx, trackId, userId);
      return row;
    });
    if (!stem) return c.json({ error: 'Not found' }, 404);
    return c.json({ stem }, 201);
  });
