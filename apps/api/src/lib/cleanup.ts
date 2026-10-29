import { and, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { listenEvents, magicLinks, rateLimits, sessions, type Database } from '@music-hub/db';

const DAY_MS = 86_400_000;
// Used links count as logins in the admin pages, which look back 90 days at most
export const USED_LINK_DAYS = 90;
// The privacy policy names this: after it a listen keeps its numbers, but loses the browser and the IP hash
export const LISTEN_DETAILS_DAYS = 90;

// Deletes what nobody needs anymore. Every API instance runs it; a second run finds nothing left.
export async function pruneExpired(db: Database) {
  const now = new Date();
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(magicLinks).where(
    or(
      and(isNull(magicLinks.usedAt), lt(magicLinks.expiresAt, now)),
      lt(magicLinks.usedAt, new Date(now.getTime() - USED_LINK_DAYS * DAY_MS)),
    ),
  );
  await db
    .update(listenEvents)
    .set({ ipHash: null, userAgent: null })
    .where(
      and(
        lt(listenEvents.openedAt, new Date(now.getTime() - LISTEN_DETAILS_DAYS * DAY_MS)),
        or(isNotNull(listenEvents.ipHash), isNotNull(listenEvents.userAgent)),
      ),
    );
  // The rate limits sweep on their next hit; this catches windows nobody hits again.
  // Their reset_at comes from the database clock, see lib/rate-limit.ts.
  await db.delete(rateLimits).where(lt(rateLimits.resetAt, sql`now()`));
}
