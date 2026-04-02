import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { magicLinkSchema, verifyTokenSchema } from '@music-hub/shared';
import { users, magicLinks, sessions } from '@music-hub/db';
import { hashToken } from '../middleware/auth.js';
import { sendMagicLinkEmail } from '../services/email.js';
import type { AppEnv } from '../types.js';

export const authRoutes = new Hono<AppEnv>()
  .post('/magic-link', zValidator('json', magicLinkSchema), async (c) => {
    const { email } = c.req.valid('json');
    const db = c.get('db');

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await db.insert(magicLinks).values({
      email,
      token,
      expiresAt,
    });

    await sendMagicLinkEmail(email, token);

    return c.json({ message: 'Magic link sent' });
  })

  .post('/verify', zValidator('json', verifyTokenSchema), async (c) => {
    const { token } = c.req.valid('json');
    const db = c.get('db');

    const [link] = await db
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.token, token))
      .limit(1);

    if (!link || link.expiresAt < new Date() || link.usedAt) {
      return c.json({ error: 'Invalid or expired token' }, 400);
    }

    await db
      .update(magicLinks)
      .set({ usedAt: new Date() })
      .where(eq(magicLinks.id, link.id));

    // Find or create user
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, link.email))
      .limit(1);

    if (!user) {
      const name = link.email.split('@')[0];
      [user] = await db
        .insert(users)
        .values({ email: link.email, name })
        .returning();
    }

    // Create session
    const sessionToken = generateToken();
    const tokenHash = await hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await db.insert(sessions).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    setCookie(c, 'session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });

    return c.json({ user: { id: user.id, email: user.email, name: user.name } });
  })

  .post('/logout', async (c) => {
    const sessionToken = getCookie(c, 'session');
    if (sessionToken) {
      const db = c.get('db');
      const tokenHash = await hashToken(sessionToken);
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    }
    deleteCookie(c, 'session');
    return c.json({ message: 'Logged out' });
  })

  .get('/me', async (c) => {
    const sessionToken = getCookie(c, 'session');
    if (!sessionToken) {
      return c.json({ user: null });
    }

    const db = c.get('db');
    const tokenHash = await hashToken(sessionToken);

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    if (!session || session.expiresAt < new Date()) {
      return c.json({ user: null });
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    return c.json({ user: user || null });
  })

  .patch('/me', async (c) => {
    const sessionToken = getCookie(c, 'session');
    if (!sessionToken) return c.json({ error: 'Unauthorized' }, 401);

    const db = c.get('db');
    const tokenHash = await hashToken(sessionToken);
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    if (!session || session.expiresAt < new Date()) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json<{ name?: string }>();
    if (!body.name?.trim()) return c.json({ error: 'Name is required' }, 400);

    const [user] = await db
      .update(users)
      .set({ name: body.name.trim(), updatedAt: new Date() })
      .where(eq(users.id, session.userId))
      .returning({ id: users.id, email: users.email, name: users.name, avatarUrl: users.avatarUrl });

    return c.json({ user });
  });

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
