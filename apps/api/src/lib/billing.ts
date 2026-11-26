import { createHmac, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';
import { and, desc, eq, gt, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { planPayments, users, type Database } from '@music-hub/db';
import {
  activePlan,
  formatEuro,
  pickLocale,
  PLAN_PERIODS,
  PLAN_PRICES,
  PLANS,
  type BillingMethod,
  type BillingView,
  type Plan,
  type PlanPaymentStatus,
  type PlanPeriod,
} from '@music-hub/shared';
import { PaymentServiceError, withTimeout } from './payments/errors.js';
import { storageOf } from './storage.js';
import { ADMIN_EMAILS } from './admin.js';
import { sendPlanAdminNotice, sendPlanCancelledEmail, sendPlanConfirmationEmail, sendPlanEndingEmail, sendPlanWithdrawnEmail } from '../services/email.js';

// Paying Music Hub for a plan. The rule is "paid until": every payment only moves users.plan_until,
// whichever way the money came. Stripe (card, PayPal, SEPA) renews a subscription and sends
// invoice.paid each period. Lightning goes through our BTCPay Server and pays one period ahead.
// Ending a plan deletes nothing: lib/storage.ts falls back to the account's own limit, so only new
// uploads beyond it stop. Money for plans goes to Pleasance; studios' deliveries never touch this.

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type User = typeof users.$inferSelect;

const PAYMENT_STATUSES: PlanPaymentStatus[] = ['pending', 'paid', 'expired'];

// A renewal Stripe retries for a few days doesn't cut the plan off at the period end
const STRIPE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
export const btcpayConfigured = () =>
  !!process.env.BTCPAY_URL && !!process.env.BTCPAY_STORE_ID && !!process.env.BTCPAY_API_KEY && !!process.env.BTCPAY_WEBHOOK_SECRET;

// Plans can be bought, so the terms (/agb) and the privacy section about payments are public
export const plansForSale = () => stripeConfigured() || btcpayConfigured();

const methodsConfigured = (): BillingMethod[] => [
  ...(stripeConfigured() ? (['stripe'] as const) : []),
  ...(btcpayConfigured() ? (['lightning'] as const) : []),
];

let stripeClient: Stripe | null = null;
const stripe = () => (stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY!));

// A calendar month or year later; 31 January plus a month is the end of February, not 3 March
export function addPeriod(date: Date, period: PlanPeriod) {
  const next = new Date(date);
  next.setUTCDate(1);
  if (period === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return next;
}

const WITHDRAWAL_MS = 14 * 24 * 60 * 60 * 1000;
// A checkout session lives a day, so a trial this long still ends after the 14 days for withdrawing
const MIN_TRIAL_MS = WITHDRAWAL_MS + 24 * 60 * 60 * 1000;

// A subscription bought while a plan with an end runs (a free month from an admin, Lightning, referral
// days) is free until that end and charges first then. Only when the 14 days for withdrawing are over
// by then, so a withdrawal never has to give back a charge. null: no trial.
export function trialEnd(user: Pick<User, 'plan' | 'planUntil' | 'stripeSubscriptionId'>, now = new Date()) {
  if (!activePlan(user, now) || !user.planUntil) return null;
  // Stripe takes whole seconds
  const end = new Date(Math.floor(user.planUntil.getTime() / 1000) * 1000);
  return end.getTime() - now.getTime() >= MIN_TRIAL_MS ? end : null;
}

// One mail per end date of a plan that no subscription continues, at least a day before the last
// moment a subscription can still start with a trial up to that end. So a free month doesn't simply
// run out. Claimed before sending, so several API instances send it once; a failed mail isn't retried.
const DAY_MS = 24 * 60 * 60 * 1000;
export async function remindEndingPlans(db: Database, now = new Date()) {
  if (!stripeConfigured()) return;
  const notYet = or(isNull(users.planRemindedUntil), ne(users.planRemindedUntil, users.planUntil));
  const due = await db
    .select()
    .from(users)
    .where(
      and(
        isNotNull(users.plan),
        isNull(users.stripeSubscriptionId),
        isNull(users.blockedAt),
        gt(users.planUntil, new Date(now.getTime() + MIN_TRIAL_MS + DAY_MS)),
        lte(users.planUntil, new Date(now.getTime() + MIN_TRIAL_MS + 3 * DAY_MS)),
        notYet,
      ),
    );
  for (const user of due) {
    const endsAt = user.planUntil!;
    const [claimed] = await db
      .update(users)
      .set({ planRemindedUntil: endsAt })
      .where(and(eq(users.id, user.id), eq(users.planUntil, endsAt), notYet))
      .returning({ id: users.id });
    if (!claimed) continue;
    const plan = PLANS.find((p) => p === user.plan) ?? 'pro';
    await sendPlanEndingEmail(user.email, { plan, endsAt, subscribeBy: new Date(endsAt.getTime() - MIN_TRIAL_MS) }, pickLocale(user.locale)).catch((err) =>
      console.error('[Billing] Ending mail failed:', err instanceof Error ? err.message : err),
    );
  }
}

// What the account may buy now. Without a running plan anything. While one with an end runs, one more
// period of the same plan by Lightning, or a subscription of it that starts charging at that end
// (trialEnd). A subscription, a plan without end (set by an admin) or a switch waits.
export function buyable(user: Pick<User, 'plan' | 'planUntil' | 'stripeSubscriptionId'>, now = new Date()) {
  const methods = methodsConfigured();
  // A subscription that Stripe still retries counts even after its paid time ran out
  if (user.stripeSubscriptionId) return [];
  const running = activePlan(user, now);
  if (!running) return PLANS.map((plan) => ({ plan, methods }));
  if (user.planUntil === null) return [];
  const extend = methods.filter((m) => m === 'lightning' || (m === 'stripe' && trialEnd(user, now)));
  return extend.length ? [{ plan: running, methods: extend }] : [];
}

export const mayBuy = (user: Parameters<typeof buyable>[0], plan: Plan, method: BillingMethod) =>
  buyable(user).some((b) => b.plan === plan && b.methods.includes(method));

const planName = (plan: Plan) => (plan === 'pro' ? 'Music Hub Pro' : 'Music Hub Studio');
const appUrl = () => process.env.APP_URL || 'http://localhost:5173';

// ---------- Stripe ----------

// Checkout for a subscription. The price comes from PLAN_PRICES, so nothing has to be set up in the
// Stripe dashboard besides the webhook. userId, plan and period ride along as subscription metadata
// and come back on every invoice.
export async function stripeCheckout(db: Database, user: User, plan: Plan, period: PlanPeriod) {
  try {
    let customer = user.stripeCustomerId;
    const trial = trialEnd(user);
    // While a plan with an end runs, a subscription only ever starts with a trial (buyable)
    if (activePlan(user) && !trial) throw new PaymentServiceError();
    if (!customer) {
      ({ id: customer } = await withTimeout(stripe().customers.create({ email: user.email, metadata: { userId: user.id } }), TIMEOUT_MS));
      await db.update(users).set({ stripeCustomerId: customer }).where(eq(users.id, user.id));
    }
    const session = await withTimeout(
      stripe().checkout.sessions.create({
        mode: 'subscription',
        customer,
        client_reference_id: user.id,
        locale: user.locale === 'en' ? 'en' : 'de',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: PLAN_PRICES[plan][period],
              recurring: { interval: period },
              product_data: { name: planName(plan) },
            },
          },
        ],
        subscription_data: {
          metadata: { userId: user.id, plan, period, consentAt: new Date().toISOString() },
          ...(trial ? { trial_end: trial.getTime() / 1000 } : {}),
        },
        success_url: `${appUrl()}/account?plan=paid`,
        cancel_url: `${appUrl()}/account`,
      }),
      TIMEOUT_MS,
    );
    if (!session.url) throw new PaymentServiceError();
    return session.url;
  } catch (err) {
    if (err instanceof PaymentServiceError) throw err;
    console.error('[Billing] Stripe checkout failed:', err instanceof Error ? err.message : err);
    throw new PaymentServiceError();
  }
}

