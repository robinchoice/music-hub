import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { billingCheckoutSchema, billingWithdrawSchema, type BillingCancelResponse, type BillingErrorCode, type BillingWithdrawResponse } from '@music-hub/shared';
import { users } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import {
  billingView,
  btcpayConfigured,
  btcpayEvent,
  cancelPlan,
  checkLightningPayment,
  handleStripeEvent,
  lightningCheckout,
  mayBuy,
  plansForSale,
  stripeCheckout,
  stripeConfigured,
  stripeEvent,
  stripePortal,
  withdrawPayment,
} from '../lib/billing.js';
import { PaymentServiceError } from '../lib/payments/errors.js';
import { rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { t } from '../lib/i18n.js';
import type { AppEnv } from '../types.js';

// Plans for the caller's own account (lib/billing.ts) and the webhooks of Stripe and BTCPay

const errorText = {
  billing_unavailable: 'billingUnavailable',
  plan_running: 'planRunning',
  billing_failed: 'billingFailed',
  consent_required: 'consentRequired',
  nothing_to_end: 'nothingToEnd',
} as const;
const billingError = <S extends 400 | 404 | 409 | 502 | 503>(c: Context<AppEnv>, code: BillingErrorCode, status: S) =>
  c.json({ error: t(c).errors[errorText[code]], code }, status);

// Each checkout asks Stripe or BTCPay for a new page
const checkouts = rateLimit('billing-checkouts', 10, 60 * 60_000);

export const billingRoutes = new Hono<AppEnv>()
  .get('/', requireAuth, async (c) => c.json(await billingView(c.get('db'), c.get('userId'))))

  // For the public pages: the terms (/agb) and the privacy section about payments show only while plans are for sale
  .get('/offer', (c) => c.json({ forSale: plansForSale() }))

  .post('/checkout', requireAuth, zValidator('json', billingCheckoutSchema), async (c) => {
    const db = c.get('db');
    const { plan, period, method, consent } = c.req.valid('json');
    if (!(method === 'stripe' ? stripeConfigured() : btcpayConfigured())) return billingError(c, 'billing_unavailable', 503);
    if (!consent) return billingError(c, 'consent_required', 400);
    const [user] = await db.select().from(users).where(eq(users.id, c.get('userId'))).limit(1);
    if (!user || !mayBuy(user, plan, method)) return billingError(c, 'plan_running', 409);
    if (!(await checkouts.hit(db, user.id))) return tooManyRequests(c);
    try {
      const url = method === 'stripe' ? await stripeCheckout(db, user, plan, period) : await lightningCheckout(db, user, plan, period);
      return c.json({ url });
    } catch (err) {
      if (err instanceof PaymentServiceError) return billingError(c, 'billing_failed', 502);
      throw err;
    }
  })

  .post('/portal', requireAuth, async (c) => {
    if (!stripeConfigured()) return billingError(c, 'billing_unavailable', 503);
    const [user] = await c.get('db').select().from(users).where(eq(users.id, c.get('userId'))).limit(1);
    try {
      const url = user && (await stripePortal(user));
      if (!url) return billingError(c, 'billing_unavailable', 503);
      return c.json({ url });
    } catch (err) {
      if (err instanceof PaymentServiceError) return billingError(c, 'billing_failed', 502);
      throw err;
    }
  })

  // "Verträge hier kündigen": ends the running subscription, see cancelPlan
  .post('/cancel', requireAuth, async (c) => {
    try {
      const result = await cancelPlan(c.get('db'), c.get('userId'));
      if (!result) return billingError(c, 'nothing_to_end', 404);
      const body: BillingCancelResponse = { endsAt: result.endsAt.toISOString(), refundCents: result.refundCents };
      return c.json(body);
    } catch (err) {
      if (err instanceof PaymentServiceError) return billingError(c, 'billing_failed', 502);
      throw err;
    }
  })

  // "Vertrag widerrufen" within 14 days of a contract, see withdrawPayment
  .post('/withdraw', requireAuth, zValidator('json', billingWithdrawSchema), async (c) => {
    try {
      const result = await withdrawPayment(c.get('db'), c.get('userId'), c.req.valid('json').paymentId);
      if (!result) return billingError(c, 'nothing_to_end', 404);
      const body: BillingWithdrawResponse = result;
      return c.json(body);
    } catch (err) {
      if (err instanceof PaymentServiceError) return billingError(c, 'billing_failed', 502);
      throw err;
    }
  })

  // Stripe retries anything but a 2xx, so a failure inside is a 500 and comes again
  .post('/stripe', async (c) => {
    if (!stripeConfigured()) return c.json({ error: 'Not configured' }, 404);
    const event = await stripeEvent(await c.req.text(), c.req.header('stripe-signature') ?? '');
    if (!event) return c.json({ error: 'Bad signature' }, 400);
    await handleStripeEvent(c.get('db'), event);
    return c.json({ received: true });
  })

  .post('/btcpay', async (c) => {
    if (!btcpayConfigured()) return c.json({ error: 'Not configured' }, 404);
    const event = btcpayEvent(await c.req.text(), c.req.header('btcpay-sig'));
    if (!event) return c.json({ error: 'Bad signature' }, 400);
    await checkLightningPayment(c.get('db'), event.invoiceId);
    return c.json({ received: true });
  });
