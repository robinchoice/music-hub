import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  createDeliverySchema,
  DELIVERY_ERRORS,
  giftRoundSchema,
  updateDeliverySchema,
  type DeliveryErrorCode,
} from '@music-hub/shared';
import { deliveries, deliveryTracks, openTracks, payments, projectShareLinks, shareLinks, tracks, type Database } from '@music-hub/db';
import { generateToken, requireAuth } from '../middleware/auth.js';
import { membershipOf } from '../lib/access.js';
import {
  afterSettled,
  deliveryForOwner,
  deliveryOfProjectLink,
  expireOpenPayments,
  expirePendingPayments,
  lockDelivery,
  markPaid,
  mayCreateDeliveries,
  settleIfCovered,
  studioDeliveryOf,
} from '../lib/deliveries.js';
import { ownProjectLink, trackLinkSettings } from './share.js';
import type { AppEnv } from '../types.js';
import { locale } from '../lib/i18n.js';

// The studio's side of a delivery (Auftrag) on its project link. Any owner of the project manages it;
// creating one needs the Solo plan (or an admin address). The client's side is in routes/share.ts.

type ProjectLink = typeof projectShareLinks.$inferSelect;

const deliveryError = <S extends 400 | 403 | 404 | 409>(c: Context<AppEnv>, code: DeliveryErrorCode, status: S) =>
  c.json({ error: DELIVERY_ERRORS[locale(c)][code], code }, status);

const isUuid = (value: string) => z.string().uuid().safeParse(value).success;

// The delivery for an owner of its project, or the answer for everyone else
async function ownedDelivery(c: Context<AppEnv>) {
  const deliveryId = c.req.param('deliveryId') ?? '';
  if (!isUuid(deliveryId)) return c.json({ error: 'Not found' }, 404);
  const found = await deliveryForOwner(c.get('db'), deliveryId, c.get('userId'));
  if (found === 'not_found') return c.json({ error: 'Not found' }, 404);
  if (found === 'forbidden') return c.json({ error: 'Forbidden' }, 403);
  return found;
}

// Why the songs can't make a delivery, null when they can: each once, in the project, not in the
// trash and, if the link has a selection, in it. Open tracks (/offen) hand out their original and
// stems to anyone, so no paywall could hold them.
async function invalidTracks(db: Database, projectId: string, link: ProjectLink | undefined, list: { trackId: string }[]) {
  const ids = list.map((t) => t.trackId);
  if (new Set(ids).size !== ids.length) return 'track_invalid' as const;
  if (link?.trackIds && ids.some((id) => !link.trackIds!.includes(id))) return 'track_invalid' as const;
  const found = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(and(inArray(tracks.id, ids), eq(tracks.projectId, projectId), isNull(tracks.deletedAt)));
  if (found.length !== ids.length) return 'track_invalid' as const;
  const open = await db.select({ id: openTracks.trackId }).from(openTracks).where(inArray(openTracks.trackId, ids)).limit(1);
  return open.length ? ('track_open' as const) : null;
}

async function studioView(db: Database, deliveryId: string, link: ProjectLink) {
  const [delivery] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId)).limit(1);
  return { delivery: await studioDeliveryOf(db, delivery!, link) };
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// Re-read under the lock: the client may have changed it since the route loaded it
async function lockedOpen(tx: Tx, deliveryId: string) {
  await lockDelivery(tx, deliveryId);
  const [row] = await tx.select().from(deliveries).where(eq(deliveries.id, deliveryId)).limit(1);
  return row?.status === 'open' ? row : undefined;
}

