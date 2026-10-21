import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc, asc, sql, inArray, isNull } from 'drizzle-orm';
import {
  requestUploadUrlSchema,
  createVersionSchema,
  updateVersionSchema,
  rejectVersionSchema,
  createReviewSchema,
  SUPPORTED_AUDIO_FORMATS,
  REJECTION_PREFIX,
} from '@music-hub/shared';
import { versions, comments } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createUploadUrl, createDownloadUrl, getObjectBuffer, getObjectSize, getObjectStream } from '../storage/s3.js';
import { storageOf, fits, lockStorage, storageFull, takeUploadVolume, uploadVolumeExceeded } from '../lib/storage.js';
import { enqueueAudioJob } from '../services/audio-jobs.js';
import { undoApproval } from '../lib/approval.js';
import { changeNotes, nameOf, reviewsOf, submitReview, withdrawApproval } from '../lib/reviews.js';
import { rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { reachOf } from '../lib/users.js';
import { notifyUser } from '../services/push.js';
import { sendReviewReminderEmail } from '../services/email.js';
import { publish } from '../services/sse.js';
import { queueVersionNotice } from '../lib/notices.js';
import { membershipOf, trackAccess, versionAccess } from '../lib/access.js';
import type { AppEnv } from '../types.js';

// Reminders to give feedback on a version, per version and person
const reviewReminders = rateLimit('review-reminders', 1, 60 * 60 * 1000);

export const versionRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Get all versions for a track
  .get('/track/:trackId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('trackId');

    const found = await trackAccess(db, trackId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track, membership } = found;

    if (!membership) return c.json({ error: 'Not found' }, 404);

    const trackVersions = await db
      .select()
      .from(versions)
      .where(and(eq(versions.trackId, trackId), isNull(versions.deletedAt)))
      .orderBy(desc(versions.versionNumber));

    const versionIds = trackVersions.map((v) => v.id);
    const [counts, rejections, notes] = await Promise.all([
      versionIds.length
        ? db
            .select({
              versionId: comments.versionId,
              count: sql<number>`count(*) filter (where ${comments.resolvedAt} is null)::int`,
            })
            .from(comments)
            .where(and(inArray(comments.versionId, versionIds), isNull(comments.parentId), isNull(comments.deletedAt)))
            .groupBy(comments.versionId)
        : [],
      versionIds.length
        ? db
            .selectDistinctOn([comments.versionId], { versionId: comments.versionId, body: comments.body })
            .from(comments)
            .where(and(
              inArray(comments.versionId, versionIds),
              isNull(comments.parentId),
              isNull(comments.deletedAt),
              sql`${comments.body} LIKE ${REJECTION_PREFIX + '%'}`,
            ))
            .orderBy(comments.versionId, desc(comments.createdAt))
        : [],
      changeNotes(db, versionIds),
    ]);
    const openCount = new Map(counts.map((row) => [row.versionId, row.count]));
    const rejectionReason = new Map(rejections.map((row) => [row.versionId, row.body.slice(REJECTION_PREFIX.length)]));

    return c.json({
      versions: trackVersions.map((v) => ({
        ...v,
        openCommentCount: openCount.get(v.id) ?? 0,
        rejectionReason: v.status === 'rejected' ? (notes.has(v.id) ? notes.get(v.id) : rejectionReason.get(v.id) ?? null) : null,
      })),
    });
  })

  .post('/project/:projectId/upload-url', zValidator('json', requestUploadUrlSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');
    const { fileName, mimeType, fileSize } = c.req.valid('json');
    const membership = await membershipOf(db, projectId, userId);
    if (!membership?.canUpload) return c.json({ error: 'Forbidden' }, 403);
    const storage = await storageOf(db, userId);
    if (!fits(storage, fileSize)) return storageFull(c, storage);
    if (!(await takeUploadVolume(db, userId, fileSize))) return uploadVolumeExceeded(c);
    const fileKey = `projects/${projectId}/uploads/${crypto.randomUUID()}/original/${fileName}`;
    return c.json({ uploadUrl: await createUploadUrl(fileKey, mimeType, fileSize), fileKey });
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

      const found = await trackAccess(db, trackId, userId);
      if (!found) return c.json({ error: 'Not found' }, 404);
      const { track, membership } = found;

      if (!membership || !membership.canUpload) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      const storage = await storageOf(db, userId);
      if (!fits(storage, fileSize)) return storageFull(c, storage);
      if (!(await takeUploadVolume(db, userId, fileSize))) return uploadVolumeExceeded(c);

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

    const found = await trackAccess(db, trackId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track, membership } = found;

    if (!membership || !membership.canUpload) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const expectedPrefix = [
      `projects/${track.projectId}/tracks/${trackId}/versions/`,
      `projects/${track.projectId}/uploads/`,
    ].find((prefix) => input.fileKey.startsWith(prefix));
    if (!expectedPrefix || !/^[0-9a-f-]{36}\/original\/[^/]+$/.test(input.fileKey.slice(expectedPrefix.length))) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [registered] = await db
      .select({ id: versions.id })
      .from(versions)
      .where(eq(versions.originalFileKey, input.fileKey))
      .limit(1);
    if (registered) return c.json({ error: 'Forbidden' }, 403);

    // The stored file decides the size, not what the client claims
    const fileSize = await getObjectSize(input.fileKey);
    if (fileSize === null) return c.json({ error: 'Datei nicht gefunden — bitte erneut hochladen' }, 400);

    const version = await db.transaction(async (tx) => {
      await lockStorage(tx, userId);
      // Checked again under the lock, so the same file sent twice at once becomes one version
      const [taken] = await tx.select({ id: versions.id }).from(versions).where(eq(versions.originalFileKey, input.fileKey)).limit(1);
      if (taken) return 'taken';
      if (!fits(await storageOf(tx, userId), fileSize)) return null;

      // Next version number; versions in the trash keep theirs
      const [latest] = await tx
        .select({ maxVersion: sql<number>`coalesce(max(${versions.versionNumber}), 0)` })
        .from(versions)
        .where(eq(versions.trackId, trackId));

      const [version] = await tx
        .insert(versions)
        .values({
          trackId,
          versionNumber: (latest?.maxVersion ?? 0) + 1,
          label: input.label,
          notes: input.notes,
          status: 'uploaded',
          parentVersionId: input.parentVersionId,
          branchLabel: input.branchLabel,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          fileSize,
          originalFileKey: input.fileKey,
          sha256: input.sha256,
          createdById: userId,
        })
        .returning();
      await enqueueAudioJob(tx, version.id);
      return version;
    });
    if (version === 'taken') return c.json({ error: 'Forbidden' }, 403);
    if (!version) return storageFull(c, await storageOf(db, userId));
    const { versionNumber } = version;

    // The worker announces it once the uploader pauses, so a batch becomes one push and one mail
    await queueVersionNotice(db, track.projectId, userId, version.id);

    publish(db, trackId, { type: 'version:new', data: { versionId: version.id, versionNumber, trackId } });

    return c.json({ version }, 201);
  })

  // Update label/notes/branchLabel
  .patch('/:id', zValidator('json', updateVersionSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');
    const input = c.req.valid('json');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;

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

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;

    if (!membership || membership.role !== 'owner') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Into the project's trash, with its comments
    await db.update(versions).set({ deletedAt: new Date(), deletedById: userId }).where(eq(versions.id, versionId));
    return c.json({ message: 'Version deleted' });
  })

  // Get version tree (graph) for a track
  .get('/track/:trackId/tree', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('trackId');

    const found = await trackAccess(db, trackId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track, membership } = found;

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
      .where(and(eq(versions.trackId, trackId), isNull(versions.deletedAt)))
      .orderBy(asc(versions.createdAt));

    return c.json({ nodes });
  })

  // Promote a version to mainline (clears branchLabel)
  .post('/:id/promote', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;

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

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;
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

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;
    if (!membership) return c.json({ error: 'Not found' }, 404);

    const url = await createDownloadUrl(version.originalFileKey);
    return c.json({ url });
  })

  // Get waveform data
  .get('/:id/waveform', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;
    if (!version.waveformDataKey) return c.json({ error: 'Not found' }, 404);
    if (!membership) return c.json({ error: 'Not found' }, 404);

    const url = await createDownloadUrl(version.waveformDataKey);
    return c.json({ url });
  })

  // Approve version
  .post('/:id/approve', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;

    if (!membership || !membership.canApprove) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Approving is a review like any other, so it closes the approver's pass and tells the uploader
    await submitReview(db, { version, track: track!, author: { userId }, authorName: await nameOf(db, userId), verdict: 'approve', canApprove: true });
    const [updated] = await db.select().from(versions).where(eq(versions.id, versionId));

    return c.json({ version: updated });
  })

  // Undo your own approval, offered by the toast right after it
  .post('/:id/unapprove', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;
    if (!membership || !membership.canApprove) return c.json({ error: 'Forbidden' }, 403);

    const updated = await undoApproval(db, versionId, userId);
    if (!updated) return c.json({ error: 'Die Freigabe lässt sich nicht mehr zurücknehmen.' }, 409);
    await withdrawApproval(db, versionId, userId);
    publish(db, version.trackId, { type: 'review:new', data: { versionId } });

    // undone: the audio stays the same, the player needn't reload
    publish(db, version.trackId, { type: 'version:status', data: { versionId, status: 'ready', undone: true } });

    return c.json({ version: updated });
  })

  // Proxy audio for offline download
  .get('/:id/audio', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');
    const quality = c.req.query('quality') === 'original' ? 'original' : 'stream';

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;
    if (!membership) return c.json({ error: 'Not found' }, 404);

    const useOriginal = quality === 'original' || !version.streamFileKey;
    const key = useOriginal ? version.originalFileKey : version.streamFileKey!;
    const contentType = useOriginal
      ? (SUPPORTED_AUDIO_FORMATS.find((type) => type === version.mimeType) ?? 'application/octet-stream')
      : 'audio/mpeg';

    const size = await getObjectSize(key);
    if (size === null) return c.json({ error: 'Not found' }, 404);
    const stream = await getObjectStream(key);
    return new Response(stream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Cache-Control': 'private, max-age=3600',
        'ETag': `"${versionId}-${quality}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
      },
    });
  })

  // Proxy waveform peaks for offline
  .get('/:id/waveform-data', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;
    if (!version.waveformDataKey) return c.json({ error: 'Not found' }, 404);
    if (!membership) return c.json({ error: 'Not found' }, 404);

    const buffer = await getObjectBuffer(version.waveformDataKey);
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'private, max-age=86400',
        'ETag': `"${versionId}-waveform"`,
      },
    });
  })

  // Reject version (requires reason — posted as a comment)
  .post('/:id/reject', zValidator('json', rejectVersionSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');
    const { reason } = c.req.valid('json');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;

    if (!membership || !membership.canApprove) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Older web versions still reject here; it is "Änderungen nötig" with the reason as note
    await submitReview(db, { version, track: track!, author: { userId }, authorName: await nameOf(db, userId), verdict: 'changes', note: reason, canApprove: true });
    const [updated] = await db.select().from(versions).where(eq(versions.id, versionId));

    return c.json({ version: updated });
  })

  // "Fertig mit V4": closes your listening pass with a verdict and tells the uploader
  .post('/:id/reviews', zValidator('json', createReviewSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('id');
    const { verdict, note } = c.req.valid('json');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;
    if (!membership || (!membership.canComment && !membership.canApprove)) return c.json({ error: 'Forbidden' }, 403);
    if (verdict === 'approve' && !membership.canApprove) return c.json({ error: 'Forbidden' }, 403);
    // Nobody finishes listening to their own upload; the web hides the button, the API refuses too
    if (version.createdById === userId) return c.json({ error: 'Forbidden' }, 403);

    const review = await submitReview(db, {
      version,
      track: track!,
      author: { userId },
      authorName: await nameOf(db, userId),
      verdict,
      note,
      canApprove: membership.canApprove,
    });
    return c.json({ review }, 201);
  })

  // The uploader or the owner asks an approver whose verdict is missing: a push, without one a mail
  .post('/:id/reviews/remind/:userId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const found = await versionAccess(db, c.req.param('id'), userId);
    if (!found || !found.membership) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;
    // canUpload also rests while the project is archived
    if ((version.createdById !== userId && membership.role !== 'owner') || !membership.canUpload) return c.json({ error: 'Forbidden' }, 403);

    // Once approved or rejected nobody's verdict is missing anymore
    const decided = version.status === 'approved' || version.status === 'rejected';
    const person = decided ? undefined : (await reviewsOf(db, version, track.projectId)).waiting.find((p) => p.id === c.req.param('userId'));
    if (!person) return c.json({ error: 'Not found' }, 404);
    if (!(await reviewReminders.hit(db, `${version.id}:${person.id}`))) return tooManyRequests(c);

    const fromName = await nameOf(db, userId);
    const { push, mail } = await reachOf(db, [person.id]);
    if (push.length) {
      await notifyUser(db, person.id, {
        projectId: track.projectId,
        trackId: track.id,
        title: `${fromName} wartet auf deine Rückmeldung`,
        body: `${track.name} V${version.versionNumber}`,
        url: `/projects/${track.projectId}/tracks/${track.id}?v=${version.id}`,
      }).catch(() => {});
    } else if (mail.length) {
      await sendReviewReminderEmail(mail[0].email, mail[0].mailToken, {
        fromName,
        projectId: track.projectId,
        trackId: track.id,
        versionId: version.id,
        trackName: track.name,
        versionNumber: version.versionNumber,
      }).catch((err) => console.error('[Reviews] Reminder mail failed:', err));
    }
    return c.json({ message: 'Reminded' });
  });
