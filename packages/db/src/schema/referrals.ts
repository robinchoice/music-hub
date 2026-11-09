import { sql } from 'drizzle-orm';
import { pgTable, uuid, timestamp, index, check } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// Who signed up through whose referral link (apps/api/src/lib/referrals.ts). Once the referred account
// has paid and the withdrawal period of that payment is over, both get free days: rewarded_at marks the
// referrer's, referred_rewarded_at the referred account's, each set in the transaction that grants them.
export const referrals = pgTable(
  'referrals',
  {
    referredId: uuid('referred_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    referrerId: uuid('referrer_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    rewardedAt: timestamp('rewarded_at'),
    referredRewardedAt: timestamp('referred_rewarded_at'),
  },
  (t) => [index().on(t.referrerId), check('referrals_not_self', sql`${t.referrerId} <> ${t.referredId}`)],
);
