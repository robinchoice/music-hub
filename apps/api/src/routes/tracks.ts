import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc, sql, isNull } from 'drizzle-orm';
import { createTrackSchema, updateTrackSchema, openTrackSchema } from '@music-hub/shared';
import { tracks, projectMembers, openTracks, type Database } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { createDownloadUrl } from '../storage/s3.js';
import { liveTrack } from '../lib/trash.js';
import { openStateOf, requestOpen, consentToOpen } from '../lib/open.js';
import { rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { notifyUser } from '../services/push.js';
import type { AppEnv } from '../types.js';

// Reminders to agree to opening a track, per track and person
const openReminders = rateLimit('open-reminders', 1, 60 * 60 * 1000);

async function membershipOf(db: Database, projectId: string, userId: string) {
  const [membership] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return membership;
}

function askForConsent(db: Database, track: { id: string; name: string; projectId: string }, userId: string) {
  return notifyUser(db, userId, {
    title: 'Offen stellen?',
    body: `${track.name} soll offen werden. Stimmst du zu?`,
    url: `/projects/${track.projectId}/tracks/${track.id}`,
  }).catch(() => {});
}

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
        forkedFromId: tracks.forkedFromId,
        credit: tracks.credit,
        license: tracks.license,
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
  })

  // --- Open: approved version and stems for everyone to remix ---
  .get('/:id/open', async (c) => {
    const db = c.get('db');
    const track = await liveTrack(db, c.req.param('id'));
    if (!track || !(await membershipOf(db, track.projectId, c.get('userId')))) return c.json({ error: 'Not found' }, 404);
    return c.json({ open: await openStateOf(db, track.id) });
  })

  .post('/:id/open', zValidator('json', openTrackSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { license } = c.req.valid('json');
    const track = await liveTrack(db, c.req.param('id'));
    if (!track) return c.json({ error: 'Not found' }, 404);
    if ((await membershipOf(db, track.projectId, userId))?.role !== 'owner') return c.json({ error: 'Forbidden' }, 403);

    const state = await openStateOf(db, track.id);
    if (!state.allowedLicenses.includes(license)) {
      return c.json({ error: 'Diese Lizenz erlaubt das Original nicht' }, 400);
    }
    const result = await requestOpen(db, track.id, userId, license);
    if (!result) return c.json({ error: 'Erst eine Version freigeben' }, 400);

    const open = await openStateOf(db, track.id);
    if (!result.opened) {
      for (const p of open.contributors) if (!p.consented) void askForConsent(db, track, p.id);
    }
    return c.json({ open });
  })

  .post('/:id/open/consent', async (c) => {
    const db = c.get('db');
    const track = await liveTrack(db, c.req.param('id'));
    if (!track || !(await membershipOf(db, track.projectId, c.get('userId')))) return c.json({ error: 'Not found' }, 404);
    if (!(await consentToOpen(db, track.id, c.get('userId')))) return c.json({ error: 'Forbidden' }, 403);
    return c.json({ open: await openStateOf(db, track.id) });
  })

  .post('/:id/open/remind/:userId', async (c) => {
    const db = c.get('db');
    const track = await liveTrack(db, c.req.param('id'));
    if (!track) return c.json({ error: 'Not found' }, 404);
    if ((await membershipOf(db, track.projectId, c.get('userId')))?.role !== 'owner') return c.json({ error: 'Forbidden' }, 403);

    const person = (await openStateOf(db, track.id)).contributors.find((p) => p.id === c.req.param('userId'));
    if (!person || person.consented) return c.json({ error: 'Not found' }, 404);
    if (!(await openReminders.hit(db, `${track.id}:${person.id}`))) return tooManyRequests(c);
    await askForConsent(db, track, person.id);
    return c.json({ message: 'Reminded' });
  })

  // Closes the page and drops a pending request. Copies already taken stay licensed.
  .delete('/:id/open', async (c) => {
    const db = c.get('db');
    const track = await liveTrack(db, c.req.param('id'));
    if (!track) return c.json({ error: 'Not found' }, 404);
    if ((await membershipOf(db, track.projectId, c.get('userId')))?.role !== 'owner') return c.json({ error: 'Forbidden' }, 403);
    await db.delete(openTracks).where(eq(openTracks.trackId, track.id));
    return c.json({ open: await openStateOf(db, track.id) });
  });
