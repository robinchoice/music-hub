import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import Stripe from 'stripe';
import { eq, inArray, sql, type Column } from 'drizzle-orm';
import { createDb, migrateDb, planPayments, sessions, users } from '@music-hub/db';
import { PLAN_PRICES, type BillingView } from '@music-hub/shared';
import { generateToken, hashToken } from './middleware/auth.js';
import { addPeriod, setBtcpayClient, setStripeOps, type BtcpayInvoice } from './lib/billing.js';
import { publicPages } from './lib/public-pages.js';
import { billingRoutes } from './routes/billing.js';
import type { AppEnv } from './types.js';

// Plans paid through Stripe and BTCPay, both faked: Stripe only through signed webhooks, BTCPay through
// setBtcpayClient. Runs against DATABASE_URL with rows of its own, which go again at the end.
const env = {
  STRIPE_SECRET_KEY: 'sk_test_music_hub',
  STRIPE_WEBHOOK_SECRET: 'whsec_music_hub',
  BTCPAY_URL: 'https://btcpay.example.com',
  BTCPAY_STORE_ID: 'store',
  BTCPAY_API_KEY: 'key',
  BTCPAY_WEBHOOK_SECRET: 'btcpay-secret',
};
const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));

const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/billing', billingRoutes);
const userIds: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

