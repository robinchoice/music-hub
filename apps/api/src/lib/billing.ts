import { createHmac, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { planPayments, users, type Database } from '@music-hub/db';
import {
  activePlan,
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

const methodsConfigured = (): BillingMethod[] => [
  ...(stripeConfigured() ? (['stripe'] as const) : []),
  ...(btcpayConfigured() ? (['lightning'] as const) : []),
];

let stripeClient: Stripe | null = null;
const stripe = () => (stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY!));

export function addPeriod(date: Date, period: PlanPeriod) {
  const next = new Date(date);
  if (period === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

// What the account may buy now. Without a running plan anything. While one runs, only one more period
// of the same plan by Lightning; a subscription, a plan without end (set by an admin) or a switch waits.
export function buyable(user: Pick<User, 'plan' | 'planUntil' | 'stripeSubscriptionId'>, now = new Date()) {
  const methods = methodsConfigured();
  const running = activePlan(user, now);
  if (!running) return PLANS.map((plan) => ({ plan, methods }));
  if (user.stripeSubscriptionId || user.planUntil === null || !methods.includes('lightning')) return [];
  return [{ plan: running, methods: ['lightning'] as BillingMethod[] }];
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
        subscription_data: { metadata: { userId: user.id, plan, period } },
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

const metadataSchema = z.object({ userId: z.uuid(), plan: z.enum(PLANS), period: z.enum(PLAN_PERIODS) });

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
  const periodEnd = Math.max(...invoice.lines.data.map((line) => line.period.end));
  const until = new Date(periodEnd * 1000 + STRIPE_GRACE_MS);
  const { userId, plan, period } = meta.data;

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
      })
      .onConflictDoNothing()
      .returning({ id: planPayments.id });
    // Stripe delivers an event more than once now and then
    if (!payment) return;
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return;
    const paidUntil = laterEnd(user, plan, until);
    await tx
      .update(users)
      .set({
        plan,
        planUntil: paidUntil,
        stripeSubscriptionId: subscriptionId,
        ...(typeof invoice.customer === 'string' ? { stripeCustomerId: invoice.customer } : {}),
      })
      .where(eq(users.id, userId));
    await tx.update(planPayments).set({ paidUntil }).where(eq(planPayments.id, payment.id));
  });
}

// ---------- Lightning (BTCPay Server) ----------

// Greenfield API: https://docs.btcpayserver.org/API/Greenfield/v1/
export type BtcpayInvoice = { id: string; checkoutLink: string; status: string };
export type BtcpayClient = {
  createInvoice(input: { amountCents: number; description: string; redirectUrl: string }): Promise<BtcpayInvoice>;
  invoice(id: string): Promise<BtcpayInvoice>;
};

const invoiceSchema = z.object({ id: z.string(), checkoutLink: z.string(), status: z.string() });

const greenfield: BtcpayClient = {
  async createInvoice({ amountCents, description, redirectUrl }) {
    return btcpayRequest('/invoices', {
      method: 'POST',
      body: JSON.stringify({
        amount: (amountCents / 100).toFixed(2),
        currency: 'EUR',
        metadata: { itemDesc: description },
        checkout: { redirectURL: redirectUrl, redirectAutomatically: true },
      }),
    });
  },
  invoice: (id) => btcpayRequest(`/invoices/${encodeURIComponent(id)}`, { method: 'GET' }),
};

async function btcpayRequest(path: string, init: RequestInit) {
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
  const parsed = invoiceSchema.safeParse(body);
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
export async function lightningCheckout(db: Database, user: User, plan: Plan, period: PlanPeriod) {
  const amountCents = PLAN_PRICES[plan][period];
  const invoice = await btcpay().createInvoice({
    amountCents,
    description: `${planName(plan)} · ${period === 'month' ? '1 month' : '1 year'}`,
    redirectUrl: `${appUrl()}/account?plan=paid`,
  });
  await db.insert(planPayments).values({
    userId: user.id,
    provider: 'btcpay',
    externalId: invoice.id,
    plan,
    period,
    amountCents,
    checkoutUrl: invoice.checkoutLink,
  });
  return invoice.checkoutLink;
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
  if (!payment || payment.status === 'paid') return;
  const { status } = await btcpay().invoice(externalId);
  if (status === 'Settled') await markLightningPaid(db, payment.id);
  else if ((status === 'Expired' || status === 'Invalid') && payment.status === 'pending')
    await db.update(planPayments).set({ status: 'expired' }).where(eq(planPayments.id, payment.id));
}

export async function markLightningPaid(db: Database, paymentId: string) {
  await db.transaction(async (tx) => {
    const [first] = await tx.select({ userId: planPayments.userId }).from(planPayments).where(eq(planPayments.id, paymentId));
    if (!first?.userId) return;
    await lockUser(tx, first.userId);
    const [payment] = await tx.select().from(planPayments).where(eq(planPayments.id, paymentId));
    const [user] = await tx.select().from(users).where(eq(users.id, first.userId));
    if (!payment || payment.status === 'paid' || !user) return;
    const plan = PLANS.find((p) => p === payment.plan)!;
    const period = PLAN_PERIODS.find((p) => p === payment.period)!;
    const now = new Date();
    // One more period of the running plan starts where it ends, anything else starts now
    const running = activePlan(user, now) === plan;
    const paidUntil = running && user.planUntil === null ? null : addPeriod(running ? user.planUntil! : now, period);
    await tx.update(users).set({ plan, planUntil: paidUntil }).where(eq(users.id, user.id));
    await tx.update(planPayments).set({ status: 'paid', paidAt: now, paidUntil }).where(eq(planPayments.id, payment.id));
  });
}

// ---------- Shared ----------

const lockUser = (tx: Tx, userId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`plan:${userId}`}))`);

// A payment never shortens what the same plan already runs to
function laterEnd(user: User, plan: Plan, until: Date) {
  if (activePlan(user) !== plan) return until;
  if (user.planUntil === null) return null;
  return user.planUntil > until ? user.planUntil : until;
}

// The account page. Open Lightning invoices of the last day are looked up first, in case a webhook
// got lost; a failing BTCPay leaves them as they are.
const recentPayments = (db: Database, userId: string) =>
  db.select().from(planPayments).where(eq(planPayments.userId, userId)).orderBy(desc(planPayments.createdAt)).limit(20);

export async function billingView(db: Database, userId: string): Promise<BillingView> {
  let payments = await recentPayments(db, userId);
  const open = payments.filter((p) => p.provider === 'btcpay' && p.status === 'pending' && Date.now() - p.createdAt.getTime() < 24 * 60 * 60 * 1000);
  if (open.length && btcpayConfigured()) {
    await Promise.all(open.map((p) => checkLightningPayment(db, p.externalId).catch(() => {})));
    payments = await recentPayments(db, userId);
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const storage = await storageOf(db, userId);
  const plan = activePlan(user!);
  return {
    plan,
    planUntil: plan && user!.planUntil ? user!.planUntil.toISOString() : null,
    renews: !!plan && !!user!.stripeSubscriptionId,
    canBuy: buyable(user!).filter((b) => b.methods.length),
    storage: { usedBytes: storage.used, limitBytes: storage.limit },
    payments: payments.map((p) => ({
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
