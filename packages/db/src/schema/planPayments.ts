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
    // plan_until after this payment
    paidUntil: timestamp('paid_until'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('plan_payments_user_idx').on(t.userId)],
);
