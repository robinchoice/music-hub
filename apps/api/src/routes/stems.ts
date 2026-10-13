import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc, desc, isNull, isNotNull, getTableColumns, sql } from 'drizzle-orm';
import { requestStemUploadUrlSchema, createStemSchema, replaceStemSchema, MAX_ZIP_SIZE } from '@music-hub/shared';
import { stems, stemRevisions, openTracks, projectMembers, users, type Database } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createUploadUrl, createDownloadUrl, getObjectStream, getObjectSize } from '../storage/s3.js';
import { liveTrack } from '../lib/trash.js';
import { replaceStem, restoreRevision } from '../lib/stems.js';
import { storageOf, fits, lockStorage, storageFull, takeUploadVolume, uploadVolumeExceeded } from '../lib/storage.js';
import { Zip, ZipPassThrough } from 'fflate';
import type { AppEnv } from '../types.js';

export const stemRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/track/:trackId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('trackId');

    const track = await liveTrack(db, trackId);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Not found' }, 404);

    const trackStems = await db
      .select({
        ...getTableColumns(stems),
        revisionCount: sql<number>`(select count(*)::int from stem_revisions r where r.stem_id = stems.id and r.deleted_at is null)`,
      })
      .from(stems)
      .where(and(eq(stems.trackId, trackId), isNull(stems.deletedAt)))
      .orderBy(asc(stems.sortOrder), asc(stems.createdAt));

    return c.json({ stems: trackStems });
  })

  .post('/track/:trackId/upload-url', zValidator('json', requestStemUploadUrlSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('trackId');
    const { fileName, mimeType, fileSize } = c.req.valid('json');

    const track = await liveTrack(db, trackId);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership || !membership.canUpload) return c.json({ error: 'Forbidden' }, 403);

    const storage = await storageOf(db, userId);
    if (!fits(storage, fileSize)) return storageFull(c, storage);
    if (!(await takeUploadVolume(db, userId, fileSize))) return uploadVolumeExceeded(c);

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

    const track = await liveTrack(db, trackId);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership || !membership.canUpload) return c.json({ error: 'Forbidden' }, 403);

    if (!(await freshStemKey(db, track, input.fileKey))) return c.json({ error: 'Forbidden' }, 403);

    // The stored file decides the size, not what the client claims
    const fileSize = await getObjectSize(input.fileKey);
    if (fileSize === null) return c.json({ error: 'Datei nicht gefunden — bitte erneut hochladen' }, 400);

    const stem = await db.transaction(async (tx) => {
      await lockStorage(tx, userId);
      if (!fits(await storageOf(tx, userId), fileSize)) return null;

      const [stem] = await tx
        .insert(stems)
        .values({
          trackId,
          name: input.name,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          fileSize,
          fileKey: input.fileKey,
          sha256: input.sha256,
          createdById: userId,
        })
        .returning();
      return stem;
    });
    if (!stem) return storageFull(c, await storageOf(db, userId));

    return c.json({ stem }, 201);
  })

  .get('/:id/download-url', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const stemId = c.req.param('id');

    const [stem] = await db.select().from(stems).where(and(eq(stems.id, stemId), isNull(stems.deletedAt))).limit(1);
    if (!stem) return c.json({ error: 'Not found' }, 404);

    const track = await liveTrack(db, stem.trackId);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Not found' }, 404);

    const url = await createDownloadUrl(stem.fileKey, 3600, stem.originalFileName);
    return c.json({ url });
  })

  // A new file for the stem, e.g. after cutting something out; the current one moves into its history
  .post('/:id/replace', zValidator('json', replaceStemSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const input = c.req.valid('json');

    const access = await stemAccess(db, c.req.param('id'), userId);
    if (!access) return c.json({ error: 'Not found' }, 404);
    if (!mayChange(access, userId)) return c.json({ error: 'Forbidden' }, 403);
    if (await isOpen(db, access.track.id)) return c.json({ error: OPEN_TRACK }, 409);
    if (!(await freshStemKey(db, access.track, input.fileKey))) return c.json({ error: 'Forbidden' }, 403);

    const fileSize = await getObjectSize(input.fileKey);
    if (fileSize === null) return c.json({ error: 'Datei nicht gefunden — bitte erneut hochladen' }, 400);

    const stem = await replaceStem(db, access.stem.id, userId, { ...input, fileSize });
    if (!stem) return storageFull(c, await storageOf(db, userId));

    return c.json({ stem });
  })

  .get('/:id/revisions', async (c) => {
    const db = c.get('db');
    const access = await stemAccess(db, c.req.param('id'), c.get('userId'));
    if (!access) return c.json({ error: 'Not found' }, 404);

    const revisions = await db
      .select({
        id: stemRevisions.id,
        originalFileName: stemRevisions.originalFileName,
        fileSize: stemRevisions.fileSize,
        createdAt: stemRevisions.createdAt,
        replacedAt: stemRevisions.replacedAt,
        createdById: stemRevisions.createdById,
        createdByName: users.name,
      })
      .from(stemRevisions)
      .innerJoin(users, eq(users.id, stemRevisions.createdById))
      .where(and(eq(stemRevisions.stemId, access.stem.id), isNull(stemRevisions.deletedAt)))
      .orderBy(desc(stemRevisions.replacedAt));

    return c.json({ revisions });
  })

  .get('/revisions/:id/download-url', async (c) => {
    const db = c.get('db');
    const revision = await liveRevision(db, c.req.param('id'));
    if (!revision || !(await stemAccess(db, revision.stemId, c.get('userId')))) return c.json({ error: 'Not found' }, 404);

    const url = await createDownloadUrl(revision.fileKey, 3600, revision.originalFileName);
    return c.json({ url });
  })

  // Makes an earlier file current again; the current one moves into the history
  .post('/revisions/:id/restore', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const revision = await liveRevision(db, c.req.param('id'));
    const access = revision && (await stemAccess(db, revision.stemId, userId));
    if (!access) return c.json({ error: 'Not found' }, 404);
    if (!mayChange(access, userId)) return c.json({ error: 'Forbidden' }, 403);
    if (await isOpen(db, access.track.id)) return c.json({ error: OPEN_TRACK }, 409);

    const stem = await restoreRevision(db, revision.id);
    if (!stem) return c.json({ error: 'Not found' }, 404);

    return c.json({ stem });
  })

  // Into the project's trash, e.g. to free storage; the file goes when it is deleted for good
  .delete('/revisions/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const revision = await liveRevision(db, c.req.param('id'));
    const access = revision && (await stemAccess(db, revision.stemId, userId));
    if (!access) return c.json({ error: 'Not found' }, 404);
    if (access.membership.role !== 'owner' && revision.createdById !== userId) return c.json({ error: 'Forbidden' }, 403);

    await db
      .update(stemRevisions)
      .set({ deletedAt: new Date(), deletedById: userId })
      .where(eq(stemRevisions.id, revision.id));
    return c.json({ message: 'Revision deleted' });
  })

  .delete('/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const stemId = c.req.param('id');

    const [stem] = await db.select().from(stems).where(and(eq(stems.id, stemId), isNull(stems.deletedAt))).limit(1);
    if (!stem) return c.json({ error: 'Not found' }, 404);

    const track = await liveTrack(db, stem.trackId);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);

    if (!membership || (membership.role !== 'owner' && stem.createdById !== userId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Into the project's trash; the file goes when the stem is deleted for good
    await db.update(stems).set({ deletedAt: new Date(), deletedById: userId }).where(eq(stems.id, stemId));
    return c.json({ message: 'Stem deleted' });
  })

  .get('/track/:trackId/download-zip', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('trackId');

    const track = await liveTrack(db, trackId);
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
      .where(and(eq(stems.trackId, trackId), isNull(stems.deletedAt)))
      .orderBy(asc(stems.sortOrder), asc(stems.createdAt));

    if (trackStems.length === 0) return c.json({ error: 'No stems found' }, 404);
    if (trackStems.reduce((sum, stem) => sum + stem.fileSize, 0) > MAX_ZIP_SIZE) {
      return c.json({ error: 'Zu groß für ein ZIP — bitte die Spuren einzeln laden' }, 413);
    }

    return zipResponse(track.name, trackStems);
  });

