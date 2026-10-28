import { afterAll, beforeAll, expect, test } from 'bun:test';
import { activePlan } from '@music-hub/shared';
import { and, eq, inArray } from 'drizzle-orm';
import {
  createDb,
  deliveries,
  deliveryRounds,
  deliveryTracks,
  migrateDb,
  paymentAccounts,
  payments,
  projectMembers,
  projects,
  projectShareLinks,
  reviews,
  shareLinks,
  stems,
  tracks,
  users,
  versions,
} from '@music-hub/db';
import { generateToken } from './middleware/auth.js';
import {
  activeDeliveryOfProjectLink,
  announcePayment,
  approveTrack,
  deliveryForOwner,
  deliveryOfShareLink,
  deliveryState,
  failureBody,
  insertPayment,
  markPaid,
  mayCreateDeliveries,
  paidDownload,
  publicDeliveryOf,
  publicPaymentOf,
  requestRound,
  studioDeliveryOf,
  type Delivery,
} from './lib/deliveries.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const userIds: string[] = [];

async function person(name: string, plan: { plan?: string; planUntil?: Date } = {}) {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name, ...plan }).returning();
  userIds.push(u!.id);
  return u!.id;
}

async function version(trackId: string, createdById: string, versionNumber: number) {
  const [v] = await db
    .insert(versions)
    .values({
      trackId,
      versionNumber,
      status: 'ready',
      originalFileName: `mix-v${versionNumber}.wav`,
      mimeType: 'audio/wav',
      fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
      streamFileKey: `test/${crypto.randomUUID()}/mix.mp3`,
      createdById,
    })
    .returning();
  return v!.id;
}

// A project with two songs, each with V1, the owner's project link and a delivery on it:
// 120 € per song, 2 rounds included, 40 € per extra round
async function setup(options: { includedRounds?: number } = {}) {
  const ownerId = await person('Studio Klanglabor', { plan: 'solo' });
  const [p] = await db.insert(projects).values({ name: 'Zwischenstand', createdById: ownerId }).returning();
  const projectId = p!.id;
  await db.insert(projectMembers).values({ projectId, userId: ownerId, role: 'owner', canUpload: true, canComment: true, canApprove: true });
  const trackIds: string[] = [];
  const v1: string[] = [];
  for (const [i, name] of ['Nordlicht', 'Kaltfront'].entries()) {
    const [t] = await db.insert(tracks).values({ projectId, name, sortOrder: i, createdById: ownerId }).returning();
    trackIds.push(t!.id);
    v1.push(await version(t!.id, ownerId, 1));
  }
  const [link] = await db.insert(projectShareLinks).values({ projectId, token: generateToken(), createdById: ownerId }).returning();
  const [delivery] = await db
    .insert(deliveries)
    .values({
      projectLinkId: link!.id,
      projectId,
      createdById: ownerId,
      clientName: 'Lena',
      clientEmail: 'lena@example.com',
      includedRounds: options.includedRounds ?? 2,
      extraRoundCents: 4000,
    })
    .returning();
  await db.insert(deliveryTracks).values(trackIds.map((trackId) => ({ deliveryId: delivery!.id, trackId, priceCents: 12000 })));
  return { ownerId, projectId, trackIds, v1, link: link!, delivery: delivery! };
}

const reload = async (d: Delivery) => (await db.select().from(deliveries).where(eq(deliveries.id, d.id)))[0]!;

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('a plan allows deliveries while it runs', async () => {
  const now = new Date();
  expect(activePlan({ plan: null, planUntil: null }, now)).toBe(null);
  expect(activePlan({ plan: 'solo', planUntil: null }, now)).toBe('solo');
  expect(activePlan({ plan: 'pro', planUntil: new Date(now.getTime() + 60_000) }, now)).toBe('pro');
  expect(activePlan({ plan: 'solo', planUntil: new Date(now.getTime() - 60_000) }, now)).toBe(null);

  expect(await mayCreateDeliveries(db, await person('Gratis'))).toBe(false);
  expect(await mayCreateDeliveries(db, await person('Solo', { plan: 'solo' }))).toBe(true);
  expect(await mayCreateDeliveries(db, await person('Pro', { plan: 'pro' }))).toBe(false);
  expect(await mayCreateDeliveries(db, await person('Abgelaufen', { plan: 'solo', planUntil: new Date(Date.now() - 1000) }))).toBe(false);
});

