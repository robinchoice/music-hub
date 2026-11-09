import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb, magicLinks, migrateDb, planPayments, referrals, sessions, users } from '@music-hub/db';
import { PLAN_PRICES, REFERRAL_DAYS, type ReferralView } from '@music-hub/shared';
import { generateToken, hashToken } from './middleware/auth.js';
import { setStripeOps } from './lib/billing.js';
import { OPEN_REFERRALS_MAX, rewardReferrals } from './lib/referrals.js';
import { MAX_USERS, TEST_ACCOUNT_EMAIL } from './lib/users.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import type { AppEnv } from './types.js';

// Referral links, signing up through them and the free days. Runs against DATABASE_URL with rows of
// its own, which go again at the end; Stripe credits are faked.
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/auth', authRoutes)
  .route('/billing', billingRoutes);
const userIds: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

const person = async (values: Partial<typeof users.$inferInsert> = {}) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name: 'Referral test', ...values }).returning();
  userIds.push(u.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  return { ...u, headers: { authorization: `Bearer ${token}` } };
};
const userRow = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!;
const view = async (headers: Record<string, string>) => (await (await app.request('/billing/referrals', { headers })).json()) as ReferralView;
const post = (path: string, body: unknown) =>
  app.request(`/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': crypto.randomUUID() },
    body: JSON.stringify(body),
  });
const paid = (userId: string, paidAt: Date, values: Partial<typeof planPayments.$inferInsert> = {}) =>
  db.insert(planPayments).values({
    userId,
    provider: 'btcpay',
    externalId: `inv-${crypto.randomUUID()}`,
    plan: 'pro',
    period: 'month',
    amountCents: PLAN_PRICES.pro.month,
    status: 'paid',
    paidAt,
    ...values,
  });

const credits: string[] = [];
setStripeOps({
  async periodEnd() {
    return new Date();
  },
  async cancelAt() {},
  async cancelNow() {},
  async credit(customer, cents, key) {
    if (customer === 'cus_down') throw new Error('Stripe is down');
    credits.push(`${customer} ${cents} ${key}`);
  },
});

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
});

afterAll(async () => {
  setStripeOps(null);
  const emails = (await db.select({ email: users.email }).from(users).where(inArray(users.id, userIds))).map((u) => u.email);
  await db.delete(planPayments).where(inArray(planPayments.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  if (emails.length) await db.delete(magicLinks).where(inArray(magicLinks.email, emails));
  await db.$client.end();
});

test('only an account with a running plan gets a link, and it keeps its code', async () => {
  const free = await person();
  expect(await view(free.headers)).toEqual({ code: null, joined: 0, rewarded: 0 });

  const pro = await person({ plan: 'pro', planUntil: new Date(Date.now() + DAY) });
  const first = await view(pro.headers);
  expect(first.code).toMatch(/^[a-z2-9]{10}$/);
  expect((await view(pro.headers)).code).toBe(first.code);

  // Ended: no link to share, the code stays for when a plan runs again
  await db.update(users).set({ planUntil: new Date(Date.now() - DAY) }).where(eq(users.id, pro.id));
  expect((await view(pro.headers)).code).toBeNull();
  expect((await userRow(pro.id)).referralCode).toBe(first.code);
});

test('a referral link lets people in beyond MAX_USERS and records who referred them', async () => {
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const filled: string[] = [];
  try {
    const referrer = await person({ plan: 'pro', planUntil: new Date(Date.now() + DAY) });
    const { code } = await view(referrer.headers);
    // Fill Music Hub up to MAX_USERS with free accounts
    const [{ n }] = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM users
      WHERE email <> ${TEST_ACCOUNT_EMAIL} AND NOT (plan IS NOT NULL AND (plan_until IS NULL OR plan_until > now()))
    `);
    for (let i = n; i < MAX_USERS; i++) filled.push((await person()).id);

    const email = `test-${crypto.randomUUID()}@example.com`;
    expect((await post('/magic-link', { email })).status).toBe(403);
    expect((await post('/magic-link', { email, ref: 'unknown' })).status).toBe(403);
    expect((await post('/magic-link', { email, ref: code!.toUpperCase() })).status).toBe(200);
    const [link] = await db.select().from(magicLinks).where(eq(magicLinks.email, email));
    expect(link?.referralCode).toBe(code);

    // Opening the link creates the account and the referral
    const token = generateToken();
    await db.update(magicLinks).set({ token: await hashToken(token) }).where(eq(magicLinks.id, link!.id));
    const verify = await post('/verify', { token });
    expect(verify.status).toBe(200);
    const created = (await verify.json()) as { user: { id: string } };
    userIds.push(created.user.id);
    expect(await db.select().from(referrals).where(eq(referrals.referredId, created.user.id))).toMatchObject([{ referrerId: referrer.id, rewardedAt: null }]);
    expect(await view(referrer.headers)).toMatchObject({ joined: 1, rewarded: 0 });

    // Enough referred accounts that haven't paid yet: the link no longer gets past the limit
    for (let i = 1; i < OPEN_REFERRALS_MAX; i++) {
      const other = await person();
      await db.insert(referrals).values({ referredId: other.id, referrerId: referrer.id });
    }
    expect((await post('/register', { name: 'Late', email: `test-${crypto.randomUUID()}@example.com`, password: 'password1', ref: code })).status).toBe(403);
  } finally {
    log.mockRestore();
    await db.delete(users).where(inArray(users.id, filled));
  }
});