// The live stem with its track and the user's membership in the project
async function stemAccess(db: Database, stemId: string, userId: string) {
  const [stem] = await db.select().from(stems).where(and(eq(stems.id, stemId), isNull(stems.deletedAt))).limit(1);
  if (!stem) return null;
  const track = await liveTrack(db, stem.trackId);
  if (!track) return null;
  const [membership] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return membership ? { stem, track, membership } : null;
}

// The public stems of an open track keep their files; a new one needs everyone's consent again
const OPEN_TRACK = 'Der Track ist offen. Schließe ihn, um Spuren zu ersetzen.';
async function isOpen(db: Database, trackId: string) {
  const [row] = await db
    .select({ trackId: openTracks.trackId })
    .from(openTracks)
    .where(and(eq(openTracks.trackId, trackId), isNotNull(openTracks.openedAt)));
  return !!row;
}

async function liveRevision(db: Database, revisionId: string) {
  const [revision] = await db
    .select()
    .from(stemRevisions)
    .where(and(eq(stemRevisions.id, revisionId), isNull(stemRevisions.deletedAt)));
  return revision;
}

// Who may delete a stem may also give it a new file
const mayChange = ({ stem, membership }: NonNullable<Awaited<ReturnType<typeof stemAccess>>>, userId: string) =>
  membership.canUpload && (membership.role === 'owner' || stem.createdById === userId);