test('rounds count per song, the next one beyond the included ones needs confirming and costs extra', async () => {
  const { ownerId, trackIds, v1, link, delivery } = await setup({ includedRounds: 1 });
  const [first] = trackIds as [string, string];

  const start = await deliveryState(db, delivery, link.follows);
  expect(start.totals).toEqual({
    songsCents: 24000,
    extraRounds: 0,
    extraRoundCents: 4000,
    extraCents: 0,
    totalCents: 24000,
    paidCents: 0,
    dueCents: 24000,
    approvedCount: 0,
    trackCount: 2,
  });
  expect(start.tracks.map((t) => [t.name, t.state, t.roundsUsed, t.roundsIncluded, t.nextRoundExtra])).toEqual([
    ['Nordlicht', 'review', 0, 1, false],
    ['Kaltfront', 'review', 0, 1, false],
  ]);

  const round = await requestRound(db, { delivery, link, trackId: first, versionId: v1[0]!, guestName: 'Lena', note: 'Gesang lauter' });
  if (!round.ok) throw new Error(round.code);
  expect(round.extra).toBe(false);
  // The round went out as a guest review with 'changes'
  const [review] = await db.select().from(reviews).where(eq(reviews.versionId, v1[0]!));
  expect(review?.verdict).toBe('changes');
  expect(review?.guestName).toBe('Lena');
  const [stored] = await db.select().from(deliveryRounds).where(eq(deliveryRounds.id, round.round.id));
  expect(stored?.reviewId).toBe(review!.id);

  // One round per heard version: the studio uploads a new one first
  const again = await requestRound(db, { delivery, link, trackId: first, versionId: v1[0]!, guestName: 'Lena' });
  expect(again).toMatchObject({ ok: false, status: 409, code: 'round_exists' });
  const busy = await deliveryState(db, delivery, link.follows);
  expect(busy.tracks[0]).toMatchObject({ state: 'changes', roundsUsed: 1, nextRoundExtra: true });

  const v2 = await version(first, ownerId, 2);
  // The client still heard V1
  expect(await requestRound(db, { delivery, link, trackId: first, versionId: v1[0]!, guestName: 'Lena' })).toMatchObject({ code: 'moved_on' });
  const unconfirmed = await requestRound(db, { delivery, link, trackId: first, versionId: v2, guestName: 'Lena' });
  expect(unconfirmed).toMatchObject({ ok: false, status: 409, code: 'extra_round', extraRoundCents: 4000 });
  if (unconfirmed.ok) throw new Error('expected a refusal');
  expect(failureBody(unconfirmed, 'de')).toEqual({ error: expect.any(String), code: 'extra_round', extraRoundCents: 4000 });

  // Confirming needs the price the client saw
  const stale = await requestRound(db, { delivery, link, trackId: first, versionId: v2, guestName: 'Lena', confirmExtra: true, extraRoundCents: 3000 });
  expect(stale).toMatchObject({ ok: false, status: 409, code: 'extra_round', extraRoundCents: 4000 });
  const extra = await requestRound(db, { delivery, link, trackId: first, versionId: v2, guestName: 'Lena', confirmExtra: true, extraRoundCents: 4000 });
  expect(extra).toMatchObject({ ok: true, extra: true, round: { priceCents: 4000, versionNumber: 2 } });
  const after = await deliveryState(db, delivery, link.follows);
  expect(after.totals).toMatchObject({ extraRounds: 1, extraCents: 4000, totalCents: 28000, dueCents: 28000 });
  expect(after.tracks[0]).toMatchObject({ roundsUsed: 2, extraRounds: 1, shownVersionId: v2 });
  expect(after.rounds.map((r) => [r.versionNumber, r.extra])).toEqual([[1, false], [2, true]]);
  // The automatic summary never counts as a round
  await db.insert(reviews).values({ versionId: v2, guestName: 'Lena', verdict: null });
  expect((await deliveryState(db, delivery, link.follows)).tracks[0]!.roundsUsed).toBe(2);
});

