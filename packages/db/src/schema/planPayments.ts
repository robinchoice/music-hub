import { pgTable, uuid, varchar, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// What people pay Music Hub for a plan (lib/billing.ts). Each row is one Stripe invoice or one BTCPay
// invoice; paying one moves users.plan_until. Amounts are gross euro cents. Rows outlive their account
// for the books, the user goes to null.
export const planPayments = pgTable(
  'plan_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    // 'stripe' or 'btcpay'
    provider: varchar('provider', { length: 16 }).notNull(),
    // The invoice id at the provider; a webhook delivered twice finds the row and changes nothing
    externalId: varchar('external_id', { length: 255 }).notNull().unique(),
    plan: varchar('plan', { length: 16 }).notNull(),
    // 'month' or 'year'
    period: varchar('period', { length: 8 }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    // 'pending', 'paid' or 'expired'
    status: varchar('status', { length: 16 }).default('pending').notNull(),
    checkoutUrl: text('checkout_url'),
    // Stripe: the subscription the invoice belongs to; its first invoice starts the contract
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
    // When the buyer asked for the plan to start right away (PLAN_CONSENT in shared)
    consentedAt: timestamp('consented_at'),
    // Where the paid period starts: the invoice period at Stripe, for Lightning the end of a running plan or the payment
    periodStart: timestamp('period_start'),
    // When the confirmation mail with terms and cancellation notice went out (§ 312f BGB); null retries
    confirmedAt: timestamp('confirmed_at'),
    // A withdrawal within 14 days and what we owe back, refunded by hand
    withdrawnAt: timestamp('withdrawn_at'),
    refundCents: integer('refund_cents'),
    // plan_until after this payment
    paidUntil: timestamp('paid_until'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('plan_payments_user_idx').on(t.userId)],
);