// Stripe's own page to cancel, change the card or download invoices
export async function stripePortal(user: User) {
  if (!user.stripeCustomerId) return null;
  try {
    const session = await withTimeout(
      stripe().billingPortal.sessions.create({ customer: user.stripeCustomerId, return_url: `${appUrl()}/account` }),
      TIMEOUT_MS,
    );
    return session.url;
  } catch (err) {
    if (err instanceof PaymentServiceError) throw err;
    console.error('[Billing] Stripe portal failed:', err instanceof Error ? err.message : err);
    throw new PaymentServiceError();
  }
}

// null if the signature doesn't hold
export async function stripeEvent(payload: string, signature: string) {
  try {
    return await Stripe.webhooks.constructEventAsync(payload, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return null;
  }
}

// The time an invoice pays for, plus the grace for retried renewals. A trial's invoice (total 0) buys
// no time of its own, so it starts where the trial ends: withdrawing it takes back only the grace,
// and the first real invoice comes after it.
export function invoicePeriod(lines: { start: number; end: number }[], total: number) {
  const end = Math.max(...lines.map((l) => l.end)) * 1000;
  const periodStart = new Date(total === 0 ? end : Math.min(...lines.map((l) => l.start)) * 1000);
  return { periodStart, until: new Date(end + STRIPE_GRACE_MS) };
}

const metadataSchema = z.object({ userId: z.uuid(), plan: z.enum(PLANS), period: z.enum(PLAN_PERIODS), consentAt: z.iso.datetime().optional() });

// invoice.paid moves plan_until to the end of the paid period. customer.subscription.deleted only
// forgets the subscription: the plan runs until the date already paid for. Other events change nothing.
export async function handleStripeEvent(db: Database, event: Stripe.Event) {
  if (event.type === 'customer.subscription.deleted') {
    await db.update(users).set({ stripeSubscriptionId: null }).where(eq(users.stripeSubscriptionId, event.data.object.id));
    return;
  }
  if (event.type !== 'invoice.paid') return;
  const invoice = event.data.object;
  const details = invoice.parent?.subscription_details;
  const meta = metadataSchema.safeParse(details?.metadata);
  if (!details || !meta.success || !invoice.id) return;
  const subscriptionId = typeof details.subscription === 'string' ? details.subscription : details.subscription.id;
  const { periodStart, until } = invoicePeriod(invoice.lines.data.map((line) => line.period), invoice.total);
  const { userId, plan, period, consentAt } = meta.data;

  await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const [payment] = await tx
      .insert(planPayments)
      .values({
        userId,
        provider: 'stripe',
        externalId: invoice.id!,
        plan,
        period,
        amountCents: invoice.amount_paid,
        status: 'paid',
        paidAt: new Date(),
        stripeSubscriptionId: subscriptionId,
        consentedAt: consentAt ? new Date(consentAt) : null,
        periodStart,
      })
      .onConflictDoNothing()
      .returning({ id: planPayments.id });
    // Stripe delivers an event more than once now and then
    if (!payment) return;
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return;
    const booked = book(user, plan, until);
    const paidUntil = booked.planUntil;
    await tx
      .update(users)
      .set({
        ...booked,
        stripeSubscriptionId: subscriptionId,
        ...(typeof invoice.customer === 'string' ? { stripeCustomerId: invoice.customer } : {}),
      })
      .where(eq(users.id, userId));
    await tx.update(planPayments).set({ paidUntil }).where(eq(planPayments.id, payment.id));
  });
  // A new subscription is a new contract, renewals are not. Also when Stripe delivers again after a failed mail.
  if (invoice.billing_reason === 'subscription_create') await confirmContract(db, invoice.id);
}

