import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { forkTrackSchema, reportOpenTrackSchema, MAX_ZIP_SIZE, type OpenLicense } from '@music-hub/shared';
import { openReports, openTracks, projects, tracks, versions } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createDownloadUrl } from '../storage/s3.js';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { notBlocked } from '../lib/users.js';
import { ADMIN_EMAILS } from '../lib/admin.js';
import {
  artistOf,
  contributorsOf,
  creditLine,
  forkTrack,
  liveOpenTrack,
  openStems,
  openUrl,
  remixesOf,
} from '../lib/open.js';
import { sendOpenReportEmail } from '../services/email.js';
import { zipResponse } from './stems.js';
import type { AppEnv } from '../types.js';

const HOUR = 60 * 60 * 1000;
// Open stems are public; these keep a single address from running up the bucket's traffic
const downloadsPerIp = rateLimit('open-downloads-per-ip', 300, HOUR);
const zipsPerIp = rateLimit('open-zips-per-ip', 10, HOUR);
const reportsPerIp = rateLimit('open-reports-per-ip', 5, HOUR);

const NOT_OPEN = 'Diese Seite ist nicht (mehr) offen.';

// Public: no login needed, except for taking a track over into a project
export const openRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const db = c.get('db');
    const rows = await db
      .select({
        id: tracks.id,
        name: tracks.name,
        cover: sql<string | null>`coalesce(${tracks.coverImageUrl}, ${projects.coverImageUrl})`,
        artist: sql<string>`coalesce(${projects.artist}, ${projects.name})`,
        license: openTracks.license,
        openedAt: openTracks.openedAt,
        duration: versions.duration,
        stemCount: sql<number>`(select count(*)::int from stems s where s.track_id = ${tracks.id} and s.deleted_at is null and s.created_at <= ${openTracks.openedAt})`,
        remixCount: sql<number>`(select count(*)::int from tracks r where r.forked_from_id = ${tracks.id} and r.deleted_at is null)`,
      })
      .from(openTracks)
      .innerJoin(tracks, eq(tracks.id, openTracks.trackId))
      .innerJoin(versions, eq(versions.id, openTracks.versionId))
      .innerJoin(projects, eq(projects.id, tracks.projectId))
      .where(and(isNotNull(openTracks.openedAt), isNull(tracks.deletedAt), isNull(versions.deletedAt), notBlocked(projects.createdById)))
      .orderBy(desc(openTracks.openedAt))
      .limit(200);

    const list = await Promise.all(
      rows.map(async ({ cover, ...t }) => ({ ...t, coverUrl: cover ? await createDownloadUrl(cover) : null })),
    );
    return c.json({ tracks: list });
  })

  .get('/:trackId', async (c) => {
    const db = c.get('db');
    const found = await liveOpenTrack(db, c.req.param('trackId'));
    if (!found) return c.json({ error: NOT_OPEN }, 404);
    const { open, track, version, project } = found;
    const license = open.license as OpenLicense;

    if (c.req.query('meta') === '1') {
      return c.json({ track: { name: track.name }, artist: artistOf(project), license });
    }

    const people = await contributorsOf(db, track.id, version.id, open.requestedById);
    const files = await openStems(db, track.id, open.openedAt!);
    const cover = track.coverImageUrl ?? project.coverImageUrl;

    return c.json({
      track: { id: track.id, name: track.name, description: track.description, credit: track.credit, forkedFromId: track.forkedFromId },
      artist: artistOf(project),
      people: people.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl })),
      license,
      openedAt: open.openedAt,
      credit: creditLine(track.name, artistOf(project), people.map((p) => p.name), license, track.id),
      coverUrl: cover ? await createDownloadUrl(cover) : null,
      version: { duration: version.duration, label: version.label },
      streamUrl: await createDownloadUrl(version.streamFileKey || version.originalFileKey),
      waveformUrl: version.waveformDataKey ? await createDownloadUrl(version.waveformDataKey) : null,
      stems: files.map((s) => ({ id: s.id, name: s.name, fileSize: s.fileSize })),
      remixes: await remixesOf(db, track.id),
    });
  })

  .get('/:trackId/stems/:stemId', async (c) => {
    const db = c.get('db');
    const found = await liveOpenTrack(db, c.req.param('trackId'));
    if (!found) return c.json({ error: NOT_OPEN }, 404);
    const stem = (await openStems(db, found.track.id, found.open.openedAt!)).find((s) => s.id === c.req.param('stemId'));
    if (!stem) return c.json({ error: 'Not found' }, 404);
    if (!(await downloadsPerIp.hit(db, clientIp(c)))) return tooManyRequests(c);
    return c.json({ url: await createDownloadUrl(stem.fileKey, 3600, stem.originalFileName) });
  })

  .get('/:trackId/mix', async (c) => {
    const db = c.get('db');
    const found = await liveOpenTrack(db, c.req.param('trackId'));
    if (!found) return c.json({ error: NOT_OPEN }, 404);
    if (!(await downloadsPerIp.hit(db, clientIp(c)))) return tooManyRequests(c);
    const { version } = found;
    return c.json({ url: await createDownloadUrl(version.originalFileKey, 3600, version.originalFileName) });
  })

  .get('/:trackId/zip', async (c) => {
    const db = c.get('db');
    const found = await liveOpenTrack(db, c.req.param('trackId'));
    if (!found) return c.json({ error: NOT_OPEN }, 404);
    const files = await openStems(db, found.track.id, found.open.openedAt!);
    if (files.length === 0) return c.json({ error: 'No stems found' }, 404);
    if (files.reduce((sum, s) => sum + s.fileSize, 0) > MAX_ZIP_SIZE) {
      return c.json({ error: 'Zu groß für ein ZIP — bitte die Spuren einzeln laden' }, 413);
    }
    if (!(await zipsPerIp.hit(db, clientIp(c)))) return tooManyRequests(c);
    return zipResponse(found.track.name, files);
  })

  .post('/:trackId/report', zValidator('json', reportOpenTrackSchema), async (c) => {
    const db = c.get('db');
    const { reason, email } = c.req.valid('json');
    const found = await liveOpenTrack(db, c.req.param('trackId'));
    if (!found) return c.json({ error: NOT_OPEN }, 404);
    if (!(await reportsPerIp.hit(db, clientIp(c)))) return tooManyRequests(c);

    await db.insert(openReports).values({ trackId: found.track.id, reason, email: email ?? null });
    sendOpenReportEmail([...ADMIN_EMAILS], found.track.name, openUrl(found.track.id), reason, email ?? null).catch((err) =>
      console.error('[Open] Report email failed:', err.message),
    );
    return c.json({ message: 'Reported' }, 201);
  })

  .post('/:trackId/fork', requireAuth, zValidator('json', forkTrackSchema), async (c) => {
    const db = c.get('db');
    const track = await forkTrack(db, c.req.param('trackId'), c.get('userId'), c.req.valid('json').projectId);
    if (!track) return c.json({ error: 'Forbidden' }, 403);
    return c.json({ track: { id: track.id, projectId: track.projectId } }, 201);
  });
