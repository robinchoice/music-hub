import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, ne, sql, sum } from 'drizzle-orm';
import {
  deliveries,
  deliveryRounds,
  deliveryTracks,
  paymentAccounts,
  payments,
  projects,
  projectShareLinks,
  shareLinks,
  stems,
  tracks,
  users,
  versions,
  type Database,
} from '@music-hub/db';
import {
  DELIVERY_ERRORS,
  formatEuro,
  type DeliveryErrorCode,
  type DeliveryErrorResponse,
  type DeliveryStatus,
  type DeliveryTotals,
  type DeliveryTrackState,
  type PaymentMethod,
  type PaymentStatus,
  type PublicDelivery,
  type PublicPayment,
  type StudioDelivery,
  type StudioDeliveryTrack,
} from '@music-hub/shared';
import { membershipOf } from './access.js';
import { isAdminEmail } from './admin.js';
import { runInBackground } from './background.js';
import { submitReview } from './reviews.js';
import { newestVersionId } from './shown-version.js';
import { liveVersion } from './trash.js';
import { epcPayload } from './payments/girocode.js';
import { connectNwc } from './payments/nwc.js';
import { decryptSecret, paymentsConfigured } from './payments/secrets.js';
import { sendDeliveryPaidEmail } from '../services/email.js';
import { activePlan, type Locale, pickLocale } from '@music-hub/shared';

// The order logic of a delivery (Auftrag) on a project link: rounds, approvals, totals and payment
// state. Routes check the link (token, password, expiry) and rate limits; everything that decides
// money or downloads lives here.

export type Delivery = typeof deliveries.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentAccountRow = typeof paymentAccounts.$inferSelect;
export type DeliveryRound = typeof deliveryRounds.$inferSelect;
type ProjectLink = typeof projectShareLinks.$inferSelect;
type Reader = Pick<Database, 'select'>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// What a refused action answers: the route sends failureBody(result) with result.status
export type DeliveryFailure = { ok: false; status: 403 | 404 | 409 | 410; code: DeliveryErrorCode; extraRoundCents?: number };

const fail = (status: DeliveryFailure['status'], code: DeliveryErrorCode, extraRoundCents?: number): DeliveryFailure =>
  extraRoundCents === undefined ? { ok: false, status, code } : { ok: false, status, code, extraRoundCents };

export const failureBody = (f: DeliveryFailure, locale: Locale): DeliveryErrorResponse =>
  f.extraRoundCents === undefined
    ? { error: DELIVERY_ERRORS[locale][f.code], code: f.code }
    : { error: DELIVERY_ERRORS[locale][f.code], code: f.code, extraRoundCents: f.extraRoundCents };

const OPEN_PAYMENT = ['pending', 'announced'] as const;

