import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { users } from '@music-hub/db';
import type { AppEnv } from '../types.js';

// Addresses that may open the admin pages, comma-separated in ADMIN_EMAILS
export const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

export const isAdminEmail = (email: string) => ADMIN_EMAILS.has(email.toLowerCase());

// Runs after requireAuth
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const [user] = await c
    .get('db')
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, c.get('userId')))
    .limit(1);
  if (!user || !isAdminEmail(user.email)) return c.json({ error: 'Forbidden' }, 403);
  await next();
});

// "iPhone · Safari" from a user agent; the admin pages get the label, never the raw string
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  // Order matters: Edge and Chrome also name Safari, Edge also names Chrome
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox|FxiOS/.test(ua)
      ? 'Firefox'
      : /Chrome|CriOS/.test(ua)
        ? 'Chrome'
        : /Safari/.test(ua)
          ? 'Safari'
          : null;
  return [os, browser].filter(Boolean).join(' · ') || 'Unbekanntes Gerät';
}
