import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import { sessions, users, type Database } from '@music-hub/db';
import { hashToken, sessionCookieOptions } from '../middleware/auth.js';

// Further accounts signed in in this browser: their session tokens sit in an
// httpOnly cookie of their own, `session` stays the active account. Only the
// web uses it, plugin and CLI keep one bearer token.
const COOKIE = 'accounts';
export const MAX_ACCOUNTS = 5;
const TOKEN = /^[0-9a-f]{64}$/;

export function parkedTokens(c: Context) {
  return (getCookie(c, COOKIE) ?? '').split('.').filter((token) => TOKEN.test(token)).slice(0, MAX_ACCOUNTS);
}

export function setParkedTokens(c: Context, tokens: string[]) {
  if (tokens.length) setCookie(c, COOKIE, tokens.join('.'), sessionCookieOptions());
  else deleteCookie(c, COOKIE, { path: '/' });
}

// The valid sessions among the tokens, one per person in the given order:
// a second session of the same account counts as the first.
export async function signedIn(db: Pick<Database, 'select'>, tokens: (string | undefined)[]) {
  const given = tokens.filter((token): token is string => !!token);
  if (!given.length) return [];
  const hashes = await Promise.all(given.map(hashToken));
  const rows = await db
    .select({
      tokenHash: sessions.tokenHash,
      userId: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(sessions)
    .innerJoin(users, and(eq(users.id, sessions.userId), isNull(users.blockedAt)))
    .where(and(inArray(sessions.tokenHash, hashes), gte(sessions.expiresAt, new Date())));
  const seen = new Set<string>();
  return given.flatMap((token, i) => {
    const row = rows.find((r) => r.tokenHash === hashes[i]);
    if (!row || seen.has(row.userId)) return [];
    seen.add(row.userId);
    return [{ token, userId: row.userId, name: row.name, email: row.email, avatarUrl: row.avatarUrl }];
  });
}
