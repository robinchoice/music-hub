import { runInBackground } from '../lib/background.js';
import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, asc, count, desc, inArray, isNull, ne, notInArray, or } from 'drizzle-orm';
import {
  createPaymentSchema,
  createProjectShareLinkSchema,
  createShareLinkSchema,
  deliveryApproveSchema,
  deliveryRoundSchema,
  DELIVERY_ERRORS,
  pickLocale,
  guestCommentSchema,
  guestReviewSchema,
  LIGHTNING_INVOICE_SECONDS,
  MAX_ZIP_SIZE,
  updateListenEventSchema,
  updateProjectShareLinkSchema,
  type DeliveryErrorCode,
} from '@music-hub/shared';
import {
  shareLinks,
  projectShareLinks,
  listenEvents,
  versions,
  tracks,
  projects,
  comments,
  users,
  projectMembers,
  reviews,
  deliveries,
  payments,
  type Database,
} from '@music-hub/db';
import { requireAuth, generateToken } from '../middleware/auth.js';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { createDownloadUrl } from '../storage/s3.js';
import { sendListenAlertEmail } from '../services/email.js';
import { liveVersion } from '../lib/trash.js';
import { newestVersionId, shownVersionId } from '../lib/shown-version.js';
import { mayDownload, membershipOf, versionAccess } from '../lib/access.js';
import { replyTarget } from './comments.js';
import { notBlocked } from '../lib/users.js';
import { submitReview } from '../lib/reviews.js';
import { publish } from '../services/sse.js';
import { zipResponse } from './stems.js';
import {
  activeDeliveryOfProjectLink,
  announcePayment,
  approveTrack,
  checkLightningPayments,
  deliveryOfProjectLink,
  deliveryOfShareLink,
  deliveryState,
  failureBody,
  insertPayment,
  invoiceDescription,
  methodsOf,
  paidDownload,
  paymentAccountOf,
  publicDeliveryOf,
  publicPaymentOf,
  requestRound,
  reusablePayment,
  type Delivery,
  type DeliveryFailure,
  type Payment,
} from '../lib/deliveries.js';
import { connectNwc } from '../lib/payments/nwc.js';
import { eurToSats } from '../lib/payments/rate.js';
import { decryptSecret } from '../lib/payments/secrets.js';
import { PaymentServiceError } from '../lib/payments/errors.js';


// Whether a guest's comment or "Fertig" is about the version shown now. A link that follows the track
// needs the version the guest heard; older pages don't send it and could otherwise land on a newer one.
function matchesShown(link: { follows: string }, heard: string | undefined, shown: string) {
  return heard ? heard === shown : link.follows === 'version';
}

// The version the link shows with its track and its creator's membership, null while the link pauses.
// A link never does more than its creator may right now: comments and downloads follow that membership.
async function liveTarget(db: Database, link: { versionId: string; follows: string; createdById: string }) {
  const versionId = await shownVersionId(db, link);
  if (!versionId) return null;
  const found = await liveVersion(db, versionId);
  if (!found) return null;
  const membership = await membershipOf(db, found.track.projectId, link.createdById);
  return membership ? { ...found, membership } : null;
}

type ProjectShareLink = typeof projectShareLinks.$inferSelect;

const projectLinkView = (l: ProjectShareLink) => ({
  id: l.id,
  token: l.token,
  expiresAt: l.expiresAt,
  allowComments: l.allowComments,
  allowDownload: l.allowDownload,
  hasPassword: l.passwordHash !== null,
  follows: l.follows,
  trackIds: l.trackIds,
  createdAt: l.createdAt,
});

// What the share link of each track takes over from its project link
export const trackLinkSettings = (l: ProjectShareLink) => ({
  expiresAt: l.expiresAt,
  allowComments: l.allowComments,
  allowDownload: l.allowDownload,
  passwordHash: l.passwordHash,
  follows: l.follows,
});

export async function ownProjectLink(db: Database, projectId: string, userId: string) {
  const [link] = await db
    .select()
    .from(projectShareLinks)
    .where(and(eq(projectShareLinks.projectId, projectId), eq(projectShareLinks.createdById, userId)))
    .orderBy(asc(projectShareLinks.createdAt))
    .limit(1);
  return link;
}

async function publicProject(p: { name: string; artist: string | null; coverImageUrl: string | null }) {
  return { name: p.name, artist: p.artist, coverUrl: p.coverImageUrl ? await createDownloadUrl(p.coverImageUrl) : null };
}