// ---------- Lightning (BTCPay Server) ----------

// Greenfield API: https://docs.btcpayserver.org/API/Greenfield/v1/. Its checkout page stays private
// (BTCPay is only reachable over the tailnet), the account page shows the Lightning invoice itself.
export type BtcpayInvoice = { id: string; status: string };
export type BtcpayClient = {
  createInvoice(input: { amountCents: number; description: string }): Promise<BtcpayInvoice>;
  invoice(id: string): Promise<BtcpayInvoice>;
  // The BOLT11 invoice to pay it with
  lightningInvoice(id: string): Promise<string>;
};

const invoiceSchema = z.object({ id: z.string(), status: z.string() });
// BTCPay 2 names the method BTC-LN, 1.x BTC-LightningNetwork; both have the BOLT11 as destination
const paymentMethodsSchema = z.array(z.object({ destination: z.string().nullish() }));

const greenfield: BtcpayClient = {
  async createInvoice({ amountCents, description }) {
    return btcpayRequest(invoiceSchema, '/invoices', {
      method: 'POST',
      body: JSON.stringify({ amount: (amountCents / 100).toFixed(2), currency: 'EUR', metadata: { itemDesc: description } }),
    });
  },
  invoice: (id) => btcpayRequest(invoiceSchema, `/invoices/${encodeURIComponent(id)}`, { method: 'GET' }),
  async lightningInvoice(id) {
    const methods = await btcpayRequest(paymentMethodsSchema, `/invoices/${encodeURIComponent(id)}/payment-methods`, { method: 'GET' });
    const bolt11 = methods.map((m) => m.destination).find((d) => d && /^ln(bc|tb|bcrt)/i.test(d));
    if (!bolt11) {
      console.error('[Billing] BTCPay invoice without Lightning:', id);
      throw new PaymentServiceError();
    }
    return bolt11;
  },
};