const person = async (values: Partial<typeof users.$inferInsert> = {}) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Billing test', ...values }).returning();
  userIds.push(u.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  return { id: u.id, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
};
const userRow = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

// BTCPay that answers with whatever status the test sets
const invoices = new Map<string, BtcpayInvoice>();
setBtcpayClient({
  async createInvoice({ amountCents }) {
    const id = `inv-${crypto.randomUUID()}`;
    const invoice = { id, checkoutLink: `https://btcpay.example.com/i/${id}?amount=${amountCents}`, status: 'New' };
    invoices.set(id, invoice);
    return invoice;
  },
  async invoice(id) {
    const invoice = invoices.get(id);
    if (!invoice) throw new Error('unknown invoice');
    return invoice;
  },
});

const stripeWebhook = async (event: object, secret = env.STRIPE_WEBHOOK_SECRET) => {
  const payload = JSON.stringify(event);
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
  return app.request('/billing/stripe', { method: 'POST', body: payload, headers: { 'stripe-signature': signature } });
};
const btcpayWebhook = (invoiceId: string, secret = env.BTCPAY_WEBHOOK_SECRET) => {
  const payload = JSON.stringify({ type: 'InvoiceSettled', invoiceId, storeId: 'store' });
  const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  return app.request('/billing/btcpay', { method: 'POST', body: payload, headers: { 'btcpay-sig': signature } });
};
const invoicePaid = (userId: string, id: string, periodEnd: Date, subscription = 'sub_1') => ({
  id: `evt_${id}`,
  object: 'event',
  type: 'invoice.paid',
  data: {
    object: {
      id,
      object: 'invoice',
      customer: 'cus_1',
      amount_paid: PLAN_PRICES.pro.month,
      lines: { data: [{ period: { start: Math.floor(Date.now() / 1000), end: Math.floor(periodEnd.getTime() / 1000) } }] },
      parent: { type: 'subscription_details', subscription_details: { subscription, metadata: { userId, plan: 'pro', period: 'month' } } },
    },
  },
});

beforeAll(async () => {
  Object.assign(process.env, env);
  await migrateDb(process.env.DATABASE_URL!);
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setBtcpayClient(null);
  await db.delete(planPayments).where(inArray(planPayments.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('without keys there is nothing to buy and the webhooks are gone', async () => {
  const p = await person();
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.BTCPAY_URL;
  try {
    const view = (await (await app.request('/billing', { headers: p.headers })).json()) as BillingView;
    expect(view).toMatchObject({ plan: null, renews: false, canBuy: [] });
    const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan: 'pro', period: 'month', method: 'stripe', consent: true }) });
    expect(res.status).toBe(503);
    expect((await stripeWebhook({ type: 'invoice.paid' })).status).toBe(404);
  } finally {
    Object.assign(process.env, env);
  }
});

test('a paid Stripe invoice runs the plan to its period end plus grace, once, and cancelling keeps what is paid', async () => {
  const p = await person();
  const end = new Date(Date.now() + 30 * DAY);
  expect((await stripeWebhook(invoicePaid(p.id, 'in_a', end), 'whsec_wrong')).status).toBe(400);
  expect((await userRow(p.id)).plan).toBeNull();

  expect((await stripeWebhook(invoicePaid(p.id, 'in_a', end))).status).toBe(200);
  expect((await stripeWebhook(invoicePaid(p.id, 'in_a', end))).status).toBe(200);
  const user = await userRow(p.id);
  expect(user).toMatchObject({ plan: 'pro', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1' });
  expect(Math.abs(user.planUntil!.getTime() - (end.getTime() + 3 * DAY))).toBeLessThan(1000);
  expect(await db.select().from(planPayments).where(eq(planPayments.userId, p.id))).toHaveLength(1);

  // Nothing more to buy while the subscription runs
  const view = (await (await app.request('/billing', { headers: p.headers })).json()) as BillingView;
  expect(view).toMatchObject({ plan: 'pro', renews: true, canBuy: [] });
  expect(view.payments).toMatchObject([{ method: 'stripe', status: 'paid', amountCents: PLAN_PRICES.pro.month }]);
  const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan: 'solo', period: 'month', method: 'lightning', consent: true }) });
  expect(res.status).toBe(409);

  await stripeWebhook({ id: 'evt_del', object: 'event', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', object: 'subscription' } } });
  expect(await userRow(p.id)).toMatchObject({ plan: 'pro', stripeSubscriptionId: null, planUntil: user.planUntil });
});

test('a settled Lightning invoice buys one period, the next one adds to it, an expired one buys nothing', async () => {
  const p = await person();
  const checkout = async () => {
    const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan: 'pro', period: 'month', method: 'lightning', consent: true }) });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    return [...invoices.values()].find((i) => i.checkoutLink === url)!;
  };

  const first = await checkout();
  expect(first.checkoutLink).toContain(`amount=${PLAN_PRICES.pro.month}`);
  expect((await btcpayWebhook(first.id, 'wrong')).status).toBe(400);
  // Not paid yet: the webhook asks BTCPay and changes nothing
  expect((await btcpayWebhook(first.id)).status).toBe(200);
  expect((await userRow(p.id)).plan).toBeNull();

  first.status = 'Settled';
  const before = new Date();
  await btcpayWebhook(first.id);
  await btcpayWebhook(first.id);
  const once = await userRow(p.id);
  expect(once.plan).toBe('pro');
  expect(Math.abs(once.planUntil!.getTime() - addPeriod(before, 'month').getTime())).toBeLessThan(5000);

  // One more month of the running plan by Lightning, a switch has to wait
  const view = (await (await app.request('/billing', { headers: p.headers })).json()) as BillingView;
  expect(view.canBuy).toEqual([{ plan: 'pro', methods: ['lightning'] }]);
  const switchTo = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan: 'solo', period: 'year', method: 'lightning', consent: true }) });
  expect(switchTo.status).toBe(409);

  const second = await checkout();
  second.status = 'Settled';
  // The account page finds it paid even without a webhook
  const paid = (await (await app.request('/billing', { headers: p.headers })).json()) as BillingView;
  expect(paid.payments.map((x) => x.status)).toEqual(['paid', 'paid']);
  expect((await userRow(p.id)).planUntil!.getTime()).toBe(addPeriod(once.planUntil!, 'month').getTime());

  const third = await checkout();
  third.status = 'Expired';
  await btcpayWebhook(third.id);
  const [expired] = await db.select().from(planPayments).where(eq(planPayments.externalId, third.id));
  expect(expired.status).toBe('expired');
  // Money that comes late still counts
  third.status = 'Settled';
  await btcpayWebhook(third.id);
  expect((await db.select().from(planPayments).where(eq(planPayments.externalId, third.id)))[0].status).toBe('paid');
});

