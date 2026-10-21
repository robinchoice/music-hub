import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { guestNoteSchema, guestSettingsSchema, guestStemSchema, guestTrackSchema, requestStemUploadUrlSchema } from '@music-hub/shared';
import { guestNotes, projects, stems, tracks, uploadLinks, users, type Database } from '@music-hub/db';
import { requireAuth, generateToken } from '../middleware/auth.js';
import { createUploadUrl, getObjectSize } from '../storage/s3.js';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { storageOf, guestStorageOf, fits, lockStorage, takeUploadVolume, uploadVolumeExceeded } from '../lib/storage.js';
import { freshStemKey } from '../lib/stems.js';
import { liveTrack } from '../lib/trash.js';
import { notBlocked } from '../lib/users.js';
import { notifyProjectMembers } from '../services/push.js';
import type { Context } from 'hono';
import { membershipOf } from '../lib/access.js';
import type { AppEnv } from '../types.js';

const UNAVAILABLE = 'Dieser Upload-Link ist ausgeschaltet oder gilt nicht mehr.';

// Guests don't get to see how full the storage of whoever shared the link is
const ownerFull = (c: Context) =>
  c.json({ error: 'Im Projekt ist gerade kein Platz mehr. Sag der Person Bescheid, die dir den Link geschickt hat.' }, 413);

const MINUTE = 60 * 1000;
const tracksPerLink = rateLimit('guest-tracks', 20, 24 * 60 * MINUTE);
const notesPerLink = rateLimit('guest-notes', 50, 24 * 60 * MINUTE);
const filesPerIp = rateLimit('guest-files-per-ip', 200, 60 * MINUTE);
// One push per track and link, however many files come in
const uploadAlerts = rateLimit('guest-upload-alerts', 1, 15 * MINUTE);

// The link with its project while it works: its creator lets guests upload, isn't blocked and may
// still upload there (not in an archived project), since the files count towards their storage
async function liveLink(db: Database, token: string) {
  const [row] = await db
    .select({ link: uploadLinks, project: projects, inviter: users.name })
    .from(uploadLinks)
    .innerJoin(projects, eq(projects.id, uploadLinks.projectId))
    .innerJoin(users, eq(users.id, uploadLinks.createdById))
    .where(and(eq(uploadLinks.token, token), eq(users.guestUploads, true), notBlocked(uploadLinks.createdById)))
    .limit(1);
  if (!row) return null;
  const membership = await membershipOf(db, row.link.projectId, row.link.createdById);
  return membership?.canUpload ? row : null;
}

// A live track of the link's project
async function guestTrack(db: Database, projectId: string, trackId: string) {
  const track = await liveTrack(db, trackId);
  return track?.projectId === projectId ? track : null;
}

// Both the creator's storage and the share of it they leave to guests have to hold the file
async function fitsForGuests(db: Pick<Database, 'execute'>, ownerId: string, bytes: number) {
  return fits(await storageOf(db, ownerId), bytes) && fits(await guestStorageOf(db, ownerId), bytes);
}

// paused: the creator doesn't let guests upload right now
const linkOf = async (db: Database, projectId: string) => {
  const [row] = await db
    .select({
      token: uploadLinks.token,
      createdAt: uploadLinks.createdAt,
      createdByName: users.name,
      paused: sql<boolean>`not ${users.guestUploads}`,
    })
    .from(uploadLinks)
    .innerJoin(users, eq(users.id, uploadLinks.createdById))
    .where(eq(uploadLinks.projectId, projectId))
    .limit(1);
  return row ?? null;
};