async function btcpayRequest<T>(schema: z.ZodType<T>, path: string, init: RequestInit): Promise<T> {
  const url = `${process.env.BTCPAY_URL!.replace(/\/$/, '')}/api/v1/stores/${encodeURIComponent(process.env.BTCPAY_STORE_ID!)}${path}`;
  let body: unknown;
  try {
    const res = await fetch(url, {
      ...init,
      headers: { authorization: `token ${process.env.BTCPAY_API_KEY}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`BTCPay answered ${res.status}`);
    body = await res.json();
  } catch (err) {
    console.error('[Billing] BTCPay request failed:', err instanceof Error ? err.message : err);
    throw new PaymentServiceError();
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new PaymentServiceError();
  return parsed.data;
}

let btcpayClient: BtcpayClient | null = null;

/** Test hook: a fake BTCPay instead of the Greenfield API; null restores it. */
export function setBtcpayClient(next: BtcpayClient | null) {
  btcpayClient = next;
}
const btcpay = () => btcpayClient ?? greenfield;

// An invoice for one period. Paying it later adds the period to plan_until (markLightningPaid).
// checkout_url holds the lightning: link, the account page shows it as a QR code.
export async function lightningCheckout(db: Database, user: User, plan: Plan, period: PlanPeriod) {
  const amountCents = PLAN_PRICES[plan][period];
  const invoice = await btcpay().createInvoice({ amountCents, description: `${planName(plan)} · ${period === 'month' ? '1 month' : '1 year'}` });
  const url = `lightning:${await btcpay().lightningInvoice(invoice.id)}`;
  const [payment] = await db
    .insert(planPayments)
    .values({
      userId: user.id,
      provider: 'btcpay',
      externalId: invoice.id,
      plan,
      period,
      amountCents,
      checkoutUrl: url,
      consentedAt: new Date(),
    })
    .returning({ id: planPayments.id });
  return { url, paymentId: payment!.id };
}

// The BTCPay webhook body; its content only says which invoice to look at, the status comes from the API
const btcpayEventSchema = z.object({ invoiceId: z.string() });

// The signature is HMAC-SHA256 of the raw body with the webhook secret, header BTCPay-Sig: sha256=<hex>
export function btcpayEvent(payload: string, signature: string | undefined) {
  if (!signature?.startsWith('sha256=')) return null;
  const expected = createHmac('sha256', process.env.BTCPAY_WEBHOOK_SECRET!).update(payload).digest();
  const given = Buffer.from(signature.slice('sha256='.length), 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return null;
  }
  const parsed = btcpayEventSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

// Asks BTCPay how the invoice stands and books it. Settled counts from any status of ours: money that
// comes late still buys the period. Unknown invoices are ignored.
export async function checkLightningPayment(db: Database, externalId: string) {
  const [payment] = await db
    .select()
    .from(planPayments)
    .where(and(eq(planPayments.provider, 'btcpay'), eq(planPayments.externalId, externalId)))
    .limit(1);
  if (payment?.status === 'paid' && !payment.confirmedAt) await confirmContract(db, externalId);
  if (!payment || payment.status === 'paid') return;
  const { status } = await btcpay().invoice(externalId);
  if (status === 'Settled') await markLightningPaid(db, payment.id);
  else if (status === 'Expired' || status === 'Invalid')
    await db.update(planPayments).set({ status: 'expired' }).where(and(eq(planPayments.id, payment.id), eq(planPayments.status, 'pending')));
}

async function markLightningPaid(db: Database, paymentId: string) {
  const booked = await db.transaction(async (tx) => {
    const [first] = await tx.select({ userId: planPayments.userId }).from(planPayments).where(eq(planPayments.id, paymentId));
    if (!first?.userId) return null;
    await lockUser(tx, first.userId);
    const [payment] = await tx.select().from(planPayments).where(eq(planPayments.id, paymentId));
    const [user] = await tx.select().from(users).where(eq(users.id, first.userId));
    if (!payment || payment.status === 'paid' || !user) return null;
    const plan = PLANS.find((p) => p === payment.plan)!;
    const period = PLAN_PERIODS.find((p) => p === payment.period)!;
    const now = new Date();
    // The period starts where a running plan ends
    const periodStart = (activePlan(user, now) && user.planUntil) || now;
    const booked = book(user, plan, addPeriod(periodStart, period));
    const paidUntil = booked.planUntil;
    await tx.update(users).set(booked).where(eq(users.id, user.id));
    await tx.update(planPayments).set({ status: 'paid', paidAt: now, paidUntil, periodStart }).where(eq(planPayments.id, payment.id));
    return payment.externalId;
  });
  // Every Lightning payment is a contract of its own
  if (booked) await confirmContract(db, booked);
}

// ---------- Contracts: confirmation, cancelling, withdrawal ----------

// The Stripe calls behind cancelling and withdrawing, replaceable in tests
export type StripeOps = {
  periodEnd(subscriptionId: string): Promise<Date>;
  cancelAt(subscriptionId: string, at: Date | 'period_end'): Promise<void>;
  // Whether the subscription has ended at Stripe, where it can't be cancelled a second time
  ended(subscriptionId: string): Promise<boolean>;
  cancelNow(subscriptionId: string): Promise<void>;
  // Credit on the customer's balance, taken off the next invoices; the key makes a retry a no-op
  credit(customerId: string, cents: number, key: string): Promise<void>;
};

const stripeApi: StripeOps = {
  async periodEnd(id) {
    const sub = await withTimeout(stripe().subscriptions.retrieve(id), TIMEOUT_MS);
    return new Date(Math.max(...sub.items.data.map((item) => item.current_period_end)) * 1000);
  },
  async cancelAt(id, at) {
    await withTimeout(stripe().subscriptions.update(id, at === 'period_end' ? { cancel_at_period_end: true } : { cancel_at: Math.floor(at.getTime() / 1000) }), TIMEOUT_MS);
  },
  async ended(id) {
    return (await withTimeout(stripe().subscriptions.retrieve(id), TIMEOUT_MS)).status === 'canceled';
  },
  async cancelNow(id) {
    await withTimeout(stripe().subscriptions.cancel(id), TIMEOUT_MS);
  },
  async credit(customer, cents, key) {
    await withTimeout(
      stripe().customers.createBalanceTransaction(customer, { amount: -cents, currency: 'eur', description: 'Music Hub referral' }, { idempotencyKey: key }),
      TIMEOUT_MS,
    );
  },
};

let stripeOpsOverride: StripeOps | null = null;

/** Test hook: fake Stripe calls for cancelling and withdrawing; null restores them. */
export function setStripeOps(next: StripeOps | null) {
  stripeOpsOverride = next;
}
const stripeOps = () => stripeOpsOverride ?? stripeApi;

async function stripeCall<T>(call: () => Promise<T>) {
  try {
    return await call();
  } catch (err) {
    if (err instanceof PaymentServiceError) throw err;
    console.error('[Billing] Stripe request failed:', err instanceof Error ? err.message : err);
    throw new PaymentServiceError();
  }
}

// Ends the subscription at Stripe now. Stripe comes before our own booking, so nobody is charged for a
// contract we show as ended. If the booking fails after that, the next attempt finds the subscription
// ended and only catches up on our side.
async function endSubscription(subscriptionId: string) {
  await stripeCall(async () => {
    if (!(await stripeOps().ended(subscriptionId))) await stripeOps().cancelNow(subscriptionId);
  });
}

const periodMs = (from: Date, period: PlanPeriod) => addPeriod(from, period).getTime() - from.getTime();
// Where the time a payment bought starts; rows from before period_start fall back to the payment
const startOf = (p: Payment) => p.periodStart ?? p.paidAt ?? p.createdAt;
// A trial's invoice starts where the first real one does (invoicePeriod); the older one comes first
const byStart = (a: Payment, b: Payment) => startOf(a).getTime() - startOf(b).getTime() || a.createdAt.getTime() - b.createdAt.getTime();
const proRata = (amountCents: number, part: number, whole: number) => Math.round((amountCents * Math.max(0, Math.min(part, whole))) / whole);

type Payment = typeof planPayments.$inferSelect;

// A contract starts with a Lightning payment or the first invoice of a subscription. It can be
// withdrawn from for 14 days after that, renewals of a subscription can't.
function withdrawUntil(payment: Payment, all: Payment[]) {
  if (payment.status !== 'paid' || payment.withdrawnAt || !payment.paidAt) return null;
  if (payment.provider === 'stripe') {
    const first = all
      .filter((p) => p.stripeSubscriptionId && p.stripeSubscriptionId === payment.stripeSubscriptionId && p.status === 'paid')
      .sort(byStart)[0];
    if (first?.id !== payment.id) return null;
  }
  const until = new Date(payment.paidAt.getTime() + WITHDRAWAL_MS);
  return until > new Date() ? until : null;
}

// The confirmation on a durable medium (§ 312f BGB): order, the request to start right away, terms
// and cancellation notice, once per contract. A failed mail throws, so the webhook answers 500 and the
// provider delivers again; the payment stays booked meanwhile.
async function confirmContract(db: Database, externalId: string) {
  const [row] = await db
    .select({ payment: planPayments, email: users.email, locale: users.locale })
    .from(planPayments)
    .innerJoin(users, eq(users.id, planPayments.userId))
    .where(eq(planPayments.externalId, externalId));
  if (!row || row.payment.confirmedAt) return;
  const { payment } = row;
  const plan = PLANS.find((p) => p === payment.plan) ?? 'pro';
  const period = payment.period === 'year' ? 'year' : 'month';
  // A subscription with a trial: its invoice is 0, the price comes with the first charge
  const firstChargeAt = payment.provider === 'stripe' && payment.amountCents === 0 ? payment.periodStart : null;
  await sendPlanConfirmationEmail(
    row.email,
    {
      plan,
      period,
      amountCents: firstChargeAt ? PLAN_PRICES[plan][period] : payment.amountCents,
      firstChargeAt,
      method: payment.provider === 'stripe' ? 'stripe' : 'lightning',
      paidAt: payment.paidAt ?? new Date(),
      consentedAt: payment.consentedAt,
    },
    pickLocale(row.locale),
  );
  await db.update(planPayments).set({ confirmedAt: new Date() }).where(eq(planPayments.id, payment.id));
}

// "Verträge hier kündigen" (§ 312k BGB) for the running subscription. A monthly one and a yearly one
// in its first year end with the paid period. After the first renewal a yearly one ends a month from
// now at the latest, and the rest of the year is refunded by hand. A renewal Stripe still retries has
// already moved Stripe's period on without being paid: such a subscription ends now, nothing refunded.
export async function cancelPlan(db: Database, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const subscriptionId = user?.stripeSubscriptionId;
  if (!user || !subscriptionId) return null;
  const payments = await db
    .select()
    .from(planPayments)
    .where(and(eq(planPayments.userId, userId), eq(planPayments.stripeSubscriptionId, subscriptionId), eq(planPayments.status, 'paid')))
    .orderBy(planPayments.periodStart, planPayments.createdAt);
  const [first, last] = [payments[0], payments.at(-1)];
  const periodEnd = await stripeCall(() => stripeOps().periodEnd(subscriptionId));
  const now = new Date();
  // The invoice for Stripe's current period runs the plan at least to its end
  const paid = !!last?.paidUntil && last.paidUntil >= periodEnd;
  const renewedYear = last?.period === 'year' && !!first && now >= addPeriod(startOf(first), 'year');
  const monthAhead = addPeriod(now, 'month');
  const endsAt = !paid ? now : renewedYear && monthAhead < periodEnd ? monthAhead : periodEnd;
  if (paid) await stripeCall(() => stripeOps().cancelAt(subscriptionId, endsAt < periodEnd ? endsAt : 'period_end'));
  else await endSubscription(subscriptionId);
  const refundCents = paid && last && endsAt < periodEnd ? proRata(last.amountCents, periodEnd.getTime() - endsAt.getTime(), periodEnd.getTime() - startOf(last).getTime()) : 0;
  await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    await tx.update(users).set({ planUntil: endsAt, stripeSubscriptionId: null }).where(eq(users.id, userId));
    // The last invoice now pays up to the end, without the grace for renewals
    if (last) await tx.update(planPayments).set({ paidUntil: endsAt, ...(refundCents ? { refundCents } : {}) }).where(eq(planPayments.id, last.id));
  });
  const plan = PLANS.find((p) => p === user.plan) ?? 'pro';
  await sendPlanCancelledEmail(user.email, { plan, endsAt, refundCents }, pickLocale(user.locale)).catch((err) =>
    console.error('[Billing] Cancel mail failed:', err instanceof Error ? err.message : err),
  );
  if (refundCents) await notifyAdmins(`Kündigung eines Jahresabos (${user.email}): ${formatEuro(refundCents)} anteilig über Stripe erstatten, Abo ${subscriptionId}.`);
  return { endsAt, refundCents };
}

// "Vertrag widerrufen" (§ 356a BGB) within 14 days. The plan loses what this payment bought, the
// buyer pays only for the time used, the rest is refunded by hand.
export async function withdrawPayment(db: Database, userId: string, paymentId: string) {
  const all = await db.select().from(planPayments).where(eq(planPayments.userId, userId));
  const payment = all.find((p) => p.id === paymentId);
  if (!payment || !withdrawUntil(payment, all)) return null;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  if (payment.provider === 'stripe' && payment.stripeSubscriptionId) await endSubscription(payment.stripeSubscriptionId);
  const now = new Date();
  const refundCents = await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    // Read again under the lock: a withdrawal at the same time may have moved this payment's period
    const rows = await tx.select().from(planPayments).where(eq(planPayments.userId, userId));
    const withdrawing = rows.find((p) => p.id === payment.id);
    if (!withdrawing || withdrawing.withdrawnAt) return null;
    // The time this payment bought: one more Lightning period only starts where the plan ran to before,
    // and keeps its length when an earlier withdrawal moved it up
    const start = startOf(withdrawing);
    const paidUntil = withdrawing.paidUntil;
    const whole =
      withdrawing.provider === 'btcpay' && paidUntil ? paidUntil.getTime() - start.getTime() : periodMs(start, withdrawing.period === 'year' ? 'year' : 'month');
    const refund = proRata(withdrawing.amountCents, whole - (now.getTime() - start.getTime()), whole);
    // What is left of it comes off the plan. Periods bought on top of it move up into that gap, so
    // withdrawing one of them later counts its time from where it runs now.
    const unused = Math.max(0, (paidUntil?.getTime() ?? now.getTime()) - Math.max(now.getTime(), start.getTime()));
    const kept = rows.filter((p) => p.id !== withdrawing.id && p.status === 'paid' && !p.withdrawnAt);
    for (const p of kept) {
      if (!unused || !paidUntil || !p.periodStart || !p.paidUntil || p.periodStart < paidUntil) continue;
      p.periodStart = new Date(p.periodStart.getTime() - unused);
      p.paidUntil = new Date(p.paidUntil.getTime() - unused);
      await tx.update(planPayments).set({ periodStart: p.periodStart, paidUntil: p.paidUntil }).where(eq(planPayments.id, p.id));
    }
    const [current] = await tx.select().from(users).where(eq(users.id, userId));
    const until = current?.planUntil ? new Date(Math.max(now.getTime(), current.planUntil.getTime() - unused)) : null;
    // Payments for two plans run under the bigger one (book). Withdrawing the one that bought it falls
    // back to the biggest plan still paid for; a plan set by an admin stays.
    const paidPlans = kept.filter((p) => p.paidUntil && p.paidUntil > now).map((p) => p.plan);
    const plan =
      current && withdrawing.plan === current.plan && paidPlans.length && !paidPlans.includes(current.plan)
        ? PLANS.filter((p) => paidPlans.includes(p)).at(-1)
        : undefined;
    await tx
      .update(users)
      .set({
        planUntil: until,
        ...(plan ? { plan } : {}),
        // A subscription taken out after this one was cancelled stays
        ...(withdrawing.provider === 'stripe' && current?.stripeSubscriptionId === withdrawing.stripeSubscriptionId ? { stripeSubscriptionId: null } : {}),
      })
      .where(eq(users.id, userId));
    await tx.update(planPayments).set({ withdrawnAt: now, refundCents: refund }).where(eq(planPayments.id, withdrawing.id));
    return refund;
  });
  if (refundCents === null) return null;
  const plan = PLANS.find((p) => p === payment.plan) ?? 'pro';
  const method = payment.provider === 'stripe' ? 'stripe' : 'lightning';
  await sendPlanWithdrawnEmail(user.email, { plan, refundCents, method }, pickLocale(user.locale)).catch((err) =>
    console.error('[Billing] Withdrawal mail failed:', err instanceof Error ? err.message : err),
  );
  if (refundCents)
    await notifyAdmins(
      `Widerruf (${user.email}): ${formatEuro(refundCents)} binnen 14 Tagen erstatten, ${method === 'stripe' ? `über Stripe, Rechnung ${payment.externalId}` : `per Lightning, BTCPay-Rechnung ${payment.externalId}; die Person schickt dafür eine Lightning-Rechnung`}.`,
    );
  return { refundCents };
}

const notifyAdmins = (text: string) =>
  sendPlanAdminNotice([...ADMIN_EMAILS], text).catch((err) => console.error('[Billing] Admin notice failed:', err instanceof Error ? err.message : err));

// ---------- Free days ----------

// Free days of a plan, for referrals (lib/referrals.ts). A Stripe subscription charges on its own date
// anyway, so it gets them as credit on its next invoices, a day being a 30th of the monthly price.
// Otherwise they go on top of plan_until, or start now if the plan has ended, in the plan last held.
// A plan without end has nothing to add. key: unique per grant, so a retried Stripe credit counts once.
export async function grantFreeDays(tx: Tx, userId: string, days: number, key: string) {
  await lockUser(tx, userId);
  const [user] = await tx.select().from(users).where(eq(users.id, userId));
  if (!user) return;
  const running = activePlan(user);
  const plan = running ?? PLANS.find((p) => p === user.plan) ?? 'pro';
  const customer = user.stripeCustomerId;
  if (user.stripeSubscriptionId && customer) {
    const cents = Math.round((PLAN_PRICES[plan].month * days) / 30);
    await stripeCall(() => stripeOps().credit(customer, cents, key));
    return;
  }
  if (running && !user.planUntil) return;
  const from = running && user.planUntil ? user.planUntil : new Date();
  await tx.update(users).set({ plan, planUntil: new Date(from.getTime() + days * 24 * 60 * 60 * 1000) }).where(eq(users.id, userId));
}

// ---------- Shared ----------

const lockUser = (tx: Tx, userId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`plan:${userId}`}))`);

// A payment never takes anything away from a running plan, also when two checkouts for different
// plans both got paid: the bigger plan of the two runs to the later end.
function book(user: User, plan: Plan, until: Date): { plan: Plan; planUntil: Date | null } {
  const running = activePlan(user);
  if (!running) return { plan, planUntil: until };
  const bigger = PLANS.indexOf(running) > PLANS.indexOf(plan) ? running : plan;
  if (user.planUntil === null) return { plan: bigger, planUntil: null };
  return { plan: bigger, planUntil: user.planUntil > until ? user.planUntil : until };
}

// The account page. Open Lightning invoices of the last day are looked up first, in case a webhook
// got lost; a failing BTCPay leaves them as they are.
const paymentsOf = (db: Database, userId: string) =>
  db.select().from(planPayments).where(eq(planPayments.userId, userId)).orderBy(desc(planPayments.createdAt));

export async function billingView(db: Database, userId: string): Promise<BillingView> {
  let payments = await paymentsOf(db, userId);
  const open = payments.filter((p) => p.provider === 'btcpay' && p.status === 'pending' && Date.now() - p.createdAt.getTime() < 24 * 60 * 60 * 1000);
  if (open.length && btcpayConfigured()) {
    await Promise.all(open.map((p) => checkLightningPayment(db, p.externalId).catch(() => {})));
    payments = await paymentsOf(db, userId);
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const storage = await storageOf(db, userId);
  const plan = activePlan(user!);
  return {
    plan,
    planUntil: plan && user!.planUntil ? user!.planUntil.toISOString() : null,
    renews: !!user!.stripeSubscriptionId,
    canBuy: buyable(user!).filter((b) => b.methods.length),
    trialUntil: trialEnd(user!)?.toISOString() ?? null,
    storage: { usedBytes: storage.used, limitBytes: storage.limit },
    payments: payments.slice(0, 20).map((p) => ({
      withdrawUntil: withdrawUntil(p, payments)?.toISOString() ?? null,
      withdrawnAt: p.withdrawnAt?.toISOString() ?? null,
      refundCents: p.refundCents,
      id: p.id,
      method: p.provider === 'stripe' ? 'stripe' : 'lightning',
      plan: PLANS.find((x) => x === p.plan) ?? 'pro',
      period: p.period === 'year' ? 'year' : 'month',
      amountCents: p.amountCents,
      status: PAYMENT_STATUSES.find((x) => x === p.status) ?? 'pending',
      checkoutUrl: p.status === 'pending' ? p.checkoutUrl : null,
      paidUntil: p.paidUntil?.toISOString() ?? null,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}