test('a plan set by an admin without end leaves nothing to buy', async () => {
  const p = await person({ plan: 'solo' });
  const view = (await (await app.request('/billing', { headers: p.headers })).json()) as BillingView;
  expect(view).toMatchObject({ plan: 'solo', planUntil: null, canBuy: [] });
  expect((await userRow(p.id)).planUntil).toBeNull();
  expect(addPeriod(new Date('2026-01-15T00:00:00Z'), 'year').toISOString()).toBe('2027-01-15T00:00:00.000Z');
  expect(addPeriod(new Date('2027-01-31T10:00:00Z'), 'month').toISOString()).toBe('2027-02-28T10:00:00.000Z');
  expect(addPeriod(new Date('2028-02-29T10:00:00Z'), 'year').toISOString()).toBe('2029-02-28T10:00:00.000Z');
});

test('two open invoices for different plans, both paid: the bigger plan runs to the later end', async () => {
  const p = await person();
  const buy = async (plan: string, period: string) => {
    const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan, period, method: 'lightning', consent: true }) });
    const { url } = (await res.json()) as { url: string };
    return [...invoices.values()].find((i) => i.checkoutLink === url)!;
  };
  const studio = await buy('solo', 'year');
  const pro = await buy('pro', 'month');
  studio.status = 'Settled';
  await btcpayWebhook(studio.id);
  const yearEnd = (await userRow(p.id)).planUntil!;
  pro.status = 'Settled';
  await btcpayWebhook(pro.id);
  expect(await userRow(p.id)).toMatchObject({ plan: 'solo', planUntil: addPeriod(yearEnd, 'month') });
});

// Stripe for cancelling and withdrawing: remembers the calls, the period ends where the test says
const stripeCalls: string[] = [];
let stripePeriodEnd = new Date();
setStripeOps({
  async periodEnd() {
    return stripePeriodEnd;
  },
  async cancelAt(id, at) {
    stripeCalls.push(`cancelAt ${id} ${at === 'period_end' ? at : at.toISOString().slice(0, 10)}`);
  },
  async cancelNow(id) {
    stripeCalls.push(`cancelNow ${id}`);
  },
});

const subscriptionInvoice = (userId: string, id: string, subscription: string, period: 'month' | 'year', end: Date, reason: string) => ({
  id: `evt_${id}`,
  object: 'event',
  type: 'invoice.paid',
  data: {
    object: {
      id,
      object: 'invoice',
      customer: 'cus_2',
      billing_reason: reason,
      amount_paid: PLAN_PRICES.pro[period],
      lines: { data: [{ period: { start: Math.floor(Date.now() / 1000), end: Math.floor(end.getTime() / 1000) } }] },
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription, metadata: { userId, plan: 'pro', period, consentAt: new Date().toISOString() } },
      },
    },
  },
});

test('no checkout without the express request to start right away', async () => {
  const p = await person();
  const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan: 'pro', period: 'month', method: 'lightning' }) });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { code: string }).code).toBe('consent_required');
});

test('the terms and the privacy section about payments are public only while plans are for sale', async () => {
  expect(((await (await app.request('/billing/offer')).json()) as { forSale: boolean }).forSale).toBe(true);
  expect(publicPages('de').map((page) => page.path)).toContain('/agb');
  expect(publicPages('en').find((page) => page.path === '/datenschutz')?.body).toContain('## 13. Plans and payments');
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.BTCPAY_URL;
  try {
    expect(((await (await app.request('/billing/offer')).json()) as { forSale: boolean }).forSale).toBe(false);
    expect(publicPages('de').map((page) => page.path)).not.toContain('/agb');
    expect(publicPages('de').find((page) => page.path === '/datenschutz')?.body).not.toContain('Tarife und Zahlungen');
  } finally {
    Object.assign(process.env, env);
  }
});

test('cancelling a monthly subscription ends it with the paid period and nothing is refunded', async () => {
  const p = await person();
  stripePeriodEnd = new Date(Date.now() + 20 * DAY);
  await stripeWebhook(subscriptionInvoice(p.id, `in_m_${p.id}`, `sub_m_${p.id}`, 'month', stripePeriodEnd, 'subscription_create'));
  expect((await userRow(p.id)).stripeSubscriptionId).toBe(`sub_m_${p.id}`);

  const res = await app.request('/billing/cancel', { method: 'POST', headers: p.headers });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ endsAt: stripePeriodEnd.toISOString(), refundCents: 0 });
  expect(stripeCalls).toContain(`cancelAt sub_m_${p.id} period_end`);
  expect(await userRow(p.id)).toMatchObject({ plan: 'pro', planUntil: stripePeriodEnd, stripeSubscriptionId: null });
  // Nothing left to cancel
  expect((await app.request('/billing/cancel', { method: 'POST', headers: p.headers })).status).toBe(404);
});

