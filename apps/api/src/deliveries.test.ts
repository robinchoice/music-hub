import { afterAll, beforeAll, expect, mock, setDefaultTimeout, test } from 'bun:test';
import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import {
  createDb,
  deliveries,
  migrateDb,
  openTracks,
  payments,
  projectMembers,
  projects,
  projectShareLinks,
  sessions,
  shareLinks,
  stems,
  tracks,
  users,
  versions,
} from '@music-hub/db';
import type {
  DeliveryErrorResponse,
  DeliveryListResponse,
  DeliveryResponse,
  GuestDeliveryResponse,
  GuestPaymentResponse,
  PaymentAccountResponse,
  PublicDelivery,
} from '@music-hub/shared';
import { generateToken, hashToken } from './middleware/auth.js';
import { ADMIN_EMAILS } from './lib/admin.js';
import { checkLightningPayments, LIGHTNING_GRACE_MS } from './lib/deliveries.js';
import { setNwcFactory, type NwcClient } from './lib/payments/nwc.js';
import { setPriceSource } from './lib/payments/rate.js';
import type { AppEnv } from './types.js';

// Signed URLs carry the key, so a test can tell which file a guest would get
const s3 = await import('./storage/s3.js');
mock.module('./storage/s3.js', () => ({
  ...s3,
  createDownloadUrl: async (key: string) => `https://bucket.test/${key}`,
  getObjectStream: async () => new Blob([new Uint8Array([1, 2, 3])]).stream(),
}));
const { shareRoutes } = await import('./routes/share.js');
const { deliveryRoutes } = await import('./routes/deliveries.js');
const { paymentAccountRoutes } = await import('./routes/payment-account.js');
const { adminRoutes } = await import('./routes/admin.js');

// ADMIN_EMAILS is read once on import, other test files may have imported it already
const ADMIN = `admin-${crypto.randomUUID()}@example.com`;
ADMIN_EMAILS.add(ADMIN);

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    c.set('db', db);
    await next();
  })
  .route('/share', shareRoutes)
  .route('/deliveries', deliveryRoutes)
  .route('/payment-account', paymentAccountRoutes)
  .route('/admin', adminRoutes);
const userIds: string[] = [];
// Each test walks a whole delivery through many requests
setDefaultTimeout(30_000);

const call = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
const json = async <T>(res: Response) => (await res.json()) as T;