test('approving every song makes the delivery payable; a round takes an approval back', async () => {
  const { ownerId, trackIds, v1, link, delivery } = await setup();
  const [first, second] = trackIds as [string, string];

  expect(await approveTrack(db, { delivery, link, trackId: first, versionId: v1[0]!, guestName: 'Lena' })).toEqual({ ok: true, changed: true });
  expect(await approveTrack(db, { delivery, link, trackId: first, versionId: v1[0]!, guestName: 'Lena' })).toEqual({ ok: true, changed: false });
  const half = await deliveryState(db, delivery, link.follows);
  expect(half.payable).toBe(false);
  expect(half.tracks[0]).toMatchObject({ state: 'approved', approvedVersionId: v1[0], approvedByName: 'Lena' });
  // One approval review reached the studio
  expect((await db.select().from(reviews).where(and(eq(reviews.versionId, v1[0]!), eq(reviews.verdict, 'approve')))).length).toBe(1);

  await approveTrack(db, { delivery, link, trackId: second, versionId: v1[1]!, guestName: 'Lena' });
  const all = await deliveryState(db, delivery, link.follows);
  expect(all.payable).toBe(true);
  expect(all.totals).toMatchObject({ approvedCount: 2, totalCents: 24000 });

  // A payment of the total, then a round on V2 of the first song: approval and pending payment go
  const payment = await insertPayment(db, { delivery, link, method: 'transfer', amountCents: 24000 });
  expect(payment?.status).toBe('pending');
  const v2 = await version(first, ownerId, 2);
  expect(await requestRound(db, { delivery, link, trackId: first, versionId: v2, guestName: 'Lena' })).toMatchObject({ ok: true, extra: false });
  const back = await deliveryState(db, delivery, link.follows);
  expect(back.payable).toBe(false);
  expect(back.tracks[0]).toMatchObject({ state: 'changes', approvedVersionId: null });
  expect((await db.select().from(payments).where(eq(payments.id, payment!.id)))[0]!.status).toBe('expired');
  // Not payable, so no new payment
  expect(await insertPayment(db, { delivery, link, method: 'transfer', amountCents: 24000 })).toBeNull();

  // An announced transfer may be on its way: a round leaves it open for the studio to confirm
  const v3 = await version(first, ownerId, 3);
  await approveTrack(db, { delivery, link, trackId: first, versionId: v3, guestName: 'Lena' });
  const announced = await insertPayment(db, { delivery, link, method: 'transfer', amountCents: 24000 });
  expect(await announcePayment(db, announced!.id)).toBe(true);
  const v4 = await version(first, ownerId, 4);
  expect(await requestRound(db, { delivery, link, trackId: first, versionId: v4, guestName: 'Lena' })).toMatchObject({ ok: true });
  expect((await db.select().from(payments).where(eq(payments.id, announced!.id)))[0]!.status).toBe('announced');
  expect((await publicDeliveryOf(db, delivery, link)).openPayment).toMatchObject({ id: announced!.id, status: 'announced' });
  // The money arrives: it counts, the delivery waits for the last approval, which then pays it
  expect(await markPaid(db, announced!.id, ownerId)).toBe(true);
  expect((await reload(delivery)).status).toBe('open');
  expect((await deliveryState(db, delivery, link.follows)).totals).toMatchObject({ paidCents: 24000, dueCents: 0 });
  await approveTrack(db, { delivery, link, trackId: first, versionId: v4, guestName: 'Lena' });
  expect((await reload(delivery)).status).toBe('paid');
});

