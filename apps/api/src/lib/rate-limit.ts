import type { Context } from 'hono';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { rateLimits, type Database } from '@music-hub/db';

// Fixed-window counters in Postgres, so all API instances share them and a
// restart keeps them. `name` keeps the keys of different limits apart.
export function rateLimit(name: string, limit: number, windowMs: number) {
  let nextSweep = 0;

  return {
    // Counts `amount` hits for `key`; false once it goes over the limit.
    async hit(db: Database, key: string, amount = 1) {
      if (Date.now() >= nextSweep) {
        nextSweep = Date.now() + windowMs;
        await db.delete(rateLimits).where(lt(rateLimits.resetAt, sql`now()`));
      }

      // An expired window starts over at `amount`. Both CASEs see the old row.
      const [row] = await db
        .insert(rateLimits)
        .values({ key: `${name}:${key}`, count: amount, resetAt: sql`now() + make_interval(secs => ${windowMs / 1000})` })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: {
            count: sql`case when ${rateLimits.resetAt} <= now() then excluded.count else ${rateLimits.count} + excluded.count end`,
            resetAt: sql`case when ${rateLimits.resetAt} <= now() then excluded.reset_at else ${rateLimits.resetAt} end`,
          },
        })
        .returning({ count: rateLimits.count });
      return row!.count <= limit;
    },
    // Takes hits back, e.g. once a counted attempt turned out to be valid.
    async undo(db: Database, key: string, amount = 1) {
      await db
        .update(rateLimits)
        .set({ count: sql`greatest(0, ${rateLimits.count} - ${amount})` })
        .where(and(eq(rateLimits.key, `${name}:${key}`), gt(rateLimits.resetAt, sql`now()`)));
    },
  };
}

// The reverse proxy in front of the web app sets X-Forwarded-For and the web
// app passes it through. Its last entry is the address the proxy saw.
export function clientIp(c: Context) {
  return c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
}

export function tooManyRequests(c: Context) {
  return c.json({ error: 'Zu viele Versuche — bitte später erneut probieren' }, 429);
}
