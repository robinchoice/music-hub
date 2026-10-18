import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { sessions, users, type Database } from '@music-hub/db';
import type { AppEnv } from '../types.js';

export const SESSION_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;

// users.last_seen_at is written at most this often per user; the admin pages count
// someone as online for a while longer than that
const SEEN_INTERVAL = 2 * 60 * 1000;
const lastSeenWrites = new Map<string, number>();

export async function markSeen(db: Database, userId: string) {
  const now = Date.now();
  if (now - (lastSeenWrites.get(userId) ?? 0) < SEEN_INTERVAL) return;
  lastSeenWrites.set(userId, now);
  await db.update(users).set({ lastSeenAt: new Date(now) }).where(eq(users.id, userId));
}

async function validSession(db: Database, token: string) {
  const [session] = await db
    .select({ id: sessions.id, userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, and(eq(users.id, sessions.userId), isNull(users.blockedAt)))
    .where(eq(sessions.tokenHash, await hashToken(token)))
    .limit(1);
  return session && session.expiresAt >= new Date() ? session : undefined;
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const sessionToken = getCookie(c, 'session') ?? bearerToken(c);
  if (!sessionToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const db = c.get('db');
  const session = await validSession(db, sessionToken);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('userId', session.userId);
  await renewSession(c, db, session, sessionToken);
  await markSeen(db, session.userId);
  await next();
});

// For public pages that show more to someone logged in: sets userId only if there is a valid session
export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const sessionToken = getCookie(c, 'session') ?? bearerToken(c);
  const session = sessionToken ? await validSession(c.get('db'), sessionToken) : undefined;
  if (session) c.set('userId', session.userId);
  await next();
});

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, 'session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: (SESSION_DAYS * DAY) / 1000,
  });
}

// Sessions in use renew at most once a day, across all API instances.
export async function renewSession(
  c: Context,
  db: Database,
  session: { id: string; expiresAt: Date },
  token: string,
) {
  if (session.expiresAt.getTime() >= Date.now() + (SESSION_DAYS - 1) * DAY) return;
  const changed = await db
    .update(sessions)
    .set({ expiresAt: new Date(Date.now() + SESSION_DAYS * DAY), client: sql`coalesce(${sessions.client}, ${getCookie(c, 'session') === token ? 'web' : 'plugin'})` })
    .where(and(eq(sessions.id, session.id), eq(sessions.expiresAt, session.expiresAt)))
    .returning({ id: sessions.id });
  if (changed.length && getCookie(c, 'session') === token) setSessionCookie(c, token);
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Native clients such as the DAW plugin have no cookie jar and send the
// session token as a bearer token instead.
export function bearerToken(c: Context): string | undefined {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}