const MINUTE = 60 * 1000;
// Wrong passwords per share link, counted like failed logins
const failedPasswords = rateLimit('failed-share-passwords', 10, 15 * MINUTE);
const listensPerIp = rateLimit('listens-per-ip', 30, 60 * MINUTE);
// Progress updates while listening, every 30 seconds per guest; a studio shares one address
const listenUpdatesPerIp = rateLimit('listen-updates-per-ip', 3000, 60 * MINUTE);
// Listen alert emails per share link
const listenAlerts = rateLimit('listen-alerts', 1, 60 * MINUTE);
// Each guest review pushes to the uploader, so a link can't send many of them
const guestReviews = rateLimit('guest-reviews', 10, 60 * MINUTE);
// Each payment of a delivery asks the studio's wallet for an invoice
const deliveryPayments = rateLimit('delivery-payments', 10, 60 * MINUTE);
// The payment page polls its Lightning invoice every few seconds
const deliveryPaymentPolls = rateLimit('delivery-payment-polls', 600, 60 * MINUTE);
const deliveryDownloads = rateLimit('delivery-downloads', 100, 60 * MINUTE);

// Salted with a server secret, so the hashes of IPv4 addresses can't be listed
const IP_SALT = process.env.MAGIC_LINK_SECRET || 'musichub-salt';
async function hashIp(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + IP_SALT));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
import type { AppEnv } from '../types.js';
import { locale } from '../lib/i18n.js';

async function commentableLink(c: Context<AppEnv>, token: string) {
  const db = c.get('db');
  const password = c.req.header('x-share-password');

  const [link] = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.token, token), notBlocked(shareLinks.createdById)))
    .limit(1);
  if (!link) return c.json({ error: 'Not found' }, 404);
  if (link.expiresAt && link.expiresAt < new Date()) {
    return c.json({ error: 'Expired' }, 410);
  }
  if (!link.allowComments) return c.json({ error: 'Comments disabled' }, 403);
  if (link.passwordHash) {
    if (!password) return c.json({ error: 'Password required' }, 401);
    if (!(await failedPasswords.hit(db, link.id))) return tooManyRequests(c);
    if (!(await Bun.password.verify(password, link.passwordHash))) {
      return c.json({ error: 'Password required' }, 401);
    }
    await failedPasswords.undo(db, link.id);
  }
  return link;
}

// A project link a guest may open: not blocked, not expired, the right password, and its creator still
// in the project. Like a track link, it pauses while its creator is not.
async function openProjectLink(c: Context<AppEnv>, token: string) {
  const db = c.get('db');
  const password = c.req.header('x-share-password');

  const [link] = await db
    .select()
    .from(projectShareLinks)
    .where(and(eq(projectShareLinks.token, token), notBlocked(projectShareLinks.createdById)))
    .limit(1);
  if (!link) return c.json({ error: 'Not found' }, 404);
  if (link.expiresAt && link.expiresAt < new Date()) return c.json({ error: 'Expired' }, 410);
  if (link.passwordHash) {
    if (!password) return c.json({ error: 'Password required', passwordRequired: true }, 401);
    if (!(await failedPasswords.hit(db, link.id))) return tooManyRequests(c);
    if (!(await Bun.password.verify(password, link.passwordHash))) {
      return c.json({ error: 'Password required', passwordRequired: true }, 401);
    }
    await failedPasswords.undo(db, link.id);
  }
  const membership = await membershipOf(db, link.projectId, link.createdById);
  if (!membership) return c.json({ error: DELIVERY_ERRORS[locale(c)].unavailable }, 410);
  return { link, membership };
}

// An open project link with its delivery (open or paid); 404 without one or when it was cancelled
async function deliveryLink(c: Context<AppEnv>, token: string) {
  const opened = await openProjectLink(c, token);
  if (opened instanceof Response) return opened;
  const delivery = await activeDeliveryOfProjectLink(c.get('db'), opened.link.id);
  if (!delivery) return c.json({ error: 'Not found' }, 404);
  return { ...opened, delivery };
}

const refuse = (c: Context<AppEnv>, f: DeliveryFailure) => c.json(failureBody(f, locale(c)), f.status);
const deliveryError = <S extends 400 | 404 | 409 | 413 | 502>(c: Context<AppEnv>, code: DeliveryErrorCode, status: S) =>
  c.json({ error: DELIVERY_ERRORS[locale(c)][code], code }, status);

// A payment of the delivery and the delivery as they are now, for the guest page
async function guestPayment(db: Database, payment: Payment, deliveryId: string, link: ProjectShareLink) {
  const [delivery] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId)).limit(1);
  const [current] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
  const account = await paymentAccountOf(db, delivery!.createdById);
  return {
    payment: publicPaymentOf(current ?? payment, account, delivery!),
    delivery: await publicDeliveryOf(db, delivery!, link),
  };
}

// The payment `paymentId` if it belongs to the delivery
async function paymentOf(db: Database, delivery: Delivery, paymentId: string) {
  if (!z.string().uuid().safeParse(paymentId).success) return undefined;
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.deliveryId, delivery.id)))
    .limit(1);
  return payment;
}