test('both sides get their free days once the payment is past the withdrawal period, once', async () => {
  const until = new Date(Date.now() + 10 * DAY);
  const referrer = await person({ plan: 'solo', planUntil: until });
  const referred = await person({ plan: 'pro', planUntil: new Date(Date.now() + 15 * DAY) });
  const recent = await person({ plan: 'pro', planUntil: new Date(Date.now() + 20 * DAY) });
  const withdrawn = await person({ plan: 'pro', planUntil: null });
  await db.insert(referrals).values([recent, withdrawn, referred].map((r) => ({ referredId: r.id, referrerId: referrer.id })));
  await paid(referred.id, new Date(Date.now() - 15 * DAY));
  await paid(recent.id, new Date(Date.now() - 10 * DAY));
  await paid(withdrawn.id, new Date(Date.now() - 20 * DAY), { withdrawnAt: new Date(Date.now() - 19 * DAY) });

  await rewardReferrals(db);
  await rewardReferrals(db);
  expect((await userRow(referrer.id)).planUntil).toEqual(new Date(until.getTime() + REFERRAL_DAYS.referrer * DAY));
  expect((await userRow(referred.id)).planUntil!.getTime()).toBeGreaterThan(Date.now() + 21.9 * DAY);
  expect((await userRow(recent.id)).planUntil!.getTime()).toBeLessThan(Date.now() + 20.1 * DAY);
  expect(await view(referrer.headers)).toMatchObject({ joined: 3, rewarded: 1 });
});

test('an ended plan starts again for the free days, a subscription gets credit instead', async () => {
  const lapsed = await person({ plan: 'pro', planUntil: new Date(Date.now() - 30 * DAY) });
  const subscriber = await person({ plan: 'pro', planUntil: new Date(Date.now() + 5 * DAY), stripeCustomerId: 'cus_ref', stripeSubscriptionId: 'sub_ref' });
  await db.insert(referrals).values({ referredId: subscriber.id, referrerId: lapsed.id });
  await paid(subscriber.id, new Date(Date.now() - 15 * DAY), { provider: 'stripe', stripeSubscriptionId: 'sub_ref' });

  await rewardReferrals(db);
  const row = await userRow(lapsed.id);
  expect(row.plan).toBe('pro');
  expect(row.planUntil!.getTime()).toBeGreaterThan(Date.now() + (REFERRAL_DAYS.referrer - 0.1) * DAY);
  expect(row.planUntil!.getTime()).toBeLessThan(Date.now() + (REFERRAL_DAYS.referrer + 0.1) * DAY);
  // 7 days of Pro is 7/30 of the monthly price, credited on Stripe; plan_until stays with Stripe
  expect(credits).toEqual([`cus_ref ${Math.round((PLAN_PRICES.pro.month * REFERRAL_DAYS.referred) / 30)} referral-${subscriber.id}-referred`]);
  expect((await userRow(subscriber.id)).planUntil!.getTime()).toBeLessThan(Date.now() + 5.1 * DAY);
});

test('a failing credit for one side is tried again without crediting the other side twice', async () => {
  credits.length = 0;
  const referrer = await person({ plan: 'pro', planUntil: new Date(Date.now() + 5 * DAY), stripeCustomerId: 'cus_ok', stripeSubscriptionId: 'sub_ok' });
  const referred = await person({ plan: 'pro', planUntil: new Date(Date.now() + 5 * DAY), stripeCustomerId: 'cus_down', stripeSubscriptionId: 'sub_down' });
  await db.insert(referrals).values({ referredId: referred.id, referrerId: referrer.id });
  await paid(referred.id, new Date(Date.now() - 15 * DAY), { provider: 'stripe', stripeSubscriptionId: 'sub_down' });

  await expect(rewardReferrals(db)).rejects.toThrow();
  await expect(rewardReferrals(db)).rejects.toThrow();
  expect(credits).toEqual([`cus_ok ${Math.round((PLAN_PRICES.pro.month * REFERRAL_DAYS.referrer) / 30)} referral-${referred.id}-referrer`]);
  expect(await db.select().from(referrals).where(eq(referrals.referredId, referred.id))).toMatchObject([{ rewardedAt: expect.any(Date), referredRewardedAt: null }]);
});
