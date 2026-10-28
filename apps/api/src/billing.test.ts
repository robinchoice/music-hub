import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import Stripe from 'stripe';
import { eq, inArray } from 'drizzle-orm';
import { createDb, migrateDb, planPayments, sessions, users } from '@music-hub/db';
import { PLAN_PRICES, type BillingView } from '@music-hub/shared';
import { generateToken, hashToken } from './middleware/auth.js';
import { addPeriod, setBtcpayClient, type BtcpayInvoice } from './lib/billing.js';
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
    const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan: 'pro', period: 'month', method: 'stripe' }) });
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
  const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan: 'solo', period: 'month', method: 'lightning' }) });
  expect(res.status).toBe(409);

  await stripeWebhook({ id: 'evt_del', object: 'event', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', object: 'subscription' } } });
  expect(await userRow(p.id)).toMatchObject({ plan: 'pro', stripeSubscriptionId: null, planUntil: user.planUntil });
});

test('a settled Lightning invoice buys one period, the next one adds to it, an expired one buys nothing', async () => {
  const p = await person();
  const checkout = async () => {
    const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan: 'pro', period: 'month', method: 'lightning' }) });
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
  const switchTo = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan: 'solo', period: 'year', method: 'lightning' }) });
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
    const res = await app.request('/billing/checkout', { method: 'POST', headers: p.headers, body: JSON.stringify({ plan, period, method: 'lightning' }) });
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