// What a paid delivery hands out for the song :trackId, while the link and its creator still may
async function deliveryDownload(c: Context<AppEnv>) {
  const db = c.get('db');
  const found = await deliveryLink(c, c.req.param('token') ?? '');
  if (found instanceof Response) return found;
  if (!(await deliveryDownloads.hit(db, found.link.id))) return tooManyRequests(c);
  const trackId = c.req.param('trackId') ?? '';
  if (!z.string().uuid().safeParse(trackId).success) return deliveryError(c, 'track_invalid', 404);
  // A link never hands out more than its creator may download
  if (!mayDownload(found.membership)) return c.json(failureBody({ ok: false, status: 410, code: 'unavailable' }, locale(c)), 410);
  const result = await paidDownload(db, found.delivery, trackId);
  if (!result.ok) return refuse(c, result);
  return { ...result, includeStems: found.delivery.includeStems };
}

export const shareRoutes = new Hono<AppEnv>()
  // --- Authenticated: create / list / revoke ---
  .post(
    '/version/:versionId',
    requireAuth,
    zValidator('json', createShareLinkSchema),
    async (c) => {
      const db = c.get('db');
      const userId = c.get('userId');
      const versionId = c.req.param('versionId');
      const input = c.req.valid('json');

      const found = await versionAccess(db, versionId, userId);
      if (!found) return c.json({ error: 'Not found' }, 404);
      const { track, membership } = found;
      if (!membership) return c.json({ error: 'Forbidden' }, 403);

      const token = generateToken();
      const passwordHash = input.password
        ? await Bun.password.hash(input.password)
        : null;

      // The link grants at most what its creator may: no guest comments without the right to
      // comment, no download without the right to download
      const [link] = await db
        .insert(shareLinks)
        .values({
          versionId,
          token,
          createdById: userId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          allowComments: (input.allowComments ?? true) && membership.canComment,
          allowDownload: (input.allowDownload ?? false) && mayDownload(membership),
          passwordHash,
          follows: input.follows ?? 'version',
        })
        .returning();

      return c.json({ link: { ...link, passwordHash: undefined } }, 201);
    },
  )

  .get('/version/:versionId', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('versionId');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track, membership } = found;
    if (!membership) return c.json({ error: 'Forbidden' }, 403);

    const links = await db
      .select({
        id: shareLinks.id,
        token: shareLinks.token,
        expiresAt: shareLinks.expiresAt,
        allowComments: shareLinks.allowComments,
        allowDownload: shareLinks.allowDownload,
        hasPassword: shareLinks.passwordHash,
        follows: shareLinks.follows,
        createdAt: shareLinks.createdAt,
      })
      .from(shareLinks)
      .where(
        and(
          // The links of a project link are managed there
          isNull(shareLinks.projectLinkId),
          or(
            eq(shareLinks.versionId, versionId),
            // Links that follow the track show up at every version of it
            and(
              ne(shareLinks.follows, 'version'),
              inArray(shareLinks.versionId, db.select({ id: versions.id }).from(versions).where(eq(versions.trackId, track!.id))),
            ),
          ),
        ),
      )
      .orderBy(asc(shareLinks.createdAt));

    return c.json({
      links: links.map((l) => ({ ...l, hasPassword: l.hasPassword !== null })),
    });
  })

  .delete('/:linkId', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const linkId = c.req.param('linkId');

    const [link] = await db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.id, linkId))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);

    if (link.createdById !== userId) {
      const [owner] = await db
        .select({ id: projectMembers.id })
        .from(versions)
        .innerJoin(tracks, eq(tracks.id, versions.trackId))
        .innerJoin(projectMembers, eq(projectMembers.projectId, tracks.projectId))
        .where(
          and(
            eq(versions.id, link.versionId),
            eq(projectMembers.userId, userId),
            eq(projectMembers.role, 'owner'),
          ),
        )
        .limit(1);
      if (!owner) return c.json({ error: 'Forbidden' }, 403);
    }

    await db.delete(shareLinks).where(eq(shareLinks.id, linkId));
    return c.json({ message: 'Revoked' });
  })

  // --- Project links: one link for all tracks of a project, each played through a share link of its own ---
  .get('/project/:projectId', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');

    if (!(await membershipOf(db, projectId, userId))) return c.json({ error: 'Not found' }, 404);
    const link = await ownProjectLink(db, projectId, userId);
    return c.json({ link: link ? projectLinkView(link) : null });
  })

  // Everyone in the project has one link of their own; asking again returns it
  .post('/project/:projectId', requireAuth, zValidator('json', createProjectShareLinkSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');
    const input = c.req.valid('json');

    const membership = await membershipOf(db, projectId, userId);
    if (!membership) return c.json({ error: 'Forbidden' }, 403);
    const existing = await ownProjectLink(db, projectId, userId);
    if (existing) return c.json({ link: projectLinkView(existing) });

    const [link] = await db
      .insert(projectShareLinks)
      .values({
        projectId,
        token: generateToken(),
        createdById: userId,
        allowComments: (input.allowComments ?? true) && membership.canComment,
        allowDownload: (input.allowDownload ?? false) && mayDownload(membership),
        follows: input.follows ?? 'latest',
      })
      .returning();
    return c.json({ link: projectLinkView(link) }, 201);
  })

  .patch('/project-link/:linkId', requireAuth, zValidator('json', updateProjectShareLinkSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const input = c.req.valid('json');

    const [link] = await db.select().from(projectShareLinks).where(eq(projectShareLinks.id, c.req.param('linkId'))).limit(1);
    const membership = link?.createdById === userId ? await membershipOf(db, link.projectId, userId) : undefined;
    if (!link || !membership) return c.json({ error: 'Not found' }, 404);

    const set: Partial<typeof projectShareLinks.$inferInsert> = {};
    if (input.follows) set.follows = input.follows;
    if (input.allowComments !== undefined) set.allowComments = input.allowComments && membership.canComment;
    if (input.allowDownload !== undefined) set.allowDownload = input.allowDownload && mayDownload(membership);
    if (input.password !== undefined) set.passwordHash = input.password ? await Bun.password.hash(input.password) : null;
    if (input.expiresAt !== undefined) set.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (input.trackIds !== undefined) set.trackIds = input.trackIds;

    // The share links of its tracks take the new settings; tracks no longer in it lose theirs
    const updated = await db.transaction(async (tx) => {
      const [row] = Object.keys(set).length
        ? await tx.update(projectShareLinks).set(set).where(eq(projectShareLinks.id, link.id)).returning()
        : [link];
      await tx.update(shareLinks).set(trackLinkSettings(row)).where(eq(shareLinks.projectLinkId, row.id));
      if (row.trackIds) {
        await tx
          .delete(shareLinks)
          .where(and(eq(shareLinks.projectLinkId, row.id), notInArray(shareLinks.trackId, row.trackIds)));
      }
      return row;
    });
    return c.json({ link: projectLinkView(updated) });
  })

  .delete('/project-link/:linkId', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const [link] = await db.select().from(projectShareLinks).where(eq(projectShareLinks.id, c.req.param('linkId'))).limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);
    if (link.createdById !== userId && (await membershipOf(db, link.projectId, userId))?.role !== 'owner') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    // An open or paid delivery hangs on it, with the client's approvals and payments: those stay
    const delivery = await deliveryOfProjectLink(db, link.id);
    if (delivery && delivery.status !== 'cancelled') return deliveryError(c, 'link_has_delivery', 409);
    // The share links of its tracks go with it
    await db.delete(projectShareLinks).where(eq(projectShareLinks.id, link.id));
    return c.json({ message: 'Revoked' });
  })

  // The tracks of a project link, each with the token of its own share link. The guest page plays and
  // comments through those, so a track behaves exactly like a track link with the same settings.
  .get('/project/public/:token', async (c) => {
    const db = c.get('db');
    const opened = await openProjectLink(c, c.req.param('token'));
    if (opened instanceof Response) return opened;
    const { link, membership } = opened;
    const [project] = await db.select().from(projects).where(eq(projects.id, link.projectId)).limit(1);

    if (c.req.query('meta') === '1') {
      return c.json({ project: { name: project!.name, artist: project!.artist } });
    }

    const list = await db
      .select()
      .from(tracks)
      .where(
        and(
          eq(tracks.projectId, link.projectId),
          isNull(tracks.deletedAt),
          link.trackIds ? inArray(tracks.id, link.trackIds) : undefined,
        ),
      )
      .orderBy(asc(tracks.sortOrder), asc(tracks.createdAt));

    // Tracks without anything to play yet stay out
    const shown: { track: (typeof list)[number]; versionId: string }[] = [];
    for (const track of list) {
      const versionId = await newestVersionId(db, track.id, link.follows);
      if (versionId) shown.push({ track, versionId });
    }
    // Behind a delivery the originals come only after paying, through the delivery's own downloads
    const delivery = await activeDeliveryOfProjectLink(db, link.id);
    const deliveryField = delivery ? { delivery: await publicDeliveryOf(db, delivery, link) } : {};
    if (shown.length === 0) {
      return c.json({ project: await publicProject(project!), allowComments: false, allowDownload: false, tracks: [], ...deliveryField });
    }

    // A track gets its share link the first time the project link shows it
    await db
      .insert(shareLinks)
      .values(
        shown.map((s) => ({
          versionId: s.versionId,
          token: generateToken(),
          createdById: link.createdById,
          projectLinkId: link.id,
          trackId: s.track.id,
          ...trackLinkSettings(link),
        })),
      )
      .onConflictDoNothing({ target: [shareLinks.projectLinkId, shareLinks.trackId] });
    const trackLinks = await db
      .select({ trackId: shareLinks.trackId, token: shareLinks.token })
      .from(shareLinks)
      .where(eq(shareLinks.projectLinkId, link.id));
    const tokenOf = new Map(trackLinks.map((l) => [l.trackId, l.token]));

    const versionIds = shown.map((s) => s.versionId);
    const shownVersions = await db.select().from(versions).where(inArray(versions.id, versionIds));
    const versionOf = new Map(shownVersions.map((v) => [v.id, v]));
    const allowComments = link.allowComments && membership.canComment;
    const counts = allowComments
      ? await db
        .select({ versionId: comments.versionId, count: count() })
        .from(comments)
        .where(and(inArray(comments.versionId, versionIds), isNull(comments.deletedAt)))
        .groupBy(comments.versionId)
      : [];
    const countOf = new Map(counts.map((r) => [r.versionId, r.count]));

    return c.json({
      project: await publicProject(project!),
      allowComments,
      allowDownload: !delivery && link.allowDownload && mayDownload(membership),
      tracks: await Promise.all(
        shown.map(async ({ track, versionId }) => {
          const version = versionOf.get(versionId)!;
          return {
            id: track.id,
            name: track.name,
            token: tokenOf.get(track.id)!,
            coverUrl: track.coverImageUrl ? await createDownloadUrl(track.coverImageUrl) : null,
            version: { id: version.id, versionNumber: version.versionNumber, label: version.label, duration: version.duration },
            comments: countOf.get(versionId) ?? 0,
          };
        }),
      ),
      ...deliveryField,
    });
  })

  // --- Delivery on a project link: the client approves or asks for a round, pays, downloads ---
  // Each answer may push to the uploader, so they count like guest reviews, per song as on its track link
  .post('/project/public/:token/delivery/rounds', zValidator('json', deliveryRoundSchema), async (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const found = await deliveryLink(c, c.req.param('token'));
    if (found instanceof Response) return found;
    const limitKey = `${found.link.id}:${input.trackId}`;
    if (!(await guestReviews.hit(db, limitKey))) return tooManyRequests(c);

    const result = await requestRound(db, { delivery: found.delivery, link: found.link, ...input });
    if (!result.ok) {
      // Nothing went out, e.g. the extra round still needs confirming
      await guestReviews.undo(db, limitKey);
      return refuse(c, result);
    }
    return c.json({ delivery: await publicDeliveryOf(db, found.delivery, found.link) }, 201);
  })

  .post('/project/public/:token/delivery/approve', zValidator('json', deliveryApproveSchema), async (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const found = await deliveryLink(c, c.req.param('token'));
    if (found instanceof Response) return found;
    const limitKey = `${found.link.id}:${input.trackId}`;
    if (!(await guestReviews.hit(db, limitKey))) return tooManyRequests(c);

    const result = await approveTrack(db, { delivery: found.delivery, link: found.link, ...input });
    if (!result.ok) {
      await guestReviews.undo(db, limitKey);
      return refuse(c, result);
    }
    return c.json({ delivery: await publicDeliveryOf(db, found.delivery, found.link) });
  })

  // Starts paying what is due once every song is approved: a Lightning invoice from the studio's own
  // wallet or the studio's bank details. The open payment comes back while it fits (same method and
  // amount, an invoice still valid), anything else replaces it.
  .post('/project/public/:token/delivery/payments', zValidator('json', createPaymentSchema), async (c) => {
    const db = c.get('db');
    const { method } = c.req.valid('json');
    const found = await deliveryLink(c, c.req.param('token'));
    if (found instanceof Response) return found;
    const { link } = found;
    if (!(await deliveryPayments.hit(db, link.id))) return tooManyRequests(c);

    // An invoice about to be replaced may have been paid in the meantime
    await checkLightningPayments(db, found.delivery.id);
    const delivery = (await db.select().from(deliveries).where(eq(deliveries.id, found.delivery.id)).limit(1))[0]!;
    if (delivery.status === 'paid') return deliveryError(c, 'already_paid', 409);
    const { totals, payable } = await deliveryState(db, delivery, link.follows);
    if (!payable) return deliveryError(c, 'not_payable', 409);
    const account = await paymentAccountOf(db, delivery.createdById);
    if (!account || !methodsOf(account)[method]) return deliveryError(c, 'method_unavailable', 400);
    const reused = await reusablePayment(db, delivery.id, method, totals.dueCents);
    if (reused) return c.json(await guestPayment(db, reused, delivery.id, link), 200);

    let lightning: { sats: number; invoice: string; paymentHash: string; expiresAt: Date } | undefined;
    if (method === 'lightning') {
      const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, delivery.projectId)).limit(1);
      try {
        const sats = await eurToSats(totals.dueCents);
        const client = await connectNwc(decryptSecret(account.nwcSecretEnc!));
        try {
          const made = await client.makeInvoice({
            amountMsats: sats * 1000,
            description: invoiceDescription(delivery, project!.name),
            expirySeconds: LIGHTNING_INVOICE_SECONDS,
          });
          lightning = {
            sats,
            invoice: made.invoice,
            paymentHash: made.paymentHash,
            expiresAt: made.expiresAt ?? new Date(Date.now() + LIGHTNING_INVOICE_SECONDS * 1000),
          };
        } finally {
          client.close();
        }
      } catch (err) {
        // Only our own messages: other errors may carry the connection string
        if (err instanceof PaymentServiceError) return c.json({ error: err.text(locale(c)), code: err.code }, 502);
        console.error('[Deliveries] Invoice failed');
        return deliveryError(c, 'wallet_unreachable', 502);
      }
    }

    const payment = await insertPayment(db, { delivery, link, method, amountCents: totals.dueCents, ...lightning });
    if (!payment) return deliveryError(c, 'not_payable', 409);
    return c.json(await guestPayment(db, payment, delivery.id, link), 201);
  })

  // The payment page polls here; the delivery's Lightning invoices, replaced ones included, are
  // checked with the wallet on every call
  .get('/project/public/:token/delivery/payments/:paymentId', async (c) => {
    const db = c.get('db');
    const found = await deliveryLink(c, c.req.param('token'));
    if (found instanceof Response) return found;
    if (!(await deliveryPaymentPolls.hit(db, clientIp(c)))) return tooManyRequests(c);
    const payment = await paymentOf(db, found.delivery, c.req.param('paymentId'));
    if (!payment) return c.json({ error: 'Not found' }, 404);

    await checkLightningPayments(db, found.delivery.id);
    return c.json(await guestPayment(db, payment, found.delivery.id, found.link));
  })

  // "Ich habe überwiesen": the studio sees the transfer is on its way and confirms it once it arrived
  .post('/project/public/:token/delivery/payments/:paymentId/announce', async (c) => {
    const db = c.get('db');
    const found = await deliveryLink(c, c.req.param('token'));
    if (found instanceof Response) return found;
    if (!(await guestReviews.hit(db, found.link.id))) return tooManyRequests(c);
    const payment = await paymentOf(db, found.delivery, c.req.param('paymentId'));
    if (!payment) return c.json({ error: 'Not found' }, 404);

    if (!(await announcePayment(db, payment.id))) return deliveryError(c, 'payment_closed', 409);
    return c.json(await guestPayment(db, payment, found.delivery.id, found.link));
  })

  // After paying: the original of the approved version, through a short-lived URL
  .get('/project/public/:token/delivery/download/:trackId', async (c) => {
    const download = await deliveryDownload(c);
    if (download instanceof Response) return download;
    const { version } = download;
    const url = await createDownloadUrl(version.originalFileKey, 300, version.originalFileName);
    // A page that has to send the password header can't follow a plain link: it asks for the URL
    if (c.req.query('redirect') === '0') return c.json({ url });
    return c.redirect(url, 302);
  })

  .get('/project/public/:token/delivery/download/:trackId/stems', async (c) => {
    const download = await deliveryDownload(c);
    if (download instanceof Response) return download;
    if (!download.includeStems || download.stems.length === 0) return deliveryError(c, 'track_invalid', 404);
    // The ZIP has no ZIP64, a bigger one would break
    if (download.stems.reduce((total, stem) => total + stem.fileSize, 0) > MAX_ZIP_SIZE) return deliveryError(c, 'zip_too_large', 413);
    return zipResponse(download.track.name, download.stems);
  })

  // --- Public: resolve token, fetch, comment ---
  .get('/public/:token', async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');
    const password = c.req.header('x-share-password');

    const [link] = await db
      .select()
      .from(shareLinks)
      .where(and(eq(shareLinks.token, token), notBlocked(shareLinks.createdById)))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);
    if (link.expiresAt && link.expiresAt < new Date()) {
      return c.json({ error: 'Expired' }, 410);
    }
    if (link.passwordHash) {
      if (!password) return c.json({ error: 'Password required', passwordRequired: true }, 401);
      if (!(await failedPasswords.hit(db, link.id))) return tooManyRequests(c);
      if (!(await Bun.password.verify(password, link.passwordHash))) {
        return c.json({ error: 'Password required', passwordRequired: true }, 401);
      }
      await failedPasswords.undo(db, link.id);
    }

    const found = await liveTarget(db, link);
    if (!found) return c.json({ error: DELIVERY_ERRORS[locale(c)].unavailable }, 410);
    const { version, track, membership } = found;
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, track!.projectId))
      .limit(1);

    if (c.req.query('meta') === '1') {
      return c.json({ project: { name: project!.name }, track: { name: track!.name } });
    }

    // Behind a delivery the original never leaves: only the MP3 plays, and without one the track is
    // still being prepared
    const paywall = link.projectLinkId ? !!(await deliveryOfShareLink(db, link.id)) : false;
    const streamKey = paywall ? version.streamFileKey : version.streamFileKey || version.originalFileKey;
    const streamUrl = streamKey ? await createDownloadUrl(streamKey) : null;
    const waveformUrl = version.waveformDataKey
      ? await createDownloadUrl(version.waveformDataKey)
      : null;
    const downloadUrl = !paywall && link.allowDownload && mayDownload(membership)
      ? await createDownloadUrl(version.originalFileKey)
      : null;
    // A link for listening only shows no comments either, they belong to the people in the project
    const allowComments = link.allowComments && membership.canComment;

    const versionComments = allowComments ? await db
      .select({
        id: comments.id,
        body: comments.body,
        timestampSeconds: comments.timestampSeconds,
        parentId: comments.parentId,
        resolvedAt: comments.resolvedAt,
        createdAt: comments.createdAt,
        guestName: comments.guestName,
        user: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.userId))
      .where(and(eq(comments.versionId, version.id), isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt)) : [];

    // Guests finish their pass by name; the page counts their comments since their last review
    const guestReviewRows = allowComments ? await db
      .select({ guestName: reviews.guestName, createdAt: reviews.createdAt })
      .from(reviews)
      .where(and(eq(reviews.versionId, version.id), isNull(reviews.userId)))
      .orderBy(asc(reviews.createdAt)) : [];
    const [uploader] = await db.select({ name: users.name }).from(users).where(eq(users.id, version.createdById));

    return c.json({
      project: { name: project!.name },
      track: { id: track!.id, name: track!.name },
      version: {
        id: version.id,
        versionNumber: version.versionNumber,
        label: version.label,
        notes: version.notes,
        duration: version.duration,
        status: version.status,
        originalFileName: version.originalFileName,
      },
      streamUrl,
      waveformUrl,
      downloadUrl,
      allowComments,
      comments: versionComments,
      reviews: guestReviewRows,
      uploaderName: uploader?.name ?? null,
      ...(paywall ? { processing: !streamKey } : {}),
    });
  })

  .post('/public/:token/comments', zValidator('json', guestCommentSchema), async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');
    const input = c.req.valid('json');

    const link = await commentableLink(c, token);
    if (link instanceof Response) return link;

    // A link that follows the track comments on the version it shows right now
    const found = await liveTarget(db, link);
    if (!found) return c.json({ error: DELIVERY_ERRORS[locale(c)].unavailable }, 410);
    if (!found.membership.canComment) return c.json({ error: 'Comments disabled' }, 403);
    const versionId = found.version.id;
    if (!matchesShown(link, input.versionId, versionId)) return c.json({ error: DELIVERY_ERRORS[locale(c)].moved_on }, 409);

    if (input.parentId) {
      const parent = await replyTarget(db, input.parentId, versionId);
      if (parent instanceof Response) return parent;
    }
    if (!(await guestReviews.hit(db, link.id))) return tooManyRequests(c);

    const [comment] = await db
      .insert(comments)
      .values({
        versionId,
        userId: null,
        guestName: input.guestName,
        body: input.body,
        timestampSeconds: input.timestampSeconds,
        parentId: input.parentId,
      })
      .returning();

    publish(db, found.track.id, { type: 'comment:new', data: { versionId, commentId: comment.id } });
    return c.json({ comment }, 201);
  })

  // A guest's "Fertig": their verdict on the version goes to the uploader
  .post('/public/:token/review', zValidator('json', guestReviewSchema), async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');
    const input = c.req.valid('json');

    const link = await commentableLink(c, token);
    if (link instanceof Response) return link;
    if (!(await guestReviews.hit(db, link.id))) return tooManyRequests(c);

    const found = await liveTarget(db, link);
    if (!found) return c.json({ error: DELIVERY_ERRORS[locale(c)].unavailable }, 410);
    if (!found.membership.canComment) return c.json({ error: 'Comments disabled' }, 403);
    if (!matchesShown(link, input.versionId, found.version.id)) return c.json({ error: DELIVERY_ERRORS[locale(c)].moved_on }, 409);

    await submitReview(db, {
      version: found.version,
      track: found.track!,
      author: { guestName: input.guestName },
      authorName: input.guestName,
      verdict: input.verdict,
      note: input.note,
      canApprove: false,
    });
    return c.json({ ok: true }, 201);
  })

  // --- Listen tracking (public, no auth) ---
  .post('/public/:token/listen', async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');

    const [link] = await db
      .select({ id: shareLinks.id, expiresAt: shareLinks.expiresAt })
      .from(shareLinks)
      .where(and(eq(shareLinks.token, token), notBlocked(shareLinks.createdById)))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);
    if (link.expiresAt && link.expiresAt < new Date()) return c.json({ error: 'Expired' }, 410);

    const ip = clientIp(c);
    if (!(await listensPerIp.hit(db, ip))) return tooManyRequests(c);
    const ipHash = await hashIp(ip);
    const userAgent = (c.req.header('user-agent') ?? '').slice(0, 500);

    const [event] = await db
      .insert(listenEvents)
      .values({ shareLinkId: link.id, ipHash, userAgent })
      .returning({ id: listenEvents.id });

    return c.json({ eventId: event.id }, 201);
  })

  .patch('/public/:token/listen/:eventId', zValidator('json', updateListenEventSchema), async (c) => {
    const db = c.get('db');
    const token = c.req.param('token');
    const eventId = c.req.param('eventId');
    const input = c.req.valid('json');

    const [link] = await db
      .select({ id: shareLinks.id, expiresAt: shareLinks.expiresAt, projectLinkId: shareLinks.projectLinkId })
      .from(shareLinks)
      .where(and(eq(shareLinks.token, token), notBlocked(shareLinks.createdById)))
      .limit(1);
    if (!link) return c.json({ error: 'Not found' }, 404);
    if (link.expiresAt && link.expiresAt < new Date()) return c.json({ error: 'Expired' }, 410);
    if (!(await listenUpdatesPerIp.hit(db, clientIp(c)))) return tooManyRequests(c);

    const [event] = await db
      .select()
      .from(listenEvents)
      .where(and(eq(listenEvents.id, eventId), eq(listenEvents.shareLinkId, link.id)))
      .limit(1);
    if (!event) return c.json({ error: 'Not found' }, 404);

    const isFirstPlay = input.firstPlay && !event.firstPlayAt;

    await db
      .update(listenEvents)
      .set({
        ...(input.listenerName !== undefined ? { listenerName: input.listenerName } : {}),
        ...(isFirstPlay ? { firstPlayAt: new Date() } : {}),
        ...(input.listenSeconds !== undefined ? { listenSeconds: input.listenSeconds } : {}),
        ...(input.completed !== undefined ? { completed: input.completed } : {}),
      })
      .where(eq(listenEvents.id, eventId));

    // Someone going through a project link means one alert, not one per track
    if (isFirstPlay && (await listenAlerts.hit(db, link.projectLinkId ?? link.id))) {
      // Fire-and-forget: alert link creator by email
      runInBackground(Promise.resolve().then(async () => {
        try {
          const [fullLink] = await db
            .select({ createdById: shareLinks.createdById, versionId: shareLinks.versionId })
            .from(shareLinks)
            .where(eq(shareLinks.id, link.id))
            .limit(1);
          if (!fullLink) return;

          const [creator] = await db
            .select({ email: users.email, name: users.name, locale: users.locale })
            .from(users)
            .where(eq(users.id, fullLink.createdById))
            .limit(1);
          if (!creator) return;

          const [version] = await db.select().from(versions).where(eq(versions.id, fullLink.versionId)).limit(1);
          const [track] = version ? await db.select().from(tracks).where(eq(tracks.id, version.trackId)).limit(1) : [null];
          const [project] = track ? await db.select().from(projects).where(eq(projects.id, track.projectId)).limit(1) : [null];
          if (!track || !project) return;

          const listenerName = input.listenerName ?? event.listenerName;
          const trackUrl = `${process.env.APP_URL}/projects/${track.projectId}/tracks/${track.id}`;
          await sendListenAlertEmail(creator.email, listenerName ?? null, track.name, project.name, trackUrl, pickLocale(creator.locale));
        } catch { /* non-critical */ }
      }));
    }

    return c.json({ ok: true });
  })

  // --- Analytics (authenticated) ---
  .get('/version/:versionId/analytics', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('versionId');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track, membership } = found;
    if (!membership) return c.json({ error: 'Forbidden' }, 403);

    const links = await db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(eq(shareLinks.versionId, versionId));

    if (links.length === 0) return c.json({ totalOpens: 0, totalPlays: 0, uniqueListeners: 0, avgListenSeconds: 0, completionRate: 0, events: [] });

    const linkIds = links.map((l) => l.id);

    const events = await db
      .select()
      .from(listenEvents)
      .where(inArray(listenEvents.shareLinkId, linkIds))
      .orderBy(desc(listenEvents.openedAt));

    const totalOpens = events.length;
    const played = events.filter((e) => e.firstPlayAt !== null);
    const totalPlays = played.length;
    const uniqueListeners = new Set(events.map((e) => e.ipHash)).size;
    const avgListenSeconds = played.length > 0
      ? Math.round(played.reduce((s, e) => s + e.listenSeconds, 0) / played.length)
      : 0;
    const completionRate = totalPlays > 0
      ? Math.round((events.filter((e) => e.completed).length / totalPlays) * 100)
      : 0;

    return c.json({
      totalOpens,
      totalPlays,
      uniqueListeners,
      avgListenSeconds,
      completionRate,
      events: events.map((e) => ({
        id: e.id,
        listenerName: e.listenerName,
        openedAt: e.openedAt,
        firstPlayAt: e.firstPlayAt,
        listenSeconds: e.listenSeconds,
        completed: e.completed,
      })),
    });
  });
