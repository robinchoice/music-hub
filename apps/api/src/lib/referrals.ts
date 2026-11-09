import { and, count, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { planPayments, referrals, users, type Database } from '@music-hub/db';
import { activePlan, REFERRAL_DAYS, type ReferralView } from '@music-hub/shared';
import { grantFreeDays } from './billing.js';

// Refer a friend. Every account with a running plan has a link /register?ref=<code>. A new account made
// through it is recorded in `referrals`; once it has paid for a plan and the 14 days for withdrawing
// that payment are over, the referrer gets REFERRAL_DAYS.referrer free days and the new account
// REFERRAL_DAYS.referred (grantFreeDays). No cap: each reward follows a payment. No money changes hands.
// The link also lets people in beyond MAX_USERS like an invitation, but only while fewer than
// OPEN_REFERRALS_MAX of the referrer's referred accounts have not been rewarded yet.

const WITHDRAWAL_MS = 14 * 24 * 60 * 60 * 1000;
export const OPEN_REFERRALS_MAX = 5;

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

// The account behind a referral code, if it may refer now: not blocked and with a running plan
export async function referrerOf(db: Pick<Database, 'select'>, code: string) {
  const [user] = await db.select().from(users).where(eq(users.referralCode, code.trim().toLowerCase())).limit(1);
  return user && !user.blockedAt && activePlan(user) ? user : null;
}

// Whether the referrer's link may still create an account although Music Hub is full
export async function mayJoinBeyondLimit(db: Pick<Database, 'select'>, referrerId: string) {
  const [row] = await db
    .select({ open: count() })
    .from(referrals)
    .where(and(eq(referrals.referrerId, referrerId), isNull(referrals.rewardedAt)));
  return (row?.open ?? 0) < OPEN_REFERRALS_MAX;
}

// The own link and its counts. The code is made on the first look and kept, also when the plan ends.
export async function referralView(db: Database, userId: string): Promise<ReferralView> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  let code: string | null = null;
  if (user && activePlan(user)) {
    code = user.referralCode;
    if (!code) {
      const [row] = await db
        .update(users)
        .set({ referralCode: sql`coalesce(${users.referralCode}, ${newCode()})` })
        .where(eq(users.id, userId))
        .returning({ code: users.referralCode });
      code = row?.code ?? null;
    }
  }
  const [counts] = await db
    .select({ joined: count(), rewarded: count(referrals.rewardedAt) })
    .from(referrals)
    .where(eq(referrals.referrerId, userId));
  return { code, joined: counts?.joined ?? 0, rewarded: counts?.rewarded ?? 0 };
}

// Hands out the free days of every referral whose account has a paid, not withdrawn payment older than
// the withdrawal period. Each side is its own transaction of marking and granting: a failed Stripe credit
// rolls back only that side and the next run tries it again, without crediting the other side twice.
// Several API instances never reward twice, the marking waits on the row lock.
const SIDES = [
  { done: referrals.rewardedAt, mark: 'rewardedAt', who: 'referrerId', days: REFERRAL_DAYS.referrer, key: 'referrer' },
  { done: referrals.referredRewardedAt, mark: 'referredRewardedAt', who: 'referredId', days: REFERRAL_DAYS.referred, key: 'referred' },
] as const;

export async function rewardReferrals(db: Database) {
  const due = await db
    .selectDistinct({ referredId: referrals.referredId })
    .from(referrals)
    .innerJoin(planPayments, eq(planPayments.userId, referrals.referredId))
    .where(
      and(
        or(isNull(referrals.rewardedAt), isNull(referrals.referredRewardedAt)),
        eq(planPayments.status, 'paid'),
        isNull(planPayments.withdrawnAt),
        gt(planPayments.amountCents, 0),
        lte(planPayments.paidAt, new Date(Date.now() - WITHDRAWAL_MS)),
      ),
    );
  let failure: unknown = null;
  for (const { referredId } of due) {
    for (const side of SIDES) {
      try {
        await db.transaction(async (tx) => {
          const [claimed] = await tx
            .update(referrals)
            .set({ [side.mark]: new Date() })
            .where(and(eq(referrals.referredId, referredId), isNull(side.done)))
            .returning();
          if (claimed) await grantFreeDays(tx, claimed[side.who], side.days, `referral-${referredId}-${side.key}`);
        });
      } catch (err) {
        // One failing reward doesn't hold up the others
        failure ??= err;
      }
    }
  }
  if (failure) throw failure;
}