test('after its first renewal a yearly subscription ends a month from now, the rest is refunded pro rata', async () => {
  const p = await person();
  const sub = `sub_y_${p.id}`;
  stripePeriodEnd = new Date(Date.now() + 300 * DAY);
  await stripeWebhook(subscriptionInvoice(p.id, `in_y1_${p.id}`, sub, 'year', new Date(Date.now() - 65 * DAY), 'subscription_create'));
  await stripeWebhook(subscriptionInvoice(p.id, `in_y2_${p.id}`, sub, 'year', stripePeriodEnd, 'subscription_cycle'));
  // The first year started more than a year ago, the renewal 65 days ago
  await db.update(planPayments).set({ periodStart: new Date(Date.now() - 430 * DAY) }).where(eq(planPayments.externalId, `in_y1_${p.id}`));
  await db.update(planPayments).set({ periodStart: new Date(Date.now() - 65 * DAY) }).where(eq(planPayments.externalId, `in_y2_${p.id}`));

  const res = await app.request('/billing/cancel', { method: 'POST', headers: p.headers });
  const { endsAt, refundCents } = (await res.json()) as { endsAt: string; refundCents: number };
  expect(endsAt.slice(0, 10)).toBe(addPeriod(new Date(), 'month').toISOString().slice(0, 10));
  expect(stripeCalls).toContain(`cancelAt ${sub} ${endsAt.slice(0, 10)}`);
  // Of 365 days paid, about 270 are left over
  expect(refundCents).toBeGreaterThan(6300);
  expect(refundCents).toBeLessThan(6900);
  expect((await userRow(p.id)).planUntil!.toISOString()).toBe(endsAt);
});

test('within 14 days a new subscription can be withdrawn from, its renewal not, and the plan ends at once', async () => {
  const p = await person();
  const sub = `sub_w_${p.id}`;
  await stripeWebhook(subscriptionInvoice(p.id, `in_w1_${p.id}`, sub, 'month', new Date(Date.now() + 30 * DAY), 'subscription_create'));
  const view = (await (await app.request('/billing', { headers: p.headers })).json()) as BillingView;
  const [payment] = view.payments;
  expect(payment.withdrawUntil).not.toBeNull();

  const res = await app.request('/billing/withdraw', { method: 'POST', headers: p.headers, body: JSON.stringify({ paymentId: payment.id }) });
  expect(res.status).toBe(200);
  // Withdrawn on the first day: almost everything comes back
  expect(((await res.json()) as { refundCents: number }).refundCents).toBeGreaterThan(PLAN_PRICES.pro.month - 10);
  expect(stripeCalls).toContain(`cancelNow ${sub}`);
  const user = await userRow(p.id);
  expect(user.stripeSubscriptionId).toBeNull();
  expect(user.planUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  expect((await app.request('/billing/withdraw', { method: 'POST', headers: p.headers, body: JSON.stringify({ paymentId: payment.id }) })).status).toBe(404);

  // A renewal is no new contract
  const q = await person();
  await stripeWebhook(subscriptionInvoice(q.id, `in_r1_${q.id}`, `sub_r_${q.id}`, 'month', new Date(Date.now() + DAY), 'subscription_create'));
  await stripeWebhook(subscriptionInvoice(q.id, `in_r2_${q.id}`, `sub_r_${q.id}`, 'month', new Date(Date.now() + 31 * DAY), 'subscription_cycle'));
  await db.update(planPayments).set({ paidAt: new Date(Date.now() - 29 * DAY), periodStart: new Date(Date.now() - 29 * DAY) }).where(eq(planPayments.externalId, `in_r1_${q.id}`));
  const renewed = (await (await app.request('/billing', { headers: q.headers })).json()) as BillingView;
  expect(renewed.payments.map((x) => x.withdrawUntil)).toEqual([null, null]);
});

test('withdrawing from one more Lightning month takes that month back and refunds it whole', async () => {
  const p = await person();
  const pay = async () => {
    const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan: 'pro', period: 'month', method: 'lightning', consent: true }) });
    const { url } = (await res.json()) as { url: string };
    const invoice = [...invoices.values()].find((i) => i.checkoutLink === url)!;
    invoice.status = 'Settled';
    await btcpayWebhook(invoice.id);
    return invoice;
  };
  await pay();
  const firstEnd = (await userRow(p.id)).planUntil!;
  const second = await pay();
  const [payment] = await db.select().from(planPayments).where(eq(planPayments.externalId, second.id));
  expect(payment.consentedAt).not.toBeNull();

  const res = await app.request('/billing/withdraw', { method: 'POST', headers: p.headers, body: JSON.stringify({ paymentId: payment.id }) });
  expect(((await res.json()) as { refundCents: number }).refundCents).toBe(PLAN_PRICES.pro.month);
  expect((await userRow(p.id)).planUntil).toEqual(firstEnd);
  // Twice at the same time books it once
  expect((await app.request('/billing/withdraw', { method: 'POST', headers: p.headers, body: JSON.stringify({ paymentId: payment.id }) })).status).toBe(404);
});

