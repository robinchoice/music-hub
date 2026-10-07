import { asc, desc, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { SIGNUP_STORAGE_PER_USER } from '@music-hub/shared';
import { users, type Database } from '@music-hub/db';

// Accounts in total, blocked ones included. Signing up stops here, invites still create accounts.
export const MAX_USERS = 10;

export async function findUserByEmail(db: Database, email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .orderBy(desc(sql`${users.email} = ${email}`), asc(users.createdAt))
    .limit(1);
  return user;
}

export async function registrationOpen(db: Pick<Database, 'execute'>) {
  const [{ count }] = await db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM users`);
  return count < MAX_USERS;
}

// Creates a signed-up account unless Music Hub is full. The lock keeps parallel sign-ups from overshooting.
export async function createAccount(db: Database, values: typeof users.$inferInsert) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('registration'))`);
    if (!(await registrationOpen(tx))) return undefined;
    const [user] = await tx.insert(users).values({ ...values, storageLimit: SIGNUP_STORAGE_PER_USER }).returning();
    return user;
  });
}

// For rows whose owner must not be blocked, e.g. share links
export const notBlocked = (userId: PgColumn) =>
  sql`${userId} NOT IN (SELECT id FROM users WHERE blocked_at IS NOT NULL)`;
