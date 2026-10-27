import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { DELIVERY_ERRORS, paymentAccountSchema, type DeliveryErrorCode, type PaymentAccount } from '@music-hub/shared';
import { paymentAccounts } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { paymentAccountOf, type PaymentAccountRow } from '../lib/deliveries.js';
import { checkReceiveOnly, connectNwc, relayProblem, type NwcInfo } from '../lib/payments/nwc.js';
import { rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { encryptSecret, paymentsConfigured } from '../lib/payments/secrets.js';
import { PaymentServiceError } from '../lib/payments/errors.js';
import { maskIban, normalizeIban, validIban } from '../lib/payments/girocode.js';
import type { AppEnv } from '../types.js';
import { locale } from '../lib/i18n.js';

// Where the caller receives the money of their deliveries: their own Lightning wallet over NWC, which
// may only make and look up invoices, and their bank account for transfers. The NWC secret never
// leaves the API, the IBAN only comes back masked.

const accountView = (row: PaymentAccountRow | undefined): PaymentAccount => ({
  lightningAvailable: paymentsConfigured(),
  lightning: { connected: !!row?.nwcSecretEnc, alias: row?.nwcSecretEnc ? row.nwcAlias : null },
  transfer:
    row?.iban && row.accountHolder ? { ibanMasked: maskIban(row.iban), bic: row.bic, accountHolder: row.accountHolder } : null,
  updatedAt: row ? row.updatedAt.toISOString() : null,
});

// Each wallet check dials the relays in the URL
const accountChanges = rateLimit('payment-account-changes', 20, 60 * 60_000);

const deliveryError = <S extends 400 | 502 | 503>(c: Context<AppEnv>, code: DeliveryErrorCode, status: S) =>
  c.json({ error: DELIVERY_ERRORS[locale(c)][code], code }, status);

export const paymentAccountRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const row = await paymentAccountOf(c.get('db'), c.get('userId'));
    return c.json({ account: accountView(row) });
  })

  // undefined keeps a value, null clears it. A wallet is asked for its methods before it is stored.
  .put('/', zValidator('json', paymentAccountSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const input = c.req.valid('json');
    if (!(await accountChanges.hit(db, userId))) return tooManyRequests(c);
    const current = await paymentAccountOf(db, userId);

    const set: Partial<typeof paymentAccounts.$inferInsert> = { updatedAt: new Date() };

    if (input.iban !== undefined) {
      if (input.iban === null || input.iban === '') {
        set.iban = null;
        // A BIC without an account means nothing
        if (input.bic === undefined) set.bic = null;
      } else {
        const iban = normalizeIban(input.iban);
        if (!validIban(iban)) return deliveryError(c, 'invalid_iban', 400);
        set.iban = iban;
      }
    }
    if (input.bic !== undefined) set.bic = input.bic ? input.bic.toUpperCase() : null;
    if (input.accountHolder !== undefined) set.accountHolder = input.accountHolder;
    // IBAN and account holder only together
    const iban = set.iban !== undefined ? set.iban : (current?.iban ?? null);
    const holder = set.accountHolder !== undefined ? set.accountHolder : (current?.accountHolder ?? null);
    if (!iban !== !holder) return deliveryError(c, 'invalid_iban', 400);

    if (input.nwcUrl === null) {
      set.nwcSecretEnc = null;
      set.nwcAlias = null;
    } else if (input.nwcUrl !== undefined) {
      if (!paymentsConfigured()) return deliveryError(c, 'lightning_unconfigured', 503);
      // Before anything is dialed: only public wss:// relays
      if (relayProblem(input.nwcUrl)) return deliveryError(c, 'relay_refused', 400);
      let info: NwcInfo;
      try {
        const client = await connectNwc(input.nwcUrl);
        try {
          info = await client.getInfo();
        } finally {
          client.close();
        }
      } catch (err) {
        // Only our own messages: other errors may carry the connection string
        if (err instanceof PaymentServiceError) return c.json({ error: err.text(locale(c)), code: err.code }, 502);
        console.error('[Payments] Wallet check failed');
        return deliveryError(c, 'wallet_unreachable', 502);
      }
      if (!checkReceiveOnly(info).ok) return deliveryError(c, 'wallet_spends', 400);
      set.nwcSecretEnc = encryptSecret(input.nwcUrl);
      set.nwcAlias = info.alias?.slice(0, 255) ?? null;
    }

    const [row] = await db
      .insert(paymentAccounts)
      .values({ userId, ...set })
      .onConflictDoUpdate({ target: paymentAccounts.userId, set })
      .returning();
    return c.json({ account: accountView(row) });
  });
