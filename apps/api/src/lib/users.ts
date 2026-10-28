import { asc, desc, inArray, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { SIGNUP_STORAGE_PER_USER, type Locale, pickLocale } from '@music-hub/shared';
import { pushSubscriptions, users, type Database } from '@music-hub/db';

// Accounts in total, blocked ones included, paying ones left out. Signing up stops here, invites still create accounts.
export const MAX_USERS = 10;

// Admins reset this account to try Music Hub as a new person (lib/test-account.ts). It doesn't count towards MAX_USERS.
export const TEST_ACCOUNT_EMAIL = 'test@onboarding.invalid';

export async function findUserByEmail(db: Pick<Database, 'select'>, email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .orderBy(desc(sql`${users.email} = ${email}`), asc(users.createdAt))
    .limit(1);
  return user;
}

export async function registrationOpen(db: Pick<Database, 'execute'>) {
  const [{ count }] = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM users
    WHERE email <> ${TEST_ACCOUNT_EMAIL} AND NOT (plan IS NOT NULL AND (plan_until IS NULL OR plan_until > now()))
  `);
  return count < MAX_USERS;
}

// Creates a signed-up account unless Music Hub is full. The lock keeps parallel sign-ups from overshooting.
export async function createAccount(db: Pick<Database, 'transaction'>, values: typeof users.$inferInsert) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('registration'))`);
    if (!(await registrationOpen(tx))) return undefined;
    const [user] = await tx.insert(users).values({ ...values, storageLimit: SIGNUP_STORAGE_PER_USER }).returning();
    return user;
  });
}

// The account an invitation creates. Two invitations at the same moment both end up with the one row.
// It starts in the inviter's language, the first login sets the invitee's own.
export async function inviteeAccount(db: Pick<Database, 'insert' | 'select'>, email: string, locale: Locale) {
  const [user] = await db.insert(users).values({ email, name: email.split('@')[0], locale }).onConflictDoNothing().returning();
  return user ?? (await findUserByEmail(db, email))!;
}

// For rows whose owner must not be blocked, e.g. share links
export const notBlocked = (userId: PgColumn) =>
  sql`${userId} NOT IN (SELECT id FROM users WHERE blocked_at IS NOT NULL)`;

// How to tell these people about new versions and feedback: a push if they have a subscription,
// otherwise a mail unless they turned the version mails off. Blocked accounts hear nothing.
export async function reachOf(db: Pick<Database, 'select'>, userIds: string[]) {
  if (!userIds.length) return { push: [] as string[], mail: [] as { email: string; mailToken: string; locale: Locale }[] };
  const rows = await db
    .select({ userId: users.id, email: users.email, mailToken: users.mailToken, versionMails: users.versionMails, blockedAt: users.blockedAt, locale: users.locale })
    .from(users)
    .where(inArray(users.id, userIds));
  const subscribed = new Set(
    (await db.select({ userId: pushSubscriptions.userId }).from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds))).map((s) => s.userId),
  );
  const reachable = rows.filter((u) => !u.blockedAt);
  return {
    push: reachable.filter((u) => subscribed.has(u.userId)).map((u) => u.userId),
    mail: reachable.filter((u) => !subscribed.has(u.userId) && u.versionMails).map((u) => ({ email: u.email, mailToken: u.mailToken, locale: pickLocale(u.locale) })),
  };
}