test('withdrawing from a subscription keeps a Lightning month bought on top, and every contract is confirmed once', async () => {
  const p = await person();
  const sub = `sub_l_${p.id}`;
  const end = new Date(Date.now() + 30 * DAY);
  await stripeWebhook(subscriptionInvoice(p.id, `in_l_${p.id}`, sub, 'month', end, 'subscription_create'));
  await stripeWebhook(subscriptionInvoice(p.id, `in_l_${p.id}`, sub, 'month', end, 'subscription_create'));
  const [first] = await db.select().from(planPayments).where(eq(planPayments.externalId, `in_l_${p.id}`));
  expect(first.confirmedAt).not.toBeNull();
  stripePeriodEnd = end;
  await app.request('/billing/cancel', { method: 'POST', headers: p.headers });
  const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan: 'pro', period: 'month', method: 'lightning', consent: true }) });
  const { url } = (await res.json()) as { url: string };
  const invoice = [...invoices.values()].find((i) => i.checkoutLink === url)!;
  invoice.status = 'Settled';
  await btcpayWebhook(invoice.id);
  const extended = (await userRow(p.id)).planUntil!;

  await app.request('/billing/withdraw', { method: 'POST', headers: p.headers, body: JSON.stringify({ paymentId: first.id }) });
  // Only the unused rest of the subscription month comes off, the Lightning month stays
  const left = (await userRow(p.id)).planUntil!.getTime() - Date.now();
  expect(left).toBeGreaterThan(extended.getTime() - end.getTime() - DAY);
  expect((await db.select().from(planPayments).where(eq(planPayments.externalId, invoice.id)))[0].confirmedAt).not.toBeNull();
});