// A key handed out by the upload URL route for this track that no stem uses yet
async function freshStemKey(db: Database, track: { id: string; projectId: string }, fileKey: string) {
  const expectedPrefix = `projects/${track.projectId}/tracks/${track.id}/stems/`;
  const keySuffix = fileKey.slice(expectedPrefix.length);
  if (!fileKey.startsWith(expectedPrefix) || !/^[0-9a-f-]{36}\/[^/]+$/.test(keySuffix)) return false;

  const [stemRef] = await db.select({ id: stems.id }).from(stems).where(eq(stems.fileKey, fileKey)).limit(1);
  const [revisionRef] = await db
    .select({ id: stemRevisions.id })
    .from(stemRevisions)
    .where(eq(stemRevisions.fileKey, fileKey))
    .limit(1);
  return !stemRef && !revisionRef;
}

// Pulls the next chunk only once the client has taken the last one
export function zipResponse(trackName: string, files: { originalFileName: string; fileKey: string }[]) {
  const chunks = zipStems(files);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await chunks.return();
    },
  });

  const zipName = `${trackName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-stems.zip`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`,
    },
  });
}

// Streams one stem after the other from the bucket into the uncompressed ZIP, so
// memory holds a few chunks however large the stems are
async function* zipStems(files: { originalFileName: string; fileKey: string }[]) {
  const out: Uint8Array[] = [];
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    out.push(chunk);
  });
  const names = new Set<string>();

  for (const file of files) {
    const entry = new ZipPassThrough(uniqueName(file.originalFileName, names));
    zip.add(entry);
    for await (const data of await getObjectStream(file.fileKey)) {
      entry.push(data);
      yield* out.splice(0);
    }
    entry.push(new Uint8Array(0), true);
  }
  zip.end();
  yield* out.splice(0);
}

// Plain, distinct file names: unpacking would otherwise create folders or overwrite
// files of the same name
function uniqueName(fileName: string, taken: Set<string>): string {
  const base = fileName.replace(/[\\/]/g, '_');
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = base.replace(/(\.[^.]*)?$/, ` (${n})$1`);
  taken.add(name.toLowerCase());
  return name;
}