test('a new payment expires the open one, paying unlocks the downloads once', async () => {
  const { trackIds, v1, link, delivery, ownerId } = await setup();
  await db.insert(stems).values({ trackId: trackIds[0]!, name: 'Gesang', originalFileName: 'gesang.wav', mimeType: 'audio/wav', fileSize: 10, fileKey: `test/${crypto.randomUUID()}`, createdById: ownerId });
  for (const [i, trackId] of trackIds.entries()) await approveTrack(db, { delivery, link, trackId, versionId: v1[i]!, guestName: 'Lena' });

  // A stale total is refused
  expect(await insertPayment(db, { delivery, link, method: 'lightning', amountCents: 1 })).toBeNull();
  const first = await insertPayment(db, { delivery, link, method: 'lightning', amountCents: 24000, sats: 30000, invoice: 'lnbc1', paymentHash: 'a'.repeat(64) });
  const second = await insertPayment(db, { delivery, link, method: 'transfer', amountCents: 24000 });
  const rows = await db.select().from(payments).where(eq(payments.deliveryId, delivery.id));
  expect(rows.find((r) => r.id === first!.id)?.status).toBe('expired');
  expect(rows.find((r) => r.id === second!.id)?.status).toBe('pending');
  // The index allows only one open payment
  await expect(db.insert(payments).values({ deliveryId: delivery.id, method: 'transfer', amountCents: 24000 }).execute()).rejects.toThrow();

  expect(await paidDownload(db, delivery, trackIds[0]!)).toMatchObject({ ok: false, status: 403, code: 'not_paid' });
  // The replaced invoice is paid anyway, from another tab: the money is there, the delivery is paid
  expect(await markPaid(db, first!.id, null)).toBe(true);
  expect(await markPaid(db, first!.id, null)).toBe(false);
  const paid = await reload(delivery);
  expect(paid.status).toBe('paid');
  expect(paid.paidAt).not.toBeNull();
  expect((await db.select().from(payments).where(eq(payments.id, second!.id)))[0]!.status).toBe('expired');
  // The transfer arrives as well: recorded for the studio to pay back, the delivery stays paid
  expect(await markPaid(db, second!.id, ownerId)).toBe(true);
  expect((await db.select().from(payments).where(eq(payments.id, second!.id)))[0]).toMatchObject({ status: 'paid', confirmedById: ownerId });
  expect((await reload(delivery)).status).toBe('paid');

  const download = await paidDownload(db, paid, trackIds[0]!);
  if (!download.ok) throw new Error(download.code);
  expect(download.version.id).toBe(v1[0]!);
  expect(download.stems.map((s) => s.originalFileName)).toEqual(['gesang.wav']);
  // Rounds and approvals stop once paid
  expect(await requestRound(db, { delivery: paid, link, trackId: trackIds[0]!, versionId: v1[0]!, guestName: 'Lena' })).toMatchObject({ code: 'not_open' });

  const view = await studioDeliveryOf(db, paid, link);
  expect(view.payments.map((p) => [p.status, p.confirmedByName])).toEqual([['paid', 'Studio Klanglabor'], ['paid', null]]);
  expect(view.totals).toMatchObject({ totalCents: 24000, paidCents: 48000, dueCents: 0 });
  expect(view.linkToken).toBe(link.token);
});

test('the paywall follows the delivery of the project link until it is cancelled', async () => {
  const { ownerId, trackIds, v1, link, delivery, projectId } = await setup();
  const [trackLink] = await db
    .insert(shareLinks)
    .values({ versionId: v1[0]!, token: generateToken(), createdById: ownerId, projectLinkId: link.id, trackId: trackIds[0]!, follows: 'latest' })
    .returning();
  const [single] = await db.insert(shareLinks).values({ versionId: v1[0]!, token: generateToken(), createdById: ownerId }).returning();

  expect((await deliveryOfShareLink(db, trackLink!.id))?.id).toBe(delivery.id);
  expect(await deliveryOfShareLink(db, single!.id)).toBeUndefined();

  const guest = await publicDeliveryOf(db, delivery, link);
  expect(guest).toMatchObject({ studioName: 'Studio Klanglabor', clientName: 'Lena', payable: false, downloads: false, openPayment: null });
  expect(guest.methods).toEqual({ lightning: false, transfer: false });
  expect(guest.tracks[0]).not.toHaveProperty('name');
  await db.insert(paymentAccounts).values({ userId: ownerId, iban: 'DE89370400440532013000', accountHolder: 'Studio Klanglabor' });
  expect((await publicDeliveryOf(db, delivery, link)).methods).toEqual({ lightning: false, transfer: true });

  // Only owners manage it
  const member = await person('Mara');
  await db.insert(projectMembers).values({ projectId, userId: member, role: 'artist' });
  expect(await deliveryForOwner(db, delivery.id, member)).toBe('forbidden');
  expect(await deliveryForOwner(db, delivery.id, await person('Fremd'))).toBe('not_found');
  expect(await deliveryForOwner(db, delivery.id, ownerId)).toMatchObject({ delivery: { id: delivery.id }, link: { id: link.id } });

  await db.update(deliveries).set({ status: 'cancelled' }).where(eq(deliveries.id, delivery.id));
  expect(await deliveryOfShareLink(db, trackLink!.id)).toBeUndefined();
  expect(await activeDeliveryOfProjectLink(db, link.id)).toBeUndefined();
});

