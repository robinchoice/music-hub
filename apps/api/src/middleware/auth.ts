import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { sessions, users, type Database } from '@music-hub/db';
import type { AppEnv } from '../types.js';

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

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const sessionToken = getCookie(c, 'session') ?? bearerToken(c);
  if (!sessionToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const tokenHash = await hashToken(sessionToken);
  const db = c.get('db');

  const [session] = await db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, and(eq(users.id, sessions.userId), isNull(users.blockedAt)))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!session || session.expiresAt < new Date()) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('userId', session.userId);
  await markSeen(db, session.userId);
  await next();
});

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