type Person = { id: string; headers: Record<string, string> };
async function person(name: string, values: { plan?: string; email?: string } = {}): Promise<Person> {
  const [u] = await db
    .insert(users)
    .values({ email: values.email ?? `test-${crypto.randomUUID()}@example.com`, name, plan: values.plan ?? null })
    .returning();
  userIds.push(u!.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: u!.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  return { id: u!.id, headers: { authorization: `Bearer ${token}` } };
}

async function version(trackId: string, createdById: string, versionNumber: number, mp3 = true) {
  const [v] = await db
    .insert(versions)
    .values({
      trackId,
      versionNumber,
      status: 'ready',
      originalFileName: `mix-v${versionNumber}.wav`,
      mimeType: 'audio/wav',
      fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/original.wav`,
      streamFileKey: mp3 ? `test/${crypto.randomUUID()}/preview.mp3` : null,
      createdById,
      createdAt: new Date(Date.now() + versionNumber * 1000),
    })
    .returning();
  return v!;
}

// A project of the studio with two songs, each with a V1
async function studioProject(owner: Person) {
  const [p] = await db.insert(projects).values({ name: 'Zwischenstand', createdById: owner.id }).returning();
  await db.insert(projectMembers).values({ projectId: p!.id, userId: owner.id, role: 'owner', canUpload: true, canComment: true, canApprove: true });
  const songs: { id: string; v1: Awaited<ReturnType<typeof version>> }[] = [];
  for (const [i, name] of ['Nordlicht', 'Kaltfront'].entries()) {
    const [t] = await db.insert(tracks).values({ projectId: p!.id, name, sortOrder: i, createdById: owner.id }).returning();
    songs.push({ id: t!.id, v1: await version(t!.id, owner.id, 1) });
  }
  return { projectId: p!.id, songs };
}

async function createDelivery(owner: Person, projectId: string, trackIds: string[], extra: Record<string, unknown> = {}) {
  const res = await call(`/deliveries/project/${projectId}`, {
    method: 'POST',
    headers: owner.headers,
    body: { clientName: 'Lena', clientEmail: 'lena@example.com', extraRoundCents: 4000, tracks: trackIds.map((trackId) => ({ trackId, priceCents: 12000 })), ...extra },
  });
  expect(res.status).toBe(201);
  return (await json<DeliveryResponse>(res)).delivery;
}

type Album = { allowDownload: boolean; allowComments: boolean; tracks: { id: string; token: string }[]; delivery?: PublicDelivery };
const album = async (token: string, headers: Record<string, string> = {}) => {
  const res = await call(`/share/project/public/${token}`, { headers });
  expect(res.status).toBe(200);
  return json<Album>(res);
};
const guest = (token: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(`/share/project/public/${token}/delivery/${path}`, body === undefined ? { headers } : { method: 'POST', body, headers });

// A studio with a delivery on two songs, the client's album opened once
async function setup() {
  const owner = await person('Studio Klanglabor', { plan: 'solo' });
  const { projectId, songs } = await studioProject(owner);
  const delivery = await createDelivery(owner, projectId, songs.map((s) => s.id));
  return { owner, projectId, songs, delivery, token: delivery.linkToken };
}

const approve = (token: string, trackId: string, versionId: string) => guest(token, 'approve', { trackId, versionId, guestName: 'Lena' });
// confirmCents: the price of an extra round the client confirms
const round = (token: string, trackId: string, versionId: string, confirmCents?: number) =>
  guest(token, 'rounds', {
    trackId,
    versionId,
    guestName: 'Lena',
    note: 'Bass leiser',
    ...(confirmCents === undefined ? {} : { confirmExtra: true, extraRoundCents: confirmCents }),
  });

// A wallet that only receives; tests mark invoices as paid
const wallet = { methods: ['get_info', 'make_invoice', 'lookup_invoice'], settled: new Set<string>(), connects: 0 };
const fakeClient: NwcClient = {
  getInfo: async () => ({ alias: 'Klanglabor Alby', methods: wallet.methods }),
  makeInvoice: async ({ amountMsats }) => {
    const paymentHash = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    return { invoice: `lnbc${amountMsats}n1test${paymentHash.slice(0, 8)}`, paymentHash, amountMsats, expiresAt: new Date(Date.now() + 900_000) };
  },
  lookupInvoice: async (hash) => ({ settled: wallet.settled.has(hash), settledAt: null }),
  close: () => {},
};
// Built at runtime so the secret scan sees no key-like literal; the fake wallet never checks it
const NWC_URL = `nostr+walletconnect://${'b'.repeat(64)}?relay=wss%3A%2F%2Frelay.test&secret=${'1'.repeat(64)}`;
const IBAN = 'DE89 3704 0044 0532 0130 00';

const previousKey = process.env.PAYMENT_SECRETS_KEY;

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  process.env.PAYMENT_SECRETS_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  setNwcFactory(async () => {
    wallet.connects++;
    return fakeClient;
  });
  // 60 000 € per bitcoin: 1 € is 1667 sats
  setPriceSource(async () => 60_000);
});

afterAll(async () => {
  setNwcFactory(null);
  setPriceSource(null);
  if (previousKey === undefined) delete process.env.PAYMENT_SECRETS_KEY;
  else process.env.PAYMENT_SECRETS_KEY = previousKey;
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('only owners with the Solo plan or an admin address create deliveries; the admin sets the plan', async () => {
  const owner = await person('Studio Gratis');
  const { projectId, songs } = await studioProject(owner);
  const body = { clientName: 'Lena', tracks: [{ trackId: songs[0]!.id, priceCents: 12000 }] };

  const refused = await call(`/deliveries/project/${projectId}`, { method: 'POST', headers: owner.headers, body });
  expect(refused.status).toBe(403);
  expect((await json<DeliveryErrorResponse>(refused)).code).toBe('plan_required');
  const listed = await json<DeliveryListResponse>(await call(`/deliveries/project/${projectId}`, { headers: owner.headers }));
  expect(listed).toEqual({ deliveries: [], canCreate: false });

  // Members who aren't owner get 403, people outside the project 404
  const engineer = await person('Mischer', { plan: 'solo' });
  await db.insert(projectMembers).values({ projectId, userId: engineer.id, role: 'mixing_engineer', canUpload: true, canComment: true });
  expect((await call(`/deliveries/project/${projectId}`, { headers: engineer.headers })).status).toBe(403);
  expect((await call(`/deliveries/project/${projectId}`, { method: 'POST', headers: engineer.headers, body })).status).toBe(403);
  const stranger = await person('Fremd', { plan: 'solo' });
  expect((await call(`/deliveries/project/${projectId}`, { headers: stranger.headers })).status).toBe(404);

  // The admin gives the owner the plan, and only the admin may
  const admin = await person('Admin', { email: ADMIN });
  const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
  expect((await call(`/admin/users/${owner.id}/plan`, { method: 'PATCH', headers: owner.headers, body: { plan: 'solo' } })).status).toBe(403);
  const set = await call(`/admin/users/${owner.id}/plan`, { method: 'PATCH', headers: admin.headers, body: { plan: 'solo', planUntil: until } });
  expect(await set.json()).toEqual({ plan: 'solo', planUntil: until });
  const people = await json<{ people: { id: string; plan: string | null; planUntil: string | null }[] }>(
    await call('/admin/users', { headers: admin.headers }),
  );
  expect(people.people.find((p) => p.id === owner.id)).toMatchObject({ plan: 'solo', planUntil: until });

  const created = await call(`/deliveries/project/${projectId}`, { method: 'POST', headers: owner.headers, body });
  expect(created.status).toBe(201);
  const { delivery } = await json<DeliveryResponse>(created);
  expect(delivery.totals).toMatchObject({ songsCents: 12000, trackCount: 1, totalCents: 12000 });
  expect(delivery.includedRounds).toBe(2);

  // One delivery per link; the engineer can't see it
  const again = await call(`/deliveries/project/${projectId}`, { method: 'POST', headers: owner.headers, body });
  expect(again.status).toBe(409);
  expect((await json<DeliveryErrorResponse>(again)).code).toBe('delivery_exists');
  expect((await call(`/deliveries/${delivery.id}`, { headers: engineer.headers })).status).toBe(403);
  expect((await call(`/deliveries/${delivery.id}`, { headers: stranger.headers })).status).toBe(404);

  // An admin address needs no plan
  const adminProject = await studioProject(admin);
  await createDelivery(admin, adminProject.projectId, [adminProject.songs[0]!.id]);

  // Ending the plan takes it away
  await call(`/admin/users/${owner.id}/plan`, { method: 'PATCH', headers: admin.headers, body: { plan: null } });
  const after = await json<DeliveryListResponse>(await call(`/deliveries/project/${projectId}`, { headers: owner.headers }));
  expect(after.canCreate).toBe(false);
  expect(after.deliveries.map((d) => d.id)).toEqual([delivery.id]);
});

test('songs must belong to the project and the link selection', async () => {
  const owner = await person('Studio Klanglabor', { plan: 'solo' });
  const { projectId, songs } = await studioProject(owner);
  const other = await studioProject(owner);
  const body = (trackIds: string[]) => ({ clientName: 'Lena', tracks: trackIds.map((trackId) => ({ trackId, priceCents: 100 })) });
  const post = (trackIds: string[]) => call(`/deliveries/project/${projectId}`, { method: 'POST', headers: owner.headers, body: body(trackIds) });

  const foreign = await post([other.songs[0]!.id]);
  expect(foreign.status).toBe(400);
  expect((await json<DeliveryErrorResponse>(foreign)).code).toBe('track_invalid');
  expect((await post([songs[0]!.id, songs[0]!.id])).status).toBe(400);
  // An open track hands its original to anyone, a paywall couldn't hold it
  await db.insert(openTracks).values({ trackId: songs[1]!.id, versionId: songs[1]!.v1.id, license: 'cc-by', requestedById: owner.id, openedAt: new Date() });
  const open = await post([songs[1]!.id]);
  expect(open.status).toBe(400);
  expect((await json<DeliveryErrorResponse>(open)).code).toBe('track_open');
  await db.delete(openTracks).where(eq(openTracks.trackId, songs[1]!.id));

  // The owner's existing link with a selection and no comments: only selected songs, and comments turn on
  const linkRes = await call(`/share/project/${projectId}`, { method: 'POST', headers: owner.headers, body: { allowComments: false } });
  const { link } = await json<{ link: { id: string; token: string } }>(linkRes);
  await call(`/share/project-link/${link.id}`, { method: 'PATCH', headers: owner.headers, body: { trackIds: [songs[0]!.id] } });
  expect((await post([songs[1]!.id])).status).toBe(400);
  const created = await post([songs[0]!.id]);
  expect(created.status).toBe(201);
  expect((await json<DeliveryResponse>(created)).delivery.linkToken).toBe(link.token);
  expect((await album(link.token)).allowComments).toBe(true);
});

test('rounds per heard version: wrong version 409, once per version, extra ones need confirming', async () => {
  const { owner, songs, delivery, token } = await setup();
  const [song] = songs;
  const shown = await album(token);
  expect(shown.allowDownload).toBe(false);
  expect(shown.delivery?.tracks.map((t) => [t.state, t.roundsIncluded])).toEqual([
    ['review', 2],
    ['review', 2],
  ]);

  const moved = await round(token, song!.id, songs[1]!.v1.id);
  expect(moved.status).toBe(409);
  expect((await json<DeliveryErrorResponse>(moved)).code).toBe('moved_on');

  const first = await round(token, song!.id, song!.v1.id);
  expect(first.status).toBe(201);
  const after = (await json<GuestDeliveryResponse>(first)).delivery.tracks[0]!;
  expect(after).toMatchObject({ state: 'changes', roundsUsed: 1, extraRounds: 0, nextRoundExtra: false });
  const twice = await round(token, song!.id, song!.v1.id);
  expect(twice.status).toBe(409);
  expect((await json<DeliveryErrorResponse>(twice)).code).toBe('round_exists');

  const v2 = await version(song!.id, owner.id, 2);
  expect((await round(token, song!.id, v2.id)).status).toBe(201);
  const v3 = await version(song!.id, owner.id, 3);
  const unconfirmed = await round(token, song!.id, v3.id);
  expect(unconfirmed.status).toBe(409);
  expect(await unconfirmed.json()).toMatchObject({ code: 'extra_round', extraRoundCents: 4000 });

  const confirmed = await round(token, song!.id, v3.id, 4000);
  expect(confirmed.status).toBe(201);
  const { totals, tracks: list } = (await json<GuestDeliveryResponse>(confirmed)).delivery;
  expect(list[0]).toMatchObject({ roundsUsed: 3, extraRounds: 1 });
  expect(totals).toMatchObject({ songsCents: 24000, extraRounds: 1, extraCents: 4000, totalCents: 28000 });

  // Gifts only count for the rounds after them: the extra round stays extra
  const gift = (body: unknown) => call(`/deliveries/${delivery.id}/tracks/${song!.id}/gift`, { method: 'POST', headers: owner.headers, body });
  const once = (await json<DeliveryResponse>(await gift({}))).delivery;
  expect(once.tracks[0]).toMatchObject({ giftedRounds: 1, roundsIncluded: 3, extraRounds: 1, nextRoundExtra: true });
  const studio = (await json<DeliveryResponse>(await gift({ rounds: 1 }))).delivery;
  expect(studio.tracks[0]).toMatchObject({ giftedRounds: 2, roundsIncluded: 4, extraRounds: 1, nextRoundExtra: false });
  expect((await call(`/deliveries/${delivery.id}/tracks/${crypto.randomUUID()}/gift`, { method: 'POST', headers: owner.headers, body: {} })).status).toBe(404);
  expect(studio.rounds.map((r) => [r.versionNumber, r.extra])).toEqual([
    [1, false],
    [2, false],
    [3, true],
  ]);
  const v4 = await version(song!.id, owner.id, 4);
  expect((await round(token, song!.id, v4.id)).status).toBe(201);
});

test('a round takes an approval back; paying needs every song approved', async () => {
  const { owner, songs, delivery, token } = await setup();
  // A transfer account so there is a way to pay
  await call('/payment-account', { method: 'PUT', headers: owner.headers, body: { iban: IBAN, accountHolder: 'Studio Klanglabor' } });

  expect((await approve(token, songs[0]!.id, songs[0]!.v1.id)).status).toBe(200);
  const early = await guest(token, 'payments', { method: 'transfer' });
  expect(early.status).toBe(409);
  expect((await json<DeliveryErrorResponse>(early)).code).toBe('not_payable');

  const approved = await json<GuestDeliveryResponse>(await approve(token, songs[1]!.id, songs[1]!.v1.id));
  expect(approved.delivery.payable).toBe(true);
  expect(approved.delivery.tracks.map((t) => t.state)).toEqual(['approved', 'approved']);

  const taken = await json<GuestDeliveryResponse>(await round(token, songs[1]!.id, songs[1]!.v1.id));
  expect(taken.delivery.tracks[1]).toMatchObject({ state: 'changes', approvedVersionId: null });
  expect(taken.delivery.payable).toBe(false);
  expect((await guest(token, 'payments', { method: 'transfer' })).status).toBe(409);

  // V2 approved, paying works again
  const v2 = await version(songs[1]!.id, owner.id, 2);
  expect((await approve(token, songs[1]!.id, songs[1]!.v1.id)).status).toBe(409);
  expect((await approve(token, songs[1]!.id, v2.id)).status).toBe(200);
  const paying = await guest(token, 'payments', { method: 'transfer' });
  expect(paying.status).toBe(201);
  expect((await json<GuestPaymentResponse>(paying)).payment.amountCents).toBe(24000);
  // Lightning isn't set up for this studio
  const lightning = await guest(token, 'payments', { method: 'lightning' });
  expect(lightning.status).toBe(400);
  expect((await json<DeliveryErrorResponse>(lightning)).code).toBe('method_unavailable');
  const studio = await json<DeliveryResponse>(await call(`/deliveries/${delivery.id}`, { headers: owner.headers }));
  expect(studio.delivery.payments).toHaveLength(1);
});

test('Lightning: a receive-only wallet, one open invoice, paid once the wallet says so', async () => {
  const { owner, songs, delivery, token } = await setup();

  // Relays inside the server's network are never dialed
  const connects = wallet.connects;
  for (const relay of ['ws://10.0.0.5:5432', 'wss://127.0.0.1:5432', 'wss://169.254.169.254/latest', 'wss://postgres']) {
    const url = NWC_URL.replace('wss%3A%2F%2Frelay.test', encodeURIComponent(relay));
    const refused = await call('/payment-account', { method: 'PUT', headers: owner.headers, body: { nwcUrl: url } });
    expect(refused.status).toBe(400);
    expect((await json<DeliveryErrorResponse>(refused)).code).toBe('relay_refused');
  }
  expect(wallet.connects).toBe(connects);

  wallet.methods = ['get_info', 'make_invoice', 'lookup_invoice', 'pay_invoice'];
  const spends = await call('/payment-account', { method: 'PUT', headers: owner.headers, body: { nwcUrl: NWC_URL } });
  expect(spends.status).toBe(400);
  expect((await json<DeliveryErrorResponse>(spends)).code).toBe('wallet_spends');
  wallet.methods = ['get_info', 'make_invoice', 'lookup_invoice'];
  const connected = await call('/payment-account', { method: 'PUT', headers: owner.headers, body: { nwcUrl: NWC_URL } });
  expect(connected.status).toBe(200);
  const text = await connected.text();
  expect(text).not.toContain('secret');
  expect(text).not.toContain('walletconnect');
  expect((JSON.parse(text) as PaymentAccountResponse).account.lightning).toEqual({ connected: true, alias: 'Klanglabor Alby' });

  for (const s of songs) await approve(token, s.id, s.v1.id);
  const first = await json<GuestPaymentResponse>(await guest(token, 'payments', { method: 'lightning' }));
  expect(first.payment).toMatchObject({ method: 'lightning', status: 'pending', amountCents: 24000 });
  expect(first.payment.sats).toBe(Math.ceil((24000 / 100 / 60_000) * 1e8));
  expect(first.payment.invoice).toStartWith('lnbc');
  expect(first.delivery.openPayment?.id).toBe(first.payment.id);

  // A second tab gets the same invoice, not a second one that could be paid as well
  const again = await guest(token, 'payments', { method: 'lightning' });
  expect(again.status).toBe(200);
  expect((await json<GuestPaymentResponse>(again)).payment.id).toBe(first.payment.id);

  // The browser only polls, the wallet decides
  const poll = (id: string) => guest(token, `payments/${id}`);
  expect((await json<GuestPaymentResponse>(await poll(first.payment.id))).payment.status).toBe('pending');
  expect((await guest(token, 'download/' + songs[0]!.id)).status).toBe(403);

  // The client switches to a transfer, the invoice is replaced. Paid anyway (it was still open in the
  // wallet), it counts: the next poll asks the wallet about it too.
  await call('/payment-account', { method: 'PUT', headers: owner.headers, body: { iban: IBAN, accountHolder: 'Studio Klanglabor' } });
  const transfer = await json<GuestPaymentResponse>(await guest(token, 'payments', { method: 'transfer' }));
  const [replaced] = await db.select().from(payments).where(eq(payments.id, first.payment.id));
  expect(replaced!.status).toBe('expired');
  wallet.settled.add(replaced!.paymentHash!);
  const paid = await json<GuestPaymentResponse>(await poll(transfer.payment.id));
  expect(paid.delivery).toMatchObject({ status: 'paid', downloads: true, openPayment: null });
  expect((await json<GuestPaymentResponse>(await poll(first.payment.id))).payment.status).toBe('paid');
  expect((await guest(token, `payments/${crypto.randomUUID()}`)).status).toBe(404);
  // Paid is paid: no new payment
  expect((await json<DeliveryErrorResponse>(await guest(token, 'payments', { method: 'lightning' }))).code).toBe('already_paid');

  // The studio confirms each payment once; a transfer that still arrives is recorded to pay back
  const confirm = (id: string) => call(`/deliveries/${delivery.id}/payments/${id}/confirm`, { method: 'POST', headers: owner.headers, body: {} });
  expect((await confirm(first.payment.id)).status).toBe(409);
  const late = await json<DeliveryResponse>(await confirm(transfer.payment.id));
  expect(late.delivery.payments.map((p) => p.status)).toEqual(['paid', 'paid']);
  expect(late.delivery.totals).toMatchObject({ paidCents: 48000, dueCents: 0 });
});

test('Lightning: an invoice paid just before its expiry counts, also with no page open', async () => {
  const { owner, songs, delivery, token } = await setup();
  wallet.methods = ['get_info', 'make_invoice', 'lookup_invoice'];
  expect((await call('/payment-account', { method: 'PUT', headers: owner.headers, body: { nwcUrl: NWC_URL } })).status).toBe(200);
  for (const s of songs) await approve(token, s.id, s.v1.id);
  const { payment } = await json<GuestPaymentResponse>(await guest(token, 'payments', { method: 'lightning' }));
  const [row] = await db.select().from(payments).where(eq(payments.id, payment.id));

  // Past its expiry and not paid: the poll expires it, and a new one replaces it
  await db.update(payments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(payments.id, payment.id));
  expect((await json<GuestPaymentResponse>(await guest(token, `payments/${payment.id}`))).payment.status).toBe('expired');
  const next = await json<GuestPaymentResponse>(await guest(token, 'payments', { method: 'lightning' }));
  expect(next.payment.id).not.toBe(payment.id);

  // The first one was paid in its last seconds after all; the API's own check finds it without a page
  wallet.settled.add(row!.paymentHash!);
  await checkLightningPayments(db);
  expect((await db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0]!.status).toBe('paid');
  expect((await db.select().from(payments).where(eq(payments.id, payment.id)))[0]!.status).toBe('paid');

  // Long past the grace time the wallet is no longer asked; the studio marks such a payment by hand
  await db
    .update(payments)
    .set({ status: 'expired', expiresAt: new Date(Date.now() - LIGHTNING_GRACE_MS - 60_000) })
    .where(eq(payments.id, next.payment.id));
  const [old] = await db.select().from(payments).where(eq(payments.id, next.payment.id));
  wallet.settled.add(old!.paymentHash!);
  await checkLightningPayments(db, delivery.id);
  expect((await db.select().from(payments).where(eq(payments.id, next.payment.id)))[0]!.status).toBe('expired');
  const byHand = await call(`/deliveries/${delivery.id}/payments/${next.payment.id}/confirm`, { method: 'POST', headers: owner.headers, body: {} });
  expect((await json<DeliveryResponse>(byHand)).delivery.payments.find((p) => p.id === next.payment.id)).toMatchObject({
    status: 'paid',
    confirmedByName: 'Studio Klanglabor',
  });
});

test('a free delivery needs no payment step; the album page stays whole', async () => {
  const owner = await person('Studio Klanglabor', { plan: 'solo' });
  const { projectId, songs } = await studioProject(owner);
  const res = await call(`/deliveries/project/${projectId}`, {
    method: 'POST',
    headers: owner.headers,
    body: { clientName: 'Lena', tracks: songs.map((s) => ({ trackId: s.id, priceCents: 0 })) },
  });
  const { delivery } = await json<DeliveryResponse>(res);
  await call('/payment-account', { method: 'PUT', headers: owner.headers, body: { iban: IBAN, accountHolder: 'Studio Klanglabor' } });
  await approve(delivery.linkToken, songs[0]!.id, songs[0]!.v1.id);
  expect((await json<DeliveryErrorResponse>(await guest(delivery.linkToken, 'payments', { method: 'transfer' }))).code).toBe('not_payable');
  const last = await json<GuestDeliveryResponse>(await approve(delivery.linkToken, songs[1]!.id, songs[1]!.v1.id));
  expect(last.delivery).toMatchObject({ status: 'paid', downloads: true, openPayment: null });
  expect((await album(delivery.linkToken)).delivery?.status).toBe('paid');
  expect((await guest(delivery.linkToken, `download/${songs[0]!.id}`)).status).toBe(302);
});

test('transfer: GiroCode, the client announces, the studio confirms', async () => {
  const { owner, songs, delivery, token } = await setup();
  const invalid = await call('/payment-account', { method: 'PUT', headers: owner.headers, body: { iban: 'DE00 3704 0044 0532 0130 00', accountHolder: 'Studio' } });
  expect(invalid.status).toBe(400);
  expect((await json<DeliveryErrorResponse>(invalid)).code).toBe('invalid_iban');
  expect((await call('/payment-account', { method: 'PUT', headers: owner.headers, body: { iban: IBAN } })).status).toBe(400);
  const saved = await call('/payment-account', { method: 'PUT', headers: owner.headers, body: { iban: IBAN, bic: 'COBADEFFXXX', accountHolder: 'Studio Klanglabor' } });
  const account = (await json<PaymentAccountResponse>(saved)).account;
  expect(account.transfer).toMatchObject({ bic: 'COBADEFFXXX', accountHolder: 'Studio Klanglabor' });
  expect(account.transfer?.ibanMasked).toEndWith('3000');
  expect(account.transfer?.ibanMasked).not.toContain('370400');
  expect(account.lightning.connected).toBe(false);

  for (const s of songs) await approve(token, s.id, s.v1.id);
  const started = await guest(token, 'payments', { method: 'transfer' });
  const { payment } = await json<GuestPaymentResponse>(started);
  expect(payment.transfer).toMatchObject({ iban: 'DE89370400440532013000', remittance: `MH-${delivery.id.slice(0, 8)}` });
  expect(payment.transfer?.epcPayload.split('\n').slice(0, 8)).toEqual([
    'BCD',
    '002',
    '1',
    'SCT',
    'COBADEFFXXX',
    'Studio Klanglabor',
    'DE89370400440532013000',
    'EUR240.00',
  ]);

  const announced = await guest(token, `payments/${payment.id}/announce`, {});
  expect((await json<GuestPaymentResponse>(announced)).payment.status).toBe('announced');
  expect((await guest(token, `payments/${payment.id}/announce`, {})).status).toBe(409);

  // Another owner's project can't confirm it
  const other = await person('Studio Fremd', { plan: 'solo' });
  expect((await call(`/deliveries/${delivery.id}/payments/${payment.id}/confirm`, { method: 'POST', headers: other.headers, body: {} })).status).toBe(404);
  const confirmed = await call(`/deliveries/${delivery.id}/payments/${payment.id}/confirm`, { method: 'POST', headers: owner.headers, body: {} });
  expect(confirmed.status).toBe(200);
  const studio = (await json<DeliveryResponse>(confirmed)).delivery;
  expect(studio.status).toBe('paid');
  expect(studio.payments[0]).toMatchObject({ status: 'paid', confirmedByName: 'Studio Klanglabor' });
  expect((await call(`/deliveries/${delivery.id}/payments/${payment.id}/confirm`, { method: 'POST', headers: owner.headers, body: {} })).status).toBe(409);

  // Paid is final, and the link with it stays
  expect((await call(`/deliveries/${delivery.id}/cancel`, { method: 'POST', headers: owner.headers, body: {} })).status).toBe(409);
  const revoke = await call(`/share/project-link/${delivery.projectLinkId}`, { method: 'DELETE', headers: owner.headers });
  expect(revoke.status).toBe(409);
  expect((await json<DeliveryErrorResponse>(revoke)).code).toBe('link_has_delivery');
  expect(await db.select().from(deliveries).where(eq(deliveries.id, delivery.id))).toHaveLength(1);
  expect((await call(`/deliveries/${delivery.id}`, { method: 'PATCH', headers: owner.headers, body: { clientName: 'X' } })).status).toBe(409);
});

test('the paywall: no download and no original stream before paying, the approved files after', async () => {
  const { owner, songs, delivery, token } = await setup();
  // Even a link that allows downloads hands nothing out behind a delivery
  await db.update(projectShareLinks).set({ allowDownload: true }).where(eq(projectShareLinks.token, token));
  await db.update(shareLinks).set({ allowDownload: true }).where(eq(shareLinks.projectLinkId, delivery.projectLinkId));
  // The second song's newest version has no MP3 yet
  const noMp3 = await version(songs[1]!.id, owner.id, 2, false);
  await db.insert(stems).values({
    trackId: songs[0]!.id,
    name: 'Drums',
    originalFileName: 'Drums.wav',
    mimeType: 'audio/wav',
    fileSize: 1000,
    fileKey: `test/${crypto.randomUUID()}/drums.wav`,
    createdById: owner.id,
  });

  const shown = await album(token);
  expect(shown.allowDownload).toBe(false);
  for (const t of shown.tracks) {
    await db.update(shareLinks).set({ allowDownload: true }).where(eq(shareLinks.token, t.token));
  }
  const withMp3 = await call(`/share/public/${shown.tracks[0]!.token}`);
  const first = await withMp3.text();
  expect(first).not.toContain(songs[0]!.v1.originalFileKey);
  expect(JSON.parse(first)).toMatchObject({ downloadUrl: null, processing: false, streamUrl: `https://bucket.test/${songs[0]!.v1.streamFileKey}` });
  const without = await call(`/share/public/${shown.tracks[1]!.token}`);
  const second = await without.text();
  expect(second).not.toContain(noMp3.originalFileKey);
  expect(JSON.parse(second)).toMatchObject({ downloadUrl: null, streamUrl: null, processing: true });

  // Before paying, downloads answer 403
  await approve(token, songs[0]!.id, songs[0]!.v1.id);
  await approve(token, songs[1]!.id, noMp3.id);
  const early = await guest(token, `download/${songs[0]!.id}`);
  expect(early.status).toBe(403);
  expect((await json<DeliveryErrorResponse>(early)).code).toBe('not_paid');
  expect((await guest(token, `download/${songs[0]!.id}/stems`)).status).toBe(403);

  await call('/payment-account', { method: 'PUT', headers: owner.headers, body: { iban: IBAN, accountHolder: 'Studio Klanglabor' } });
  const { payment } = await json<GuestPaymentResponse>(await guest(token, 'payments', { method: 'transfer' }));
  await call(`/deliveries/${delivery.id}/payments/${payment.id}/confirm`, { method: 'POST', headers: owner.headers, body: {} });

  const original = await guest(token, `download/${songs[1]!.id}`);
  expect(original.status).toBe(302);
  expect(original.headers.get('location')).toBe(`https://bucket.test/${noMp3.originalFileKey}`);
  // Pages behind a password ask for the URL instead of following the redirect
  const asked = await guest(token, `download/${songs[1]!.id}?redirect=0`);
  expect(asked.status).toBe(200);
  expect(await json<{ url: string }>(asked)).toEqual({ url: `https://bucket.test/${noMp3.originalFileKey}` });
  const zip = await guest(token, `download/${songs[0]!.id}/stems`);
  expect(zip.status).toBe(200);
  expect(zip.headers.get('content-type')).toBe('application/zip');
  await zip.arrayBuffer();
  // Beyond what a ZIP without ZIP64 holds: refused instead of broken
  await db.update(stems).set({ fileSize: 5 * 1024 ** 3 }).where(eq(stems.trackId, songs[0]!.id));
  const big = await guest(token, `download/${songs[0]!.id}/stems`);
  expect(big.status).toBe(413);
  expect((await json<DeliveryErrorResponse>(big)).code).toBe('zip_too_large');
  expect((await guest(token, `download/${songs[1]!.id}/stems`)).status).toBe(404);
  expect((await guest(token, `download/${crypto.randomUUID()}`)).status).toBe(404);

  // Paid, the paywall stays: the track links still stream only the MP3
  const still = await json<{ downloadUrl: string | null }>(await call(`/share/public/${shown.tracks[0]!.token}`));
  expect(still.downloadUrl).toBeNull();
});

test('cancelling restores the link; password and expiry of the link hold on the delivery routes', async () => {
  const { owner, songs, delivery, token } = await setup();
  const [link] = await db.select().from(projectShareLinks).where(eq(projectShareLinks.token, token));
  await db
    .update(projectShareLinks)
    .set({ passwordHash: await Bun.password.hash('geheim'), allowDownload: true })
    .where(eq(projectShareLinks.id, link!.id));

  const locked = await approve(token, songs[0]!.id, songs[0]!.v1.id);
  expect(locked.status).toBe(401);
  expect((await guest(token, `download/${songs[0]!.id}`)).status).toBe(401);
  const pw = { 'x-share-password': 'geheim' };
  expect((await guest(token, 'approve', { trackId: songs[0]!.id, versionId: songs[0]!.v1.id, guestName: 'Lena' }, pw)).status).toBe(200);
  expect((await guest(token, 'approve', { trackId: songs[0]!.id, versionId: songs[0]!.v1.id, guestName: 'Lena' }, { 'x-share-password': 'falsch' })).status).toBe(401);

  await db.update(projectShareLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(projectShareLinks.id, link!.id));
  expect((await guest(token, 'rounds', { trackId: songs[1]!.id, versionId: songs[1]!.v1.id, guestName: 'Lena' }, pw)).status).toBe(410);
  expect((await guest(token, `download/${songs[0]!.id}`, undefined, pw)).status).toBe(410);
  await db.update(projectShareLinks).set({ expiresAt: null }).where(eq(projectShareLinks.id, link!.id));

  // The studio changes the delivery while open, then cancels it
  const patched = await call(`/deliveries/${delivery.id}`, {
    method: 'PATCH',
    headers: owner.headers,
    body: { reference: 'KL-2026-07', tracks: [{ trackId: songs[0]!.id, priceCents: 15000 }] },
  });
  const changed = (await json<DeliveryResponse>(patched)).delivery;
  expect(changed.reference).toBe('KL-2026-07');
  expect(changed.tracks.map((t) => [t.trackId, t.priceCents, t.state])).toEqual([[songs[0]!.id, 15000, 'approved']]);

  const shown = await album(token, pw);
  expect(shown.delivery?.totals.totalCents).toBe(15000);
  expect((await call(`/share/project-link/${link!.id}`, { method: 'DELETE', headers: owner.headers })).status).toBe(409);
  const cancel = await call(`/deliveries/${delivery.id}/cancel`, { method: 'POST', headers: owner.headers, body: {} });
  expect((await json<DeliveryResponse>(cancel)).delivery.status).toBe('cancelled');

  const after = await album(token, pw);
  expect(after.delivery).toBeUndefined();
  expect(after.allowDownload).toBe(true);
  await db.update(shareLinks).set({ allowDownload: true }).where(eq(shareLinks.projectLinkId, link!.id));
  const track = await json<Record<string, unknown>>(await call(`/share/public/${after.tracks[0]!.token}`, { headers: pw }));
  expect(track.downloadUrl).toBe(`https://bucket.test/${songs[0]!.v1.originalFileKey}`);
  expect(track).not.toHaveProperty('processing');
  expect((await guest(token, 'approve', { trackId: songs[0]!.id, versionId: songs[0]!.v1.id, guestName: 'Lena' }, pw)).status).toBe(404);

  // A new delivery replaces the cancelled one
  const again = await createDelivery(owner, changed.projectId, [songs[1]!.id]);
  expect(again.linkToken).toBe(token);
  expect(await db.select().from(deliveries).where(and(eq(deliveries.projectLinkId, link!.id)))).toHaveLength(1);
});