test('a payment below the current total counts towards it but opens nothing, e.g. after a song came back from the trash', async () => {
  const { ownerId, trackIds, v1, link, delivery } = await setup();
  for (const [i, trackId] of trackIds.entries()) await approveTrack(db, { delivery, link, trackId, versionId: v1[i]!, guestName: 'Lena' });
  await db.update(tracks).set({ deletedAt: new Date() }).where(eq(tracks.id, trackIds[1]!));
  const short = await insertPayment(db, { delivery, link, method: 'transfer', amountCents: 12000 });
  expect(short).not.toBeNull();
  await db.update(tracks).set({ deletedAt: null }).where(eq(tracks.id, trackIds[1]!));

  expect(await markPaid(db, short!.id, ownerId)).toBe(true);
  expect((await reload(delivery)).status).toBe('open');
  const state = await deliveryState(db, delivery, link.follows);
  expect(state.totals).toMatchObject({ totalCents: 24000, paidCents: 12000, dueCents: 12000 });
  expect(state.payable).toBe(true);
  expect(await paidDownload(db, await reload(delivery), trackIds[0]!)).toMatchObject({ code: 'not_paid' });
  // The rest is due
  expect(await insertPayment(db, { delivery, link, method: 'transfer', amountCents: 24000 })).toBeNull();
  const rest = await insertPayment(db, { delivery, link, method: 'transfer', amountCents: 12000 });
  expect(await markPaid(db, rest!.id, ownerId)).toBe(true);
  expect((await reload(delivery)).status).toBe('paid');
});

test('a free delivery is paid on its last approval, without a payment', async () => {
  const { trackIds, v1, link, delivery } = await setup();
  await db.update(deliveryTracks).set({ priceCents: 0 }).where(eq(deliveryTracks.deliveryId, delivery.id));
  await approveTrack(db, { delivery, link, trackId: trackIds[0]!, versionId: v1[0]!, guestName: 'Lena' });
  expect(await insertPayment(db, { delivery, link, method: 'transfer', amountCents: 0 })).toBeNull();
  expect((await reload(delivery)).status).toBe('open');
  await approveTrack(db, { delivery, link, trackId: trackIds[1]!, versionId: v1[1]!, guestName: 'Lena' });
  expect((await reload(delivery)).status).toBe('paid');
  expect(await publicDeliveryOf(db, delivery, link)).toMatchObject({ status: 'paid', downloads: true, payable: false, openPayment: null });
  expect(await db.select().from(payments).where(eq(payments.deliveryId, delivery.id))).toHaveLength(0);
  // A GiroCode without an amount would throw; the view leaves it out instead
  const account = { userId: delivery.createdById, iban: 'DE89370400440532013000', accountHolder: 'Studio', bic: null, nwcSecretEnc: null, nwcAlias: null, updatedAt: new Date() };
  const zero = { id: crypto.randomUUID(), deliveryId: delivery.id, method: 'transfer', amountCents: 0, sats: null, invoice: null, paymentHash: null, status: 'pending', expiresAt: null, confirmedById: null, createdAt: new Date(), paidAt: null };
  expect(publicPaymentOf(zero, account, delivery).transfer).toBeNull();
});

test('rounds keep the price the client confirmed and still count after their version is purged', async () => {
  const { ownerId, trackIds, v1, link, delivery } = await setup({ includedRounds: 0 });
  const [first] = trackIds as [string, string];
  expect(await requestRound(db, { delivery, link, trackId: first, versionId: v1[0]!, guestName: 'Lena', confirmExtra: true, extraRoundCents: 4000 })).toMatchObject({ ok: true, extra: true });
  // The studio raises the price: the confirmed round stays at 40 €, the next one needs the new price
  await db.update(deliveries).set({ extraRoundCents: 8000 }).where(eq(deliveries.id, delivery.id));
  const raised = await reload(delivery);
  expect((await deliveryState(db, raised, link.follows)).totals).toMatchObject({ extraRoundCents: 8000, extraCents: 4000, totalCents: 28000 });
  const v2 = await version(first, ownerId, 2);
  expect(await requestRound(db, { delivery: raised, link, trackId: first, versionId: v2, guestName: 'Lena', confirmExtra: true, extraRoundCents: 4000 })).toMatchObject({
    code: 'extra_round',
    extraRoundCents: 8000,
  });

  // V1 goes from the trash for good: its round stays on the bill
  await db.delete(versions).where(eq(versions.id, v1[0]!));
  const after = await deliveryState(db, raised, link.follows);
  expect(after.rounds.map((r) => [r.versionId, r.versionNumber, r.priceCents])).toEqual([[null, 1, 4000]]);
  expect(after.tracks[0]).toMatchObject({ roundsUsed: 1, extraRounds: 1, extraCents: 4000 });
  expect(after.totals).toMatchObject({ extraCents: 4000, totalCents: 28000 });
  expect((await studioDeliveryOf(db, raised, link)).rounds[0]).toMatchObject({ versionId: null, versionNumber: 1, priceCents: 4000 });
});