// Rounds, approvals and payments of one delivery change one after the other
export const lockDelivery = (tx: Tx, deliveryId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`delivery:${deliveryId}`}))`);

// ---------- Plans ----------

// Only paying studios and admins (ADMIN_EMAILS) create deliveries
export async function mayCreateDeliveries(db: Reader, userId: string) {
  const [user] = await db
    .select({ email: users.email, plan: users.plan, planUntil: users.planUntil })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return !!user && (activePlan(user) === 'solo' || isAdminEmail(user.email));
}

// ---------- Loading ----------

// The delivery of a project link in any status
export async function deliveryOfProjectLink(db: Reader, projectLinkId: string) {
  const [row] = await db.select().from(deliveries).where(eq(deliveries.projectLinkId, projectLinkId)).limit(1);
  return row;
}

// The delivery that puts a paywall on a project link: open or paid, not cancelled
export async function activeDeliveryOfProjectLink(db: Reader, projectLinkId: string) {
  const [row] = await db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.projectLinkId, projectLinkId), ne(deliveries.status, 'cancelled')))
    .limit(1);
  return row;
}

// The paywall of a track's share link: the delivery of its project link unless cancelled.
// undefined for links outside a project link and for project links without one.
export async function deliveryOfShareLink(db: Reader, shareLinkId: string) {
  const [row] = await db
    .select({ delivery: deliveries })
    .from(shareLinks)
    .innerJoin(deliveries, eq(deliveries.projectLinkId, shareLinks.projectLinkId))
    .where(and(eq(shareLinks.id, shareLinkId), ne(deliveries.status, 'cancelled')))
    .limit(1);
  return row?.delivery;
}

// A delivery with its project link for the studio: any owner of the project manages it.
// 'not_found' for people outside the project (reads answer 404), 'forbidden' for members who aren't owner (403).
export async function deliveryForOwner(db: Reader, deliveryId: string, userId: string) {
  const [row] = await db
    .select({ delivery: deliveries, link: projectShareLinks })
    .from(deliveries)
    .innerJoin(projectShareLinks, eq(projectShareLinks.id, deliveries.projectLinkId))
    .where(eq(deliveries.id, deliveryId))
    .limit(1);
  if (!row) return 'not_found' as const;
  const membership = await membershipOf(db, row.delivery.projectId, userId);
  if (!membership) return 'not_found' as const;
  if (membership.role !== 'owner') return 'forbidden' as const;
  return row;
}

export async function paymentAccountOf(db: Reader, userId: string) {
  const [row] = await db.select().from(paymentAccounts).where(eq(paymentAccounts.userId, userId)).limit(1);
  return row;
}

// Which ways to pay the studio offers: a connected wallet (and a key to read it), a complete bank account
export function methodsOf(account: PaymentAccountRow | undefined) {
  return {
    lightning: !!account?.nwcSecretEnc && paymentsConfigured(),
    transfer: !!account?.iban && !!account.accountHolder,
  };
}

// Verwendungszweck of a transfer
export const remittanceOf = (delivery: Pick<Delivery, 'id' | 'reference'>) => delivery.reference ?? `MH-${delivery.id.slice(0, 8)}`;

// Description of a Lightning invoice
export const invoiceDescription = (delivery: Pick<Delivery, 'reference'>, projectName: string) =>
  `${delivery.reference ?? projectName} · Music Hub`;

// ---------- Rounds and totals ----------

export type TrackState = Omit<StudioDeliveryTrack, 'approvedAt'> & { approvedAt: Date | null };
export type DeliveryState = { tracks: TrackState[]; rounds: DeliveryRound[]; totals: DeliveryTotals; payable: boolean };

export function totalsOf(
  list: { priceCents: number; extraRounds: number; extraCents: number; state: DeliveryTrackState }[],
  extraRoundCents: number,
  paidCents: number,
): DeliveryTotals {
  const songsCents = list.reduce((total, t) => total + t.priceCents, 0);
  const extraCents = list.reduce((total, t) => total + t.extraCents, 0);
  const totalCents = songsCents + extraCents;
  return {
    songsCents,
    extraRounds: list.reduce((total, t) => total + t.extraRounds, 0),
    extraRoundCents,
    extraCents,
    totalCents,
    paidCents,
    dueCents: Math.max(0, totalCents - paidCents),
    approvedCount: list.filter((t) => t.state === 'approved').length,
    trackCount: list.length,
  };
}

const allApproved = (delivery: Pick<Delivery, 'status'>, totals: DeliveryTotals) =>
  delivery.status === 'open' && totals.trackCount > 0 && totals.approvedCount === totals.trackCount;

// Paying is possible once the delivery is open, every one of its songs is approved and something is due
export const isPayable = (delivery: Pick<Delivery, 'status'>, totals: DeliveryTotals) =>
  allApproved(delivery, totals) && totals.dueCents > 0;

// Everything approved and nothing left to pay (a free delivery, or earlier payments cover it): paid
export const isCovered = (delivery: Pick<Delivery, 'status'>, totals: DeliveryTotals) =>
  allApproved(delivery, totals) && totals.dueCents === 0;

// Every song of the delivery with its rounds, shown version and state, in the project's order.
// Songs in the trash leave it until they are restored. `follows` is the project link's.
export async function deliveryState(db: Reader, delivery: Delivery, follows: string): Promise<DeliveryState> {
  const rows = await db
    .select({ dt: deliveryTracks, name: tracks.name })
    .from(deliveryTracks)
    .innerJoin(tracks, eq(tracks.id, deliveryTracks.trackId))
    .where(and(eq(deliveryTracks.deliveryId, delivery.id), isNull(tracks.deletedAt)))
    .orderBy(asc(tracks.sortOrder), asc(tracks.createdAt));
  const rounds = await db
    .select()
    .from(deliveryRounds)
    .where(eq(deliveryRounds.deliveryId, delivery.id))
    .orderBy(asc(deliveryRounds.createdAt));
  const [paid] = await db
    .select({ cents: sum(payments.amountCents).mapWith(Number) })
    .from(payments)
    .where(and(eq(payments.deliveryId, delivery.id), eq(payments.status, 'paid')));
  const trackIds = rows.map((r) => r.dt.trackId);

  const shownOf = new Map<string, string | null>();
  for (const id of trackIds) shownOf.set(id, await newestVersionId(db, id, follows));
  const versionIds = [
    ...new Set([...shownOf.values(), ...rows.map((r) => r.dt.approvedVersionId)].filter((id): id is string => id !== null)),
  ];
  const liveVersions = versionIds.length
    ? await db
        .select({ id: versions.id, versionNumber: versions.versionNumber })
        .from(versions)
        .where(and(inArray(versions.id, versionIds), isNull(versions.deletedAt)))
    : [];
  const numberOf = new Map(liveVersions.map((v) => [v.id, v.versionNumber]));

  const stemCounts =
    delivery.includeStems && trackIds.length
      ? await db
          .select({ trackId: stems.trackId, n: count() })
          .from(stems)
          .where(and(inArray(stems.trackId, trackIds), isNull(stems.deletedAt)))
          .groupBy(stems.trackId)
      : [];
  const stemsOf = new Map(stemCounts.map((s) => [s.trackId, s.n]));

  const list: TrackState[] = rows.map(({ dt, name }) => {
    const own = rounds.filter((r) => r.trackId === dt.trackId);
    const extras = own.filter((r) => r.extra);
    const shownVersionId = shownOf.get(dt.trackId) ?? null;
    // An approval only holds while its version is there to download
    const approved = dt.approvedVersionId !== null && numberOf.has(dt.approvedVersionId);
    const roundsIncluded = delivery.includedRounds + dt.giftedRounds;
    const state: DeliveryTrackState = approved
      ? 'approved'
      : !shownVersionId || own.some((r) => r.versionId === shownVersionId)
        ? 'changes'
        : 'review';
    return {
      trackId: dt.trackId,
      name,
      priceCents: dt.priceCents,
      roundsUsed: own.length,
      roundsIncluded,
      giftedRounds: dt.giftedRounds,
      extraRounds: extras.length,
      extraCents: extras.reduce((total, r) => total + r.priceCents, 0),
      nextRoundExtra: own.length >= roundsIncluded,
      shownVersionId,
      shownVersionNumber: shownVersionId ? (numberOf.get(shownVersionId) ?? null) : null,
      approvedVersionId: approved ? dt.approvedVersionId : null,
      approvedByName: approved ? dt.approvedByName : null,
      approvedAt: approved ? dt.approvedAt : null,
      state,
      hasStems: (stemsOf.get(dt.trackId) ?? 0) > 0,
    };
  });
  const totals = totalsOf(list, delivery.extraRoundCents, paid?.cents ?? 0);
  const inDelivery = new Set(trackIds);
  return {
    tracks: list,
    rounds: rounds.filter((r) => inDelivery.has(r.trackId)),
    totals,
    payable: isPayable(delivery, totals),
  };
}

// The version the client heard must be the one the track's link shows now, in an open delivery,
// while the link's creator is still in the (not archived) project
async function heardTarget(db: Database, delivery: Delivery, link: ProjectLink, trackId: string, versionId: string) {
  if (delivery.status !== 'open') return fail(409, 'not_open');
  const [dt] = await db
    .select()
    .from(deliveryTracks)
    .where(and(eq(deliveryTracks.deliveryId, delivery.id), eq(deliveryTracks.trackId, trackId)))
    .limit(1);
  if (!dt) return fail(404, 'track_invalid');
  const shown = await newestVersionId(db, trackId, link.follows);
  if (!shown) return fail(410, 'unavailable');
  if (shown !== versionId) return fail(409, 'moved_on');
  const found = await liveVersion(db, shown);
  if (!found || found.track.projectId !== delivery.projectId) return fail(410, 'unavailable');
  const membership = await membershipOf(db, delivery.projectId, link.createdById);
  if (!membership?.canComment) return fail(410, 'unavailable');
  return { ok: true as const, ...found };
}

// Re-read under the lock: the delivery may have changed since the route loaded it
async function openDelivery(tx: Tx, deliveryId: string) {
  const [row] = await tx.select().from(deliveries).where(eq(deliveries.id, deliveryId)).limit(1);
  return row?.status === 'open' ? row : undefined;
}

// Payments still open become expired: all of them before a new one starts or when the delivery ends.
// An expired payment that arrives anyway is still recorded, see markPaid.
export async function expireOpenPayments(tx: Tx, deliveryId: string) {
  await tx
    .update(payments)
    .set({ status: 'expired' })
    .where(and(eq(payments.deliveryId, deliveryId), inArray(payments.status, OPEN_PAYMENT)));
}

// When a round or a change moves the total, only pending payments expire. An announced transfer may
// already be on its way: it stays open for the studio to confirm and then counts towards the total.
export async function expirePendingPayments(tx: Tx, deliveryId: string) {
  await tx
    .update(payments)
    .set({ status: 'expired' })
    .where(and(eq(payments.deliveryId, deliveryId), eq(payments.status, 'pending')));
}

export type Settled = { delivery: Delivery; paidCents: number };

// Under the delivery's lock: an open delivery whose songs are all approved and whose payments cover
// the total becomes paid, e.g. a free one on its last approval. Payments still open expire.
// undefined when nothing changed.
export async function settleIfCovered(tx: Tx, deliveryId: string): Promise<Settled | undefined> {
  const [row] = await tx
    .select({ delivery: deliveries, follows: projectShareLinks.follows })
    .from(deliveries)
    .innerJoin(projectShareLinks, eq(projectShareLinks.id, deliveries.projectLinkId))
    .where(eq(deliveries.id, deliveryId))
    .limit(1);
  if (!row) return undefined;
  const { totals } = await deliveryState(tx, row.delivery, row.follows);
  if (!isCovered(row.delivery, totals)) return undefined;
  const now = new Date();
  const [delivery] = await tx
    .update(deliveries)
    .set({ status: 'paid', paidAt: now, updatedAt: now })
    .where(eq(deliveries.id, deliveryId))
    .returning();
  await expireOpenPayments(tx, deliveryId);
  return { delivery: delivery!, paidCents: totals.paidCents };
}

// After the transaction that settled a delivery: the client gets a mail if they left an address and paid
export function afterSettled(db: Database, settled: Settled | undefined) {
  if (!settled?.delivery.clientEmail || settled.paidCents === 0) return;
  runInBackground(
    mailPaid(db, settled.delivery, settled.paidCents).catch((err) => console.error('[Deliveries] Paid mail failed:', err)),
  );
}

// "Änderungen anfordern" on the version the client heard: one round per version. Beyond the included
// and gifted rounds it is an extra round, which needs confirmExtra and the price the client saw; the
// round keeps that price. A round on an approved song takes the approval back; a pending payment
// expires. The guest review with verdict 'changes' reaches the uploader like any guest "Fertig" and
// closes the client's comments as one pass.
export async function requestRound(
  db: Database,
  input: {
    delivery: Delivery;
    link: ProjectLink;
    trackId: string;
    versionId: string;
    guestName: string;
    note?: string | undefined;
    confirmExtra?: boolean | undefined;
    extraRoundCents?: number | undefined;
  },
): Promise<{ ok: true; round: DeliveryRound; extra: boolean } | DeliveryFailure> {
  const target = await heardTarget(db, input.delivery, input.link, input.trackId, input.versionId);
  if (!target.ok) return target;

  const outcome = await db.transaction(async (tx): Promise<{ ok: true; round: DeliveryRound; extra: boolean } | DeliveryFailure> => {
    await lockDelivery(tx, input.delivery.id);
    const delivery = await openDelivery(tx, input.delivery.id);
    if (!delivery) return fail(409, 'not_open');
    const [dt] = await tx
      .select()
      .from(deliveryTracks)
      .where(and(eq(deliveryTracks.deliveryId, delivery.id), eq(deliveryTracks.trackId, input.trackId)))
      .limit(1);
    if (!dt) return fail(404, 'track_invalid');
    const existing = await tx
      .select({ versionId: deliveryRounds.versionId })
      .from(deliveryRounds)
      .where(and(eq(deliveryRounds.deliveryId, delivery.id), eq(deliveryRounds.trackId, input.trackId)));
    if (existing.some((r) => r.versionId === input.versionId)) return fail(409, 'round_exists');
    const extra = existing.length >= delivery.includedRounds + dt.giftedRounds;
    // The client confirms a price; if the studio changed it since, they confirm the new one
    if (extra && (input.confirmExtra !== true || input.extraRoundCents !== delivery.extraRoundCents)) {
      return fail(409, 'extra_round', delivery.extraRoundCents);
    }

    const [round] = await tx
      .insert(deliveryRounds)
      .values({
        deliveryId: delivery.id,
        trackId: input.trackId,
        versionId: input.versionId,
        versionNumber: target.version.versionNumber,
        guestName: input.guestName,
        extra,
        priceCents: extra ? delivery.extraRoundCents : 0,
      })
      .returning();
    if (dt.approvedVersionId) {
      await tx
        .update(deliveryTracks)
        .set({ approvedVersionId: null, approvedAt: null, approvedByName: null })
        .where(and(eq(deliveryTracks.deliveryId, delivery.id), eq(deliveryTracks.trackId, input.trackId)));
    }
    await expirePendingPayments(tx, delivery.id);
    await tx.update(deliveries).set({ updatedAt: new Date() }).where(eq(deliveries.id, delivery.id));
    return { ok: true, round: round!, extra };
  });
  if (!outcome.ok) return outcome;

  const review = await submitReview(db, {
    version: target.version,
    track: target.track,
    author: { guestName: input.guestName },
    authorName: input.guestName,
    verdict: 'changes',
    note: input.note ?? null,
    canApprove: false,
  });
  await db.update(deliveryRounds).set({ reviewId: review.id }).where(eq(deliveryRounds.id, outcome.round.id));
  return { ...outcome, round: { ...outcome.round, reviewId: review.id } };
}

// "Freigeben" of the version the client heard. Approving the same version again changes nothing.
// A guest review with verdict 'approve' tells the uploader; the version's own status stays as it is.
// The last approval of a delivery with nothing due makes it paid.
export async function approveTrack(
  db: Database,
  input: { delivery: Delivery; link: ProjectLink; trackId: string; versionId: string; guestName: string; note?: string | undefined },
): Promise<{ ok: true; changed: boolean } | DeliveryFailure> {
  const target = await heardTarget(db, input.delivery, input.link, input.trackId, input.versionId);
  if (!target.ok) return target;

  const outcome = await db.transaction(async (tx): Promise<{ ok: true; changed: boolean; settled?: Settled | undefined } | DeliveryFailure> => {
    await lockDelivery(tx, input.delivery.id);
    const delivery = await openDelivery(tx, input.delivery.id);
    if (!delivery) return fail(409, 'not_open');
    const [dt] = await tx
      .select()
      .from(deliveryTracks)
      .where(and(eq(deliveryTracks.deliveryId, delivery.id), eq(deliveryTracks.trackId, input.trackId)))
      .limit(1);
    if (!dt) return fail(404, 'track_invalid');
    if (dt.approvedVersionId === input.versionId) return { ok: true, changed: false };
    await tx
      .update(deliveryTracks)
      .set({ approvedVersionId: input.versionId, approvedAt: new Date(), approvedByName: input.guestName })
      .where(and(eq(deliveryTracks.deliveryId, delivery.id), eq(deliveryTracks.trackId, input.trackId)));
    await tx.update(deliveries).set({ updatedAt: new Date() }).where(eq(deliveries.id, delivery.id));
    return { ok: true, changed: true, settled: await settleIfCovered(tx, delivery.id) };
  });
  if (!outcome.ok || !outcome.changed) return outcome.ok ? { ok: true, changed: false } : outcome;
  afterSettled(db, outcome.settled);

  await submitReview(db, {
    version: target.version,
    track: target.track,
    author: { guestName: input.guestName },
    authorName: input.guestName,
    verdict: 'approve',
    note: input.note ?? null,
    canApprove: false,
  });
  return { ok: true, changed: true };
}

// ---------- Payments ----------

// A Lightning invoice handed out again has to stay valid at least this long
const REUSE_MIN_MS = 60_000;

// The open payment to hand out again instead of starting a new one: same method and amount, and for
// Lightning an invoice that is still valid for a while. Two tabs then get the same invoice instead of
// two that could both be paid.
export async function reusablePayment(db: Reader, deliveryId: string, method: PaymentMethod, amountCents: number) {
  const [open] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.deliveryId, deliveryId), inArray(payments.status, OPEN_PAYMENT)))
    .limit(1);
  if (!open || open.method !== method || open.amountCents !== amountCents) return undefined;
  if (method === 'lightning' && (open.status !== 'pending' || !open.expiresAt || open.expiresAt.getTime() < Date.now() + REUSE_MIN_MS)) {
    return undefined;
  }
  return open;
}

// Starts a payment of what is due, expiring the open one before it. null when the delivery is no
// longer payable or what is due is no longer amountCents (a round or a change came in between);
// the route then answers 'not_payable'.
export async function insertPayment(
  db: Database,
  input: {
    delivery: Delivery;
    link: ProjectLink;
    method: PaymentMethod;
    amountCents: number;
    sats?: number | null;
    invoice?: string | null;
    paymentHash?: string | null;
    expiresAt?: Date | null;
  },
) {
  return db.transaction(async (tx) => {
    await lockDelivery(tx, input.delivery.id);
    const delivery = await openDelivery(tx, input.delivery.id);
    if (!delivery) return null;
    const { totals, payable } = await deliveryState(tx, delivery, input.link.follows);
    if (!payable || totals.dueCents !== input.amountCents) return null;
    await expireOpenPayments(tx, delivery.id);
    const [payment] = await tx
      .insert(payments)
      .values({
        deliveryId: delivery.id,
        method: input.method,
        amountCents: input.amountCents,
        sats: input.sats ?? null,
        invoice: input.invoice ?? null,
        paymentHash: input.paymentHash ?? null,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    return payment!;
  });
}

// "Ich habe überwiesen": a pending transfer becomes announced. false for anything else.
export async function announcePayment(db: Database, paymentId: string) {
  const rows = await db
    .update(payments)
    .set({ status: 'announced' })
    .where(and(eq(payments.id, paymentId), eq(payments.method, 'transfer'), eq(payments.status, 'pending')))
    .returning({ id: payments.id });
  return rows.length > 0;
}

// A pending payment that can no longer be paid, e.g. a Lightning invoice past its expiry
export async function expirePayment(db: Database, paymentId: string) {
  const rows = await db
    .update(payments)
    .set({ status: 'expired' })
    .where(and(eq(payments.id, paymentId), eq(payments.status, 'pending')))
    .returning({ id: payments.id });
  return rows.length > 0;
}

// Money arrived for a payment: the wallet settled its invoice, or the studio saw it arrive. It is
// recorded as paid whatever happened since, also when it had expired (a replaced invoice paid late, a
// transfer announced before a round) or the delivery is no longer open: the money is there either way.
// The delivery becomes paid once its payments cover the total and every song is approved; less counts
// towards what is due, more is the studio's to pay back. confirmedById is the studio member who
// confirmed it, null for the wallet. true when this call recorded it.
export async function markPaid(db: Database, paymentId: string, confirmedById: string | null) {
  const [found] = await db.select({ deliveryId: payments.deliveryId }).from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!found) return false;
  const outcome = await db.transaction(async (tx) => {
    await lockDelivery(tx, found.deliveryId);
    const [payment] = await tx
      .update(payments)
      .set({ status: 'paid', paidAt: new Date(), confirmedById })
      .where(and(eq(payments.id, paymentId), ne(payments.status, 'paid')))
      .returning();
    if (!payment) return null;
    return { settled: await settleIfCovered(tx, found.deliveryId) };
  });
  if (!outcome) return false;
  afterSettled(db, outcome.settled);
  return true;
}

// A Lightning invoice can't be taken back. Until LIGHTNING_GRACE_MS after its expiry the studio's
// wallet is asked about it, also after a newer payment replaced it; a settled one is recorded, a
// pending one past its expiry turns expired. Runs on the payment page's poll, before a new payment
// and in the API every 30 seconds for pages that were closed. Without deliveryId it checks all.
export const LIGHTNING_GRACE_MS = 10 * 60_000;

export async function checkLightningPayments(db: Database, deliveryId?: string) {
  const now = new Date();
  const rows = await db
    .select({ payment: payments, secret: paymentAccounts.nwcSecretEnc })
    .from(payments)
    .innerJoin(deliveries, eq(deliveries.id, payments.deliveryId))
    .leftJoin(paymentAccounts, eq(paymentAccounts.userId, deliveries.createdById))
    .where(
      and(
        eq(payments.method, 'lightning'),
        inArray(payments.status, ['pending', 'expired']),
        isNotNull(payments.paymentHash),
        gt(payments.expiresAt, new Date(now.getTime() - LIGHTNING_GRACE_MS)),
        deliveryId === undefined ? undefined : eq(payments.deliveryId, deliveryId),
      ),
    );
  const pastExpiry = (p: Payment) => p.status === 'pending' && !!p.expiresAt && p.expiresAt < now;

  const bySecret = new Map<string, Payment[]>();
  for (const { payment, secret } of rows) {
    // Without a wallet nobody can tell; the studio still marks it paid by hand
    if (!secret) {
      if (pastExpiry(payment)) await expirePayment(db, payment.id);
      continue;
    }
    bySecret.set(secret, [...(bySecret.get(secret) ?? []), payment]);
  }
  for (const [secret, list] of bySecret) {
    try {
      const client = await connectNwc(decryptSecret(secret));
      try {
        for (const payment of list) {
          const lookup = await client.lookupInvoice(payment.paymentHash!);
          if (lookup.settled) await markPaid(db, payment.id, null);
          else if (pastExpiry(payment)) await expirePayment(db, payment.id);
        }
      } finally {
        client.close();
      }
    } catch {
      // Paid or not stays open until the wallet answers again. No details, they may carry the secret.
      console.error('[Deliveries] Invoice lookup failed');
    }
  }
}

async function mailPaid(db: Database, delivery: Delivery, amountCents: number) {
  const [row] = await db
    .select({ projectName: projects.name, studioName: users.name, token: projectShareLinks.token, locale: users.locale })
    .from(projectShareLinks)
    .innerJoin(projects, eq(projects.id, projectShareLinks.projectId))
    .innerJoin(users, eq(users.id, delivery.createdById))
    .where(eq(projectShareLinks.id, delivery.projectLinkId))
    .limit(1);
  if (!row || !delivery.clientEmail) return;
  await sendDeliveryPaidEmail(delivery.clientEmail, {
    studioName: row.studioName,
    projectName: row.projectName,
    albumToken: row.token,
    amount: formatEuro(amountCents, pickLocale(row.locale)),
  }, pickLocale(row.locale));
}

// ---------- Downloads ----------

// What a paid delivery hands out for one song: the original of the approved version and, with
// include_stems, the song's stems. The route still checks the link and its creator's membership.
export async function paidDownload(db: Database, delivery: Delivery, trackId: string) {
  if (delivery.status !== 'paid') return fail(403, 'not_paid');
  const [dt] = await db
    .select()
    .from(deliveryTracks)
    .where(and(eq(deliveryTracks.deliveryId, delivery.id), eq(deliveryTracks.trackId, trackId)))
    .limit(1);
  if (!dt?.approvedVersionId) return fail(404, 'track_invalid');
  const found = await liveVersion(db, dt.approvedVersionId);
  if (!found) return fail(410, 'unavailable');
  const files = delivery.includeStems
    ? await db
        .select({ originalFileName: stems.originalFileName, fileKey: stems.fileKey, fileSize: stems.fileSize })
        .from(stems)
        .where(and(eq(stems.trackId, trackId), isNull(stems.deletedAt)))
        .orderBy(asc(stems.sortOrder), asc(stems.createdAt))
    : [];
  return { ok: true as const, version: found.version, track: found.track, stems: files };
}

// ---------- Views ----------

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function publicPaymentOf(payment: Payment, account: PaymentAccountRow | undefined, delivery: Delivery): PublicPayment {
  const remittance = remittanceOf(delivery);
  // A GiroCode needs an amount; there is no payment without one (insertPayment), so only as a guard
  const transfer =
    payment.method === 'transfer' && account?.iban && account.accountHolder && payment.amountCents >= 1
      ? {
          accountHolder: account.accountHolder,
          iban: account.iban,
          bic: account.bic,
          remittance,
          epcPayload: epcPayload({
            name: account.accountHolder,
            iban: account.iban,
            bic: account.bic,
            amountCents: payment.amountCents,
            remittance,
          }),
        }
      : null;
  return {
    id: payment.id,
    method: payment.method as PaymentMethod,
    status: payment.status as PaymentStatus,
    amountCents: payment.amountCents,
    sats: payment.sats,
    invoice: payment.invoice,
    expiresAt: iso(payment.expiresAt),
    transfer,
    createdAt: payment.createdAt.toISOString(),
    paidAt: iso(payment.paidAt),
  };
}

// The `delivery` field of the project link's guest page, as the delivery is now. One that is covered
// without a payment step (a song went to the trash, so earlier payments now cover it) settles here.
export async function publicDeliveryOf(db: Database, given: Delivery, link: ProjectLink): Promise<PublicDelivery> {
  const current = async () => (await db.select().from(deliveries).where(eq(deliveries.id, given.id)).limit(1))[0]!;
  let delivery = await current();
  let state = await deliveryState(db, delivery, link.follows);
  if (isCovered(delivery, state.totals)) {
    const settled = await db.transaction(async (tx) => {
      await lockDelivery(tx, delivery.id);
      return settleIfCovered(tx, delivery.id);
    });
    afterSettled(db, settled);
    delivery = await current();
    state = await deliveryState(db, delivery, link.follows);
  }
  const [studio] = await db.select({ name: users.name }).from(users).where(eq(users.id, delivery.createdById));
  const account = await paymentAccountOf(db, delivery.createdById);
  const [open] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.deliveryId, delivery.id), inArray(payments.status, OPEN_PAYMENT)))
    .limit(1);
  return {
    id: delivery.id,
    status: delivery.status as DeliveryStatus,
    clientName: delivery.clientName,
    studioName: studio?.name ?? 'Studio',
    reference: delivery.reference,
    includeStems: delivery.includeStems,
    extraRoundCents: delivery.extraRoundCents,
    tracks: state.tracks.map(({ name: _name, shownVersionNumber: _number, approvedAt: _at, ...t }) => t),
    totals: state.totals,
    payable: state.payable,
    methods: methodsOf(account),
    openPayment: open ? publicPaymentOf(open, account, delivery) : null,
    downloads: delivery.status === 'paid',
    paidAt: iso(delivery.paidAt),
  };
}

// The studio's view of a delivery
export async function studioDeliveryOf(db: Database, delivery: Delivery, link: ProjectLink): Promise<StudioDelivery> {
  const state = await deliveryState(db, delivery, link.follows);
  const paymentRows = await db
    .select({ payment: payments, confirmedByName: users.name })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.confirmedById))
    .where(eq(payments.deliveryId, delivery.id))
    .orderBy(desc(payments.createdAt));
  return {
    id: delivery.id,
    projectId: delivery.projectId,
    projectLinkId: delivery.projectLinkId,
    linkToken: link.token,
    createdById: delivery.createdById,
    status: delivery.status as DeliveryStatus,
    clientName: delivery.clientName,
    clientEmail: delivery.clientEmail,
    reference: delivery.reference,
    includedRounds: delivery.includedRounds,
    extraRoundCents: delivery.extraRoundCents,
    includeStems: delivery.includeStems,
    tracks: state.tracks.map((t) => ({ ...t, approvedAt: iso(t.approvedAt) })),
    rounds: state.rounds.map((r) => ({
      id: r.id,
      trackId: r.trackId,
      versionId: r.versionId,
      versionNumber: r.versionNumber,
      guestName: r.guestName,
      extra: r.extra,
      priceCents: r.priceCents,
      createdAt: r.createdAt.toISOString(),
    })),
    payments: paymentRows.map(({ payment, confirmedByName }) => ({
      id: payment.id,
      method: payment.method as PaymentMethod,
      status: payment.status as PaymentStatus,
      amountCents: payment.amountCents,
      sats: payment.sats,
      expiresAt: iso(payment.expiresAt),
      confirmedByName,
      createdAt: payment.createdAt.toISOString(),
      paidAt: iso(payment.paidAt),
    })),
    totals: state.totals,
    payable: state.payable,
    paidAt: iso(delivery.paidAt),
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}
