import { runInBackground } from '../lib/background.js';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray } from 'drizzle-orm';
import { contactRequestSchema, updateProfileSchema } from '@music-hub/shared';
import { contactRequests, profiles, stars, users } from '@music-hub/db';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { createDownloadUrl } from '../storage/s3.js';
import { rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { contactState, openTracksOf, sharedProject, suggestHandle, visibleProfile } from '../lib/profiles.js';
import { notifyUser } from '../services/push.js';
import { sendContactRequestEmail } from '../services/email.js';
import type { AppEnv } from '../types.js';

const DAY = 24 * 60 * 60 * 1000;
const requestsPerUser = rateLimit('contact-requests-per-user', 10, DAY);

export const profileRoutes = new Hono<AppEnv>()
  // Your own profile, or a suggested handle before there is one
  .get('/me', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    if (profile) return c.json({ profile });
    const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    return c.json({ profile: null, suggestedHandle: suggestHandle(me.name) });
  })

  .put('/me', requireAuth, zValidator('json', updateProfileSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const input = c.req.valid('json');
    const [taken] = await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.handle, input.handle));
    if (taken && taken.userId !== userId) return c.json({ error: 'Diesen Namen hat schon jemand.' }, 409);

    const values = { ...input, bio: input.bio || null, updatedAt: new Date() };
    const [profile] = await db
      .insert(profiles)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: profiles.userId, set: values })
      .returning();
    return c.json({ profile });
  })

  // Public: the profile page under /@handle
  .get('/:handle', optionalAuth, async (c) => {
    const db = c.get('db');
    const found = await visibleProfile(db, c.req.param('handle'));
    if (!found) return c.json({ error: 'Dieses Profil gibt es nicht.' }, 404);
    const { profile } = found;
    const viewerId = c.get('userId') as string | undefined;

    const rows = await openTracksOf(db, profile.userId);
    const starred = viewerId && rows.length
      ? new Set(
          (await db.select({ trackId: stars.trackId }).from(stars).where(and(eq(stars.userId, viewerId), inArray(stars.trackId, rows.map((t) => t.id))))).map(
            (s) => s.trackId,
          ),
        )
      : new Set<string>();
    const tracks = await Promise.all(
      rows.map(async ({ cover, downloads, remixesByOthers, ...t }) => ({
        ...t,
        starred: starred.has(t.id),
        coverUrl: cover ? await createDownloadUrl(cover) : null,
      })),
    );
    const sum = (key: 'stars' | 'remixesByOthers' | 'downloads') => rows.reduce((n, t) => n + Number(t[key]), 0);
    const contact = await contactState(db, profile, viewerId);

    return c.json({
      profile: {
        handle: profile.handle,
        name: found.name,
        avatarUrl: found.avatarUrl,
        bio: profile.bio,
        links: profile.links,
        // Someone's solo project carries their own name; "spielt in Mara Lenz" would only repeat it
        artists: [...new Set(rows.map((t) => t.artist).filter((a): a is string => !!a && a !== found.name))],
      },
      stats: profile.showStats
        ? { tracks: rows.length, stars: sum('stars'), remixes: sum('remixesByOthers'), downloads: sum('downloads') }
        : null,
      tracks,
      contact,
      sharedProjectId: contact === 'connected' ? await sharedProject(db, profile.userId, viewerId!) : null,
    });
  })

  .post('/:handle/requests', requireAuth, zValidator('json', contactRequestSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { message, trackId } = c.req.valid('json');
    const found = await visibleProfile(db, c.req.param('handle'));
    if (!found) return c.json({ error: 'Dieses Profil gibt es nicht.' }, 404);
    const state = await contactState(db, found.profile, userId);
    if (state === 'sent') return c.json({ error: 'Deine Anfrage ist schon unterwegs.' }, 409);
    if (state === 'connected') return c.json({ error: 'Ihr habt schon ein gemeinsames Projekt.' }, 409);
    if (state !== 'allowed') return c.json({ error: 'Anfragen sind hier gerade nicht möglich.' }, 403);
    if (!(await requestsPerUser.hit(db, userId))) return tooManyRequests(c);

    // Only one of the recipient's open tracks can be what it is about
    const about = trackId && (await openTracksOf(db, found.profile.userId)).some((t) => t.id === trackId) ? trackId : null;
    const [request] = await db
      .insert(contactRequests)
      .values({ fromUserId: userId, toUserId: found.profile.userId, trackId: about, message })
      .returning();

    const [[sender], [recipient]] = await Promise.all([
      db.select({ name: users.name }).from(users).where(eq(users.id, userId)),
      db.select({ email: users.email }).from(users).where(eq(users.id, found.profile.userId)),
    ]);
    runInBackground(notifyUser(db, found.profile.userId, {
      requestId: request.id,
      title: `Anfrage von ${sender.name}`,
      body: message.length > 120 ? `${message.slice(0, 119)}…` : message,
      url: '/for-you',
    }).catch((err) => console.error('[Push] Contact request failed:', err.message)));
    runInBackground(sendContactRequestEmail(recipient.email, sender.name, message).catch((err) =>
      console.error('[Email] Contact request failed:', err.message),
    ));
    return c.json({ request: { id: request.id } }, 201);
  });
