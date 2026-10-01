import { asc, desc, sql } from 'drizzle-orm';
import { users, type Database } from '@music-hub/db';

export async function findUserByEmail(db: Database, email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .orderBy(desc(sql`${users.email} = ${email}`), asc(users.createdAt))
    .limit(1);
  return user;
}
