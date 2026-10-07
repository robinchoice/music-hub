import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { and, eq, isNull } from 'drizzle-orm';
import {
  magicLinkSchema,
  verifyTokenSchema,
  registerSchema,
  loginSchema,
  safeNextPath,
} from '@music-hub/shared';
import { users, magicLinks, sessions } from '@music-hub/db';
import { generateToken, hashToken, bearerToken, markSeen, requireAuth } from '../middleware/auth.js';
import { isAdminEmail } from '../lib/admin.js';
import { createAccount, findUserByEmail, registrationOpen } from '../lib/users.js';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { sendMagicLinkEmail, sendRegistrationEmail } from '../services/email.js';
import type { AppEnv } from '../types.js';

const MINUTE = 60 * 1000;
// Failed password logins per IP and per account. Each attempt counts before the
// password check, so parallel requests can't overshoot; a success takes it back.
const failedLogins = rateLimit(10, 15 * MINUTE);
// Magic link and registration emails
const mailsPerAddress = rateLimit(5, 60 * MINUTE);
const mailsPerIp = rateLimit(20, 60 * MINUTE);

// New accounts beyond MAX_USERS only come from project invites
const FULL = 'Music Hub ist gerade voll. Neue Konten gibt es nur noch per Einladung zu einem Projekt.';
const BLOCKED = 'Dieses Konto ist gesperrt.';

async function createSession(c: any, db: any, userId: string) {
  const sessionToken = generateToken();
  const tokenHash = await hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash, expiresAt });
  setCookie(c, 'session', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}

export const authRoutes = new Hono<AppEnv>()
  // Register with password
  .post('/register', zValidator('json', registerSchema), async (c) => {
    const { name, email, password } = c.req.valid('json');
    const db = c.get('db');

    if (!mailsPerIp.hit(clientIp(c))) return tooManyRequests(c);

    const existing = await findUserByEmail(db, email);
    if (!existing && !(await registrationOpen(db))) return c.json({ error: FULL }, 403);
    if (existing?.blockedAt) return c.json({ error: BLOCKED }, 403);
    if (existing?.passwordHash) {
      return c.json({ error: 'E-Mail bereits vergeben — melde dich per Magic Link an' }, 409);
    }

    // Only count towards the address once a mail goes out, so 409s can't
    // block magic links for an existing account
    if (!mailsPerAddress.hit(email.toLowerCase())) return tooManyRequests(c);

    const token = generateToken();
    await db.insert(magicLinks).values({
      email,
      token: await hashToken(token),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 h
      name,
      passwordHash: await Bun.password.hash(password),
    });

    await sendRegistrationEmail(email, token);

    return c.json({ user: null, verificationRequired: true }, 202);
  })

  // Login with password
  .post('/login', zValidator('json', loginSchema), async (c) => {
    const { email, password } = c.req.valid('json');
    const db = c.get('db');

    const attempt = [clientIp(c), email.toLowerCase()];
    if (!attempt.every((key) => failedLogins.hit(key))) return tooManyRequests(c);

    const user = await findUserByEmail(db, email);
    if (!user?.passwordHash || !(await Bun.password.verify(password, user.passwordHash))) {
      return c.json({ error: 'E-Mail oder Passwort falsch' }, 401);
    }
    for (const key of attempt) failedLogins.undo(key);
    if (user.blockedAt) return c.json({ error: BLOCKED }, 403);

    await createSession(c, db, user.id);
    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isAdmin: isAdminEmail(user.email),
      },
    });
  })

  .post('/magic-link', zValidator('json', magicLinkSchema), async (c) => {
    const { email, next } = c.req.valid('json');
    const db = c.get('db');

    if (!mailsPerIp.hit(clientIp(c))) return tooManyRequests(c);
    const user = await findUserByEmail(db, email);
    if (!user && !(await registrationOpen(db))) return c.json({ error: FULL }, 403);
    if (user?.blockedAt) return c.json({ error: BLOCKED }, 403);
    if (!mailsPerAddress.hit(email.toLowerCase())) return tooManyRequests(c);

    const token = generateToken();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await db.insert(magicLinks).values({
      email,
      token: tokenHash,
      expiresAt,
    });

    await sendMagicLinkEmail(email, token, safeNextPath(next));

    return c.json({ message: 'Magic link sent' });
  })

  .post('/verify', zValidator('json', verifyTokenSchema), async (c) => {
    const { token, password } = c.req.valid('json');
    const db = c.get('db');

    return db.transaction(async (tx) => {
      const tokenHash = await hashToken(token);
      const [link] = await tx
        .select()
        .from(magicLinks)
        .where(eq(magicLinks.token, tokenHash))
        .limit(1)
        .for('update');

      if (!link || link.expiresAt < new Date() || link.usedAt) {
        return c.json({ error: 'Der Link ist abgelaufen oder wurde schon benutzt.' }, 400);
      }

      const defaultName = link.email.split('@')[0];
      let registration: { name: string; passwordHash: string } | null = null;
      if (link.passwordHash && password !== undefined) {
        if (!(await Bun.password.verify(password, link.passwordHash))) {
          return c.json({ error: 'Passwort falsch' }, 401);
        }
        registration = { name: link.name ?? defaultName, passwordHash: link.passwordHash };
      }

      let user = await findUserByEmail(tx, link.email);
      if (user?.blockedAt) return c.json({ error: BLOCKED }, 403);
      if (!user) {
        // Music Hub may have filled up since the link went out
        const created = await createAccount(tx, { email: link.email, name: defaultName, ...registration });
        if (!created) return c.json({ error: FULL }, 403);
        user = created;
        registration = null;
      }

      await tx
        .update(magicLinks)
        .set({ usedAt: new Date() })
        .where(eq(magicLinks.id, link.id));

      if (registration) {
        [user] = await tx
          .update(users)
          .set({ ...registration, updatedAt: new Date() })
          .where(eq(users.id, user.id))
          .returning();
      }

      await createSession(c, tx, user.id);
      return c.json({ user: { id: user.id, email: user.email, name: user.name, isAdmin: isAdminEmail(user.email) } });
    });
  })

  .post('/logout', async (c) => {
    const sessionToken = getCookie(c, 'session') ?? bearerToken(c);
    if (sessionToken) {
      const db = c.get('db');
      const tokenHash = await hashToken(sessionToken);
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    }
    deleteCookie(c, 'session');
    return c.json({ message: 'Logged out' });
  })

  .get('/me', async (c) => {
    const sessionToken = getCookie(c, 'session') ?? bearerToken(c);
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
      .where(and(eq(users.id, session.userId), isNull(users.blockedAt)))
      .limit(1);
    if (!user) return c.json({ user: null });

    await markSeen(db, user.id);
    return c.json({ user: { ...user, isAdmin: isAdminEmail(user.email) } });
  })

  .patch('/me', requireAuth, async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const body = await c.req.json<{ name?: string }>();
    if (!body.name?.trim()) return c.json({ error: 'Name is required' }, 400);

    const [user] = await db
      .update(users)
      .set({ name: body.name.trim(), updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id, email: users.email, name: users.name, avatarUrl: users.avatarUrl });

    return c.json({ user: { ...user, isAdmin: isAdminEmail(user.email) } });
  });