// Moves everything about the account's plan the given days into the past, as if that time went by
const daysPass = async (userId: string, days: number) => {
  const back = (column: Column) => sql`${column} - make_interval(days => ${days})`;
  await db
    .update(planPayments)
    .set({ periodStart: back(planPayments.periodStart), paidUntil: back(planPayments.paidUntil), paidAt: back(planPayments.paidAt), createdAt: back(planPayments.createdAt), withdrawnAt: back(planPayments.withdrawnAt) })
    .where(eq(planPayments.userId, userId));
  await db.update(users).set({ planUntil: sql`${users.planUntil} - make_interval(days => ${days})` }).where(eq(users.id, userId));
};
const payLightning = async (p: Awaited<ReturnType<typeof person>>, plan: 'pro' | 'solo', period: 'month' | 'year' = 'month') => {
  const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan, period, method: 'lightning', consent: true }) });
  const { url } = (await res.json()) as { url: string };
  const invoice = [...invoices.values()].find((i) => i.checkoutLink === url)!;
  invoice.status = 'Settled';
  await btcpayWebhook(invoice.id);
  return (await db.select().from(planPayments).where(eq(planPayments.externalId, invoice.id)))[0];
};
const withdraw = async (p: Awaited<ReturnType<typeof person>>, paymentId: string) => {
  const res = await app.request('/billing/withdraw', { method: 'POST', headers: p.headers, body: JSON.stringify({ paymentId }) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { refundCents: number }).refundCents;
};

test('withdrawing from prepaid Lightning months moves the later ones up, so a later withdrawal costs none of their time', async () => {
  const p = await person();
  const [a, b, c] = [await payLightning(p, 'pro'), await payLightning(p, 'pro'), await payLightning(p, 'pro')];
  await withdraw(p, a.id);
  // b runs now, nine days of it get used
  await daysPass(p.id, 9);
  const refund = await withdraw(p, b.id);
  // b keeps the length it was bought with, nine days of it are paid for
  const bought = b.paidUntil!.getTime() - b.periodStart!.getTime();
  expect(Math.abs(refund - (PLAN_PRICES.pro.month * (bought - 9 * DAY)) / bought)).toBeLessThan(1);
  // c keeps its whole month, from now
  const [last] = await db.select().from(planPayments).where(eq(planPayments.id, c.id));
  const length = addPeriod(c.periodStart!, 'month').getTime() - c.periodStart!.getTime();
  expect(Math.abs(last.periodStart!.getTime() - Date.now())).toBeLessThan(60_000);
  expect(Math.abs((await userRow(p.id)).planUntil!.getTime() - (Date.now() + length))).toBeLessThan(DAY);
  expect((await userRow(p.id)).planUntil).toEqual(last.paidUntil);
});

test('withdrawing the Studio payment of Studio and Pro paid together leaves Pro', async () => {
  const p = await person();
  const buy = async (plan: string) => {
    const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan, period: 'month', method: 'lightning', consent: true }) });
    const { url } = (await res.json()) as { url: string };
    return [...invoices.values()].find((i) => i.checkoutLink === url)!;
  };
  const studio = await buy('solo');
  const pro = await buy('pro');
  for (const invoice of [studio, pro]) {
    invoice.status = 'Settled';
    await btcpayWebhook(invoice.id);
  }
  expect((await userRow(p.id)).plan).toBe('solo');
  const [paid] = await db.select().from(planPayments).where(eq(planPayments.externalId, studio.id));
  await withdraw(p, paid.id);
  const [proPayment] = await db.select().from(planPayments).where(eq(planPayments.externalId, pro.id));
  expect(await userRow(p.id)).toMatchObject({ plan: 'pro', planUntil: proPayment.paidUntil });
  expect(Math.abs(proPayment.periodStart!.getTime() - Date.now())).toBeLessThan(60_000);
});

test('cancelling while Stripe retries a failed renewal ends the plan now, without the unpaid period or a refund', async () => {
  for (const period of ['month', 'year'] as const) {
    const p = await person();
    const sub = `sub_f_${p.id}`;
    // The paid period ended yesterday, Stripe's current one is the renewal it couldn't collect
    await stripeWebhook(subscriptionInvoice(p.id, `in_f1_${p.id}`, sub, period, new Date(Date.now() - 400 * DAY), 'subscription_create'));
    await stripeWebhook(subscriptionInvoice(p.id, `in_f2_${p.id}`, sub, period, new Date(Date.now() - DAY), 'subscription_cycle'));
    const days = period === 'year' ? 366 : 31;
    await db.update(planPayments).set({ periodStart: new Date(Date.now() - 2 * days * DAY) }).where(eq(planPayments.externalId, `in_f1_${p.id}`));
    await db.update(planPayments).set({ periodStart: new Date(Date.now() - days * DAY) }).where(eq(planPayments.externalId, `in_f2_${p.id}`));
    stripePeriodEnd = addPeriod(new Date(Date.now() - DAY), period);
    const res = await app.request('/billing/cancel', { method: 'POST', headers: p.headers });
    const { endsAt, refundCents } = (await res.json()) as { endsAt: string; refundCents: number };
    expect(refundCents).toBe(0);
    expect(new Date(endsAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(stripeCalls).toContain(`cancelNow ${sub}`);
    expect((await userRow(p.id)).planUntil!.getTime()).toBeLessThanOrEqual(Date.now());
  }
});