export const deliveryRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // All deliveries of the project, newest first, cancelled ones included
  .get('/project/:projectId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');
    if (!isUuid(projectId)) return c.json({ error: 'Not found' }, 404);
    const membership = await membershipOf(db, projectId, userId);
    if (!membership) return c.json({ error: 'Not found' }, 404);
    if (membership.role !== 'owner') return c.json({ error: 'Forbidden' }, 403);

    const rows = await db
      .select({ delivery: deliveries, link: projectShareLinks })
      .from(deliveries)
      .innerJoin(projectShareLinks, eq(projectShareLinks.id, deliveries.projectLinkId))
      .where(eq(deliveries.projectId, projectId))
      .orderBy(desc(deliveries.createdAt));
    return c.json({
      deliveries: await Promise.all(rows.map((r) => studioDeliveryOf(db, r.delivery, r.link))),
      canCreate: await mayCreateDeliveries(db, userId),
    });
  })

  // A delivery on the owner's own project link, made like POST /share/project/:projectId if there is
  // none yet. The link takes comments, the client needs them. A cancelled delivery on it gives way.
  .post('/project/:projectId', zValidator('json', createDeliverySchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('projectId');
    const input = c.req.valid('json');
    if (!isUuid(projectId)) return c.json({ error: 'Not found' }, 404);
    const membership = await membershipOf(db, projectId, userId);
    if (!membership) return c.json({ error: 'Not found' }, 404);
    if (membership.role !== 'owner') return c.json({ error: 'Forbidden' }, 403);
    if (!(await mayCreateDeliveries(db, userId))) return deliveryError(c, 'plan_required', 403);

    const existingLink = await ownProjectLink(db, projectId, userId);
    const invalid = await invalidTracks(db, projectId, existingLink, input.tracks);
    if (invalid) return deliveryError(c, invalid, 400);

    const created = await db.transaction(async (tx) => {
      let link: ProjectLink;
      if (existingLink) {
        // Checked before touching the link, so a refused create leaves it as it was
        await lockDelivery(tx, `link:${existingLink.id}`);
        const previous = await deliveryOfProjectLink(tx, existingLink.id);
        if (previous && previous.status !== 'cancelled') return null;
        const [row] = await tx
          .update(projectShareLinks)
          .set({ allowComments: true })
          .where(eq(projectShareLinks.id, existingLink.id))
          .returning();
        link = row!;
        await tx.update(shareLinks).set(trackLinkSettings(link)).where(eq(shareLinks.projectLinkId, link.id));
      } else {
        const [row] = await tx
          .insert(projectShareLinks)
          .values({ projectId, token: generateToken(), createdById: userId, allowComments: true, allowDownload: false, follows: 'latest' })
          .returning();
        link = row!;
      }

      await lockDelivery(tx, `link:${link.id}`);
      const previous = await deliveryOfProjectLink(tx, link.id);
      if (previous && previous.status !== 'cancelled') return null;
      if (previous) await tx.delete(deliveries).where(eq(deliveries.id, previous.id));

      const [delivery] = await tx
        .insert(deliveries)
        .values({
          projectLinkId: link.id,
          projectId,
          createdById: userId,
          clientName: input.clientName,
          clientEmail: input.clientEmail ?? null,
          reference: input.reference || null,
          ...(input.includedRounds !== undefined ? { includedRounds: input.includedRounds } : {}),
          ...(input.extraRoundCents !== undefined ? { extraRoundCents: input.extraRoundCents } : {}),
          ...(input.includeStems !== undefined ? { includeStems: input.includeStems } : {}),
        })
        .returning();
      await tx
        .insert(deliveryTracks)
        .values(input.tracks.map((t) => ({ deliveryId: delivery!.id, trackId: t.trackId, priceCents: t.priceCents })));
      return { delivery: delivery!, link };
    });
    if (!created) return deliveryError(c, 'delivery_exists', 409);
    return c.json({ delivery: await studioDeliveryOf(db, created.delivery, created.link) }, 201);
  })

  .get('/:deliveryId', async (c) => {
    const found = await ownedDelivery(c);
    if (found instanceof Response) return found;
    return c.json({ delivery: await studioDeliveryOf(c.get('db'), found.delivery, found.link) });
  })

  // While open. tracks is the full list: songs not in it leave the delivery, their rounds stay stored
  // but no longer count. A pending payment expires, its total may no longer be right; an announced
  // transfer stays for the studio to confirm. With nothing left to pay it is paid.
  .patch('/:deliveryId', zValidator('json', updateDeliverySchema), async (c) => {
    const db = c.get('db');
    const input = c.req.valid('json');
    const found = await ownedDelivery(c);
    if (found instanceof Response) return found;
    const { delivery, link } = found;
    if (delivery.status !== 'open') return deliveryError(c, 'not_open', 409);
    const invalid = input.tracks ? await invalidTracks(db, delivery.projectId, link, input.tracks) : null;
    if (invalid) return deliveryError(c, invalid, 400);

    const set: Partial<typeof deliveries.$inferInsert> = { updatedAt: new Date() };
    if (input.clientName !== undefined) set.clientName = input.clientName;
    if (input.clientEmail !== undefined) set.clientEmail = input.clientEmail;
    if (input.reference !== undefined) set.reference = input.reference || null;
    if (input.includedRounds !== undefined) set.includedRounds = input.includedRounds;
    if (input.extraRoundCents !== undefined) set.extraRoundCents = input.extraRoundCents;
    if (input.includeStems !== undefined) set.includeStems = input.includeStems;

    const updated = await db.transaction(async (tx) => {
      if (!(await lockedOpen(tx, delivery.id))) return false;
      await tx.update(deliveries).set(set).where(eq(deliveries.id, delivery.id));
      if (input.tracks) {
        const ids = input.tracks.map((t) => t.trackId);
        await tx.delete(deliveryTracks).where(and(eq(deliveryTracks.deliveryId, delivery.id), notInArray(deliveryTracks.trackId, ids)));
        // Songs that stay keep their gifted rounds and approval
        await tx
          .insert(deliveryTracks)
          .values(input.tracks.map((t) => ({ deliveryId: delivery.id, trackId: t.trackId, priceCents: t.priceCents })))
          .onConflictDoUpdate({
            target: [deliveryTracks.deliveryId, deliveryTracks.trackId],
            set: { priceCents: sql`excluded.price_cents` },
          });
      }
      await expirePendingPayments(tx, delivery.id);
      return { settled: await settleIfCovered(tx, delivery.id) };
    });
    if (!updated) return deliveryError(c, 'not_open', 409);
    afterSettled(db, updated.settled);
    return c.json(await studioView(db, delivery.id, link));
  })

  // Ends an open delivery; the link plays and downloads as its settings say again
  .post('/:deliveryId/cancel', async (c) => {
    const db = c.get('db');
    const found = await ownedDelivery(c);
    if (found instanceof Response) return found;
    const cancelled = await db.transaction(async (tx) => {
      if (!(await lockedOpen(tx, found.delivery.id))) return false;
      await tx.update(deliveries).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(deliveries.id, found.delivery.id));
      await expireOpenPayments(tx, found.delivery.id);
      return true;
    });
    if (!cancelled) return deliveryError(c, 'not_open', 409);
    return c.json(await studioView(db, found.delivery.id, found.link));
  })

  // Free rounds on top for one song; rounds asked for before keep their extra flag
  .post('/:deliveryId/tracks/:trackId/gift', zValidator('json', giftRoundSchema), async (c) => {
    const db = c.get('db');
    const { rounds } = c.req.valid('json');
    const found = await ownedDelivery(c);
    if (found instanceof Response) return found;
    const trackId = c.req.param('trackId');
    if (!isUuid(trackId)) return deliveryError(c, 'track_invalid', 404);
    if (found.delivery.status !== 'open') return deliveryError(c, 'not_open', 409);

    const outcome = await db.transaction(async (tx) => {
      if (!(await lockedOpen(tx, found.delivery.id))) return 'not_open' as const;
      const rows = await tx
        .update(deliveryTracks)
        .set({ giftedRounds: sql`${deliveryTracks.giftedRounds} + ${rounds ?? 1}` })
        .where(and(eq(deliveryTracks.deliveryId, found.delivery.id), eq(deliveryTracks.trackId, trackId)))
        .returning({ trackId: deliveryTracks.trackId });
      if (rows.length === 0) return 'track_invalid' as const;
      await tx.update(deliveries).set({ updatedAt: new Date() }).where(eq(deliveries.id, found.delivery.id));
      return 'ok' as const;
    });
    if (outcome === 'not_open') return deliveryError(c, 'not_open', 409);
    if (outcome === 'track_invalid') return deliveryError(c, 'track_invalid', 404);
    return c.json(await studioView(db, found.delivery.id, found.link));
  })

  // The money of a payment arrived: a transfer on the studio's account, or a Lightning payment its wallet
  // got while nobody looked it up. Also for an expired payment, money can come after a replacement.
  // Once the payments cover the total, the delivery is paid and the downloads open.
  .post('/:deliveryId/payments/:paymentId/confirm', async (c) => {
    const db = c.get('db');
    const found = await ownedDelivery(c);
    if (found instanceof Response) return found;
    const paymentId = c.req.param('paymentId');
    if (!isUuid(paymentId)) return c.json({ error: 'Not found' }, 404);
    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.deliveryId, found.delivery.id)))
      .limit(1);
    if (!payment) return c.json({ error: 'Not found' }, 404);
    if (!(await markPaid(db, payment.id, c.get('userId')))) return deliveryError(c, 'payment_closed', 409);
    return c.json(await studioView(db, found.delivery.id, found.link));
  });