export const uploadLinkRoutes = new Hono<AppEnv>()
  // --- The account's own rule for guests: whether they may upload and how much ---
  .get('/settings', requireAuth, async (c) => {
    return c.json(await guestStorageOf(c.get('db'), c.get('userId')));
  })

  .patch('/settings', requireAuth, zValidator('json', guestSettingsSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { allowed, limit } = c.req.valid('json');
    await db
      .update(users)
      .set({ guestUploads: allowed, guestStorageLimit: limit, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return c.json(await guestStorageOf(db, userId));
  })

  .delete('/notes/:id', requireAuth, async (c) => {
    const db = c.get('db');
    const [note] = await db
      .select({ id: guestNotes.id, projectId: tracks.projectId })
      .from(guestNotes)
      .innerJoin(tracks, eq(tracks.id, guestNotes.trackId))
      .where(eq(guestNotes.id, c.req.param('id')));
    if (!note) return c.json({ error: 'Not found' }, 404);
    const membership = await membershipOf(db, note.projectId, c.get('userId'));
    if (!membership?.canUpload) return c.json({ error: 'Forbidden' }, 403);
    await db.delete(guestNotes).where(eq(guestNotes.id, note.id));
    return c.json({ message: 'Deleted' });
  })

  // --- Members who may upload: show, create or renew, switch off ---
  .get('/project/:projectId', requireAuth, async (c) => {
    const db = c.get('db');
    const projectId = c.req.param('projectId');
    const membership = await membershipOf(db, projectId, c.get('userId'));
    if (!membership?.canUpload) return c.json({ error: 'Forbidden' }, 403);
    return c.json({ link: await linkOf(db, projectId) });
  })

  // A new token replaces the old one, so a link that went too far can be renewed
  .post('/project/:projectId', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');
    const membership = await membershipOf(db, projectId, userId);
    if (!membership?.canUpload) return c.json({ error: 'Forbidden' }, 403);

    const values = { token: generateToken(), createdById: userId, createdAt: new Date() };
    await db
      .insert(uploadLinks)
      .values({ projectId, ...values })
      .onConflictDoUpdate({ target: uploadLinks.projectId, set: values });
    return c.json({ link: await linkOf(db, projectId) }, 201);
  })

  .delete('/project/:projectId', requireAuth, async (c) => {
    const db = c.get('db');
    const projectId = c.req.param('projectId');
    const membership = await membershipOf(db, projectId, c.get('userId'));
    if (!membership?.canUpload) return c.json({ error: 'Forbidden' }, 403);
    await db.delete(uploadLinks).where(eq(uploadLinks.projectId, projectId));
    return c.json({ message: 'Switched off' });
  })

  // --- Public: whoever has the link adds stems ---
  .get('/public/:token', async (c) => {
    const db = c.get('db');
    const found = await liveLink(db, c.req.param('token'));
    if (!found) return c.json({ error: UNAVAILABLE }, 404);

    const projectTracks = await db
      .select({ id: tracks.id, name: tracks.name })
      .from(tracks)
      .where(and(eq(tracks.projectId, found.project.id), isNull(tracks.deletedAt)))
      .orderBy(asc(tracks.sortOrder), asc(tracks.createdAt));

    return c.json({
      project: { name: found.project.name, artist: found.project.artist },
      invitedBy: found.inviter,
      tracks: projectTracks,
    });
  })

  .post('/public/:token/tracks', zValidator('json', guestTrackSchema), async (c) => {
    const db = c.get('db');
    const found = await liveLink(db, c.req.param('token'));
    if (!found) return c.json({ error: UNAVAILABLE }, 404);
    if (!(await tracksPerLink.hit(db, found.link.id))) return tooManyRequests(c);

    const [track] = await db
      .insert(tracks)
      .values({ name: c.req.valid('json').name, projectId: found.project.id, createdById: found.link.createdById })
      .returning({ id: tracks.id, name: tracks.name });
    return c.json({ track }, 201);
  })

  .post('/public/:token/track/:trackId/note', zValidator('json', guestNoteSchema), async (c) => {
    const db = c.get('db');
    const found = await liveLink(db, c.req.param('token'));
    if (!found) return c.json({ error: UNAVAILABLE }, 404);
    const track = await guestTrack(db, found.project.id, c.req.param('trackId'));
    if (!track) return c.json({ error: 'Not found' }, 404);
    if (!(await notesPerLink.hit(db, found.link.id))) return tooManyRequests(c);

    const { guestName, body } = c.req.valid('json');
    const [note] = await db.insert(guestNotes).values({ trackId: track.id, guestName, body }).returning({ id: guestNotes.id });
    return c.json({ note }, 201);
  })

  .post('/public/:token/track/:trackId/upload-url', zValidator('json', requestStemUploadUrlSchema), async (c) => {
    const db = c.get('db');
    const { fileName, mimeType, fileSize } = c.req.valid('json');
    const found = await liveLink(db, c.req.param('token'));
    if (!found) return c.json({ error: UNAVAILABLE }, 404);
    const track = await guestTrack(db, found.project.id, c.req.param('trackId'));
    if (!track) return c.json({ error: 'Not found' }, 404);
    if (!(await filesPerIp.hit(db, clientIp(c)))) return tooManyRequests(c);

    const ownerId = found.link.createdById;
    if (!(await fitsForGuests(db, ownerId, fileSize))) return ownerFull(c);
    if (!(await takeUploadVolume(db, ownerId, fileSize))) return uploadVolumeExceeded(c);

    const fileKey = `projects/${track.projectId}/tracks/${track.id}/stems/${crypto.randomUUID()}/${fileName}`;
    const uploadUrl = await createUploadUrl(fileKey, mimeType, fileSize);
    return c.json({ uploadUrl, fileKey });
  })

  .post('/public/:token/track/:trackId', zValidator('json', guestStemSchema), async (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const found = await liveLink(db, c.req.param('token'));
    if (!found) return c.json({ error: UNAVAILABLE }, 404);
    const track = await guestTrack(db, found.project.id, c.req.param('trackId'));
    if (!track) return c.json({ error: 'Not found' }, 404);
    if (!(await freshStemKey(db, track, input.fileKey))) return c.json({ error: 'Forbidden' }, 403);

    // The stored file decides the size, not what the client claims
    const fileSize = await getObjectSize(input.fileKey);
    if (fileSize === null) return c.json({ error: 'Datei nicht gefunden — bitte erneut hochladen' }, 400);

    const ownerId = found.link.createdById;
    const stem = await db.transaction(async (tx) => {
      await lockStorage(tx, ownerId);
      // Checked again under the lock, so the same file sent twice at once becomes one stem
      if (!(await freshStemKey(tx, track, input.fileKey))) return 'taken';
      if (!(await fitsForGuests(tx, ownerId, fileSize))) return null;
      const [stem] = await tx
        .insert(stems)
        .values({
          trackId: track.id,
          name: input.name,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          fileSize,
          fileKey: input.fileKey,
          guestName: input.guestName,
          createdById: ownerId,
        })
        .returning({ id: stems.id });
      return stem;
    });
    if (stem === 'taken') return c.json({ error: 'Forbidden' }, 403);
    if (!stem) return ownerFull(c);

    if (await uploadAlerts.hit(db, `${found.link.id}:${track.id}`)) {
      notifyProjectMembers(db, track.projectId, '', {
        projectId: track.projectId, trackId: track.id,
        title: 'Neue Spuren',
        body: `${input.guestName} hat Spuren zu ${track.name} hochgeladen`,
        url: `/projects/${track.projectId}/tracks/${track.id}`,
      }).catch(() => {});
    }

    return c.json({ stem }, 201);
  });
