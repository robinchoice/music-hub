import type { Database } from '@music-hub/db';
import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { deleteCookie, getCookie } from 'hono/cookie';
import { and, eq, isNull, isNotNull, gt, lt, sql } from 'drizzle-orm';
import {
  magicLinkSchema,
  verifyCodeSchema,
  loginTexts,
  verifyTokenSchema,
  registerSchema,
  loginSchema,
  updateMeSchema,
  safeNextPath,
} from '@music-hub/shared';
import { users, magicLinks, sessions } from '@music-hub/db';
import {
  generateToken,
  hashToken,
  bearerToken,
  markSeen,
  renewSession,
  requireAuth,
  SESSION_DAYS,
  setSessionCookie,
} from '../middleware/auth.js';
import { isAdminEmail } from '../lib/admin.js';
import { createAccount, findUserByEmail, registrationOpen } from '../lib/users.js';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { sendMagicLinkEmail, sendRegistrationEmail } from '../services/email.js';
import type { AppEnv } from '../types.js';

const MINUTE = 60 * 1000;
// Failed password logins per IP and per account. Each attempt counts before the
// password check, so parallel requests can't overshoot; a success takes it back.
const failedLogins = rateLimit('failed-logins', 10, 15 * MINUTE);
// Magic link and registration emails
const mailsPerAddress = rateLimit('mails-per-address', 5, 60 * MINUTE);
const mailsPerIp = rateLimit('mails-per-ip', 20, 60 * MINUTE);
const linkChecksPerIp = rateLimit('link-checks-per-ip', 60, 15 * MINUTE);
const codeChecksPerIp = rateLimit('code-checks-per-ip', 30, 15 * MINUTE);

// New accounts beyond MAX_USERS only come from project invites
const FULL = 'Music Hub ist gerade voll. Neue Konten gibt es nur noch per Einladung zu einem Projekt.';
const BLOCKED = 'Dieses Konto ist gesperrt.';

// The user as every auth route returns it
const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  avatarUrl: users.avatarUrl,
  versionMails: users.versionMails,
  updatesConsentAt: users.updatesConsentAt,
};
type UserRow = { id: string; email: string; name: string; avatarUrl: string | null; versionMails: boolean; updatesConsentAt: Date | null };
export const toUser = ({ id, email, name, avatarUrl, versionMails, updatesConsentAt }: UserRow) => ({
  id,
  email,
  name,
  avatarUrl,
  versionMails,
  // Since when the account gets update mails, null = off
  updatesSince: updatesConsentAt?.toISOString() ?? null,
  isAdmin: isAdminEmail(email),
});

// Switching update mails on keeps the time of the first consent as proof
const consentNow = sql`coalesce(${users.updatesConsentAt}, now())`;

// Sets the cookie for the web; the CLI passes cookie = false and takes the returned token
export async function createSession(c: Context<AppEnv>, db: Pick<Database, 'insert'>, userId: string, client = 'web', cookie = true) {
  const sessionToken = generateToken();
  const tokenHash = await hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash, expiresAt, client });
  if (cookie) setSessionCookie(c, sessionToken);
  return sessionToken;
}

async function completeLink(c: Context<AppEnv>, tx: Pick<Database, 'select' | 'update' | 'insert' | 'transaction'>, link: typeof magicLinks.$inferSelect, password?: string, cookie = true) {
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

  // The ticked opt-in for update mails counts now that the link is opened
  const consent = link.updatesOptIn ? { updatesConsentAt: consentNow } : {};
  if (registration || link.updatesOptIn) {
    [user] = await tx
      .update(users)
      .set({ ...registration, ...consent, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
  }

  if (!cookie) return c.json({ user: toUser(user), token: await createSession(c, tx, user.id, 'cli', false) });
  await createSession(c, tx, user.id);
  return c.json({ user: toUser(user) });
}

export const authRoutes = new Hono<AppEnv>()
  // Register with password
  .post('/register', zValidator('json', registerSchema), async (c) => {
    const { name, email, password, updates } = c.req.valid('json');
    const db = c.get('db');

    if (!(await mailsPerIp.hit(db, clientIp(c)))) return tooManyRequests(c);

    const existing = await findUserByEmail(db, email);
    if (!existing && !(await registrationOpen(db))) return c.json({ error: FULL }, 403);
    if (existing?.blockedAt) return c.json({ error: BLOCKED }, 403);
    if (existing?.passwordHash) {
      return c.json({ error: 'E-Mail bereits vergeben — melde dich per Magic Link an' }, 409);
    }

    // Only count towards the address once a mail goes out, so 409s can't
    // block magic links for an existing account
    if (!(await mailsPerAddress.hit(db, email.toLowerCase()))) return tooManyRequests(c);

    const token = generateToken();
    await db.insert(magicLinks).values({
      email,
      token: await hashToken(token),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 h
      name,
      passwordHash: await Bun.password.hash(password),
      updatesOptIn: updates ?? false,
    });

    await sendRegistrationEmail(email, token, updates);

    return c.json({ user: null, verificationRequired: true }, 202);
  })

  // Login with password
  .post('/login', zValidator('json', loginSchema), async (c) => {
    const { email, password } = c.req.valid('json');
    const db = c.get('db');

    const attempt = [clientIp(c), email.toLowerCase()];
    for (const key of attempt) if (!(await failedLogins.hit(db, key))) return tooManyRequests(c);

    const user = await findUserByEmail(db, email);
    if (!user?.passwordHash || !(await Bun.password.verify(password, user.passwordHash))) {
      return c.json({ error: 'E-Mail oder Passwort falsch' }, 401);
    }
    await Promise.all(attempt.map((key) => failedLogins.undo(db, key)));
    if (user.blockedAt) return c.json({ error: BLOCKED }, 403);

    await createSession(c, db, user.id);
    return c.json({ user: toUser(user) });
  })

  .post('/magic-link', zValidator('json', magicLinkSchema), async (c) => {
    const { email, next, updates } = c.req.valid('json');
    const db = c.get('db');

    if (!(await mailsPerIp.hit(db, clientIp(c)))) return tooManyRequests(c);
    const user = await findUserByEmail(db, email);
    if (!user && !(await registrationOpen(db))) return c.json({ error: FULL }, 403);
    if (user?.blockedAt) return c.json({ error: BLOCKED }, 403);
    if (!(await mailsPerAddress.hit(db, email.toLowerCase()))) return tooManyRequests(c);

    const token = generateToken();
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0');
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await db.insert(magicLinks).values({
      email,
      token: tokenHash,
      codeHash: await hashToken(code),
      expiresAt,
      updatesOptIn: updates ?? false,
    });

    await sendMagicLinkEmail(email, token, safeNextPath(next), updates, code, c.req.header('accept-language'));

    return c.json({ message: 'Magic link sent' });
  })

  .post('/verify', zValidator('json', verifyTokenSchema), async (c) => {
    const { token, password, cookie } = c.req.valid('json');
    const db = c.get('db');
    if (!(await linkChecksPerIp.hit(db, clientIp(c)))) return tooManyRequests(c);
    const tokenHash = await hashToken(token);

    return db.transaction(async (tx) => {
      const [link] = await tx
        .select()
        .from(magicLinks)
        .where(eq(magicLinks.token, tokenHash))
        .limit(1)
        .for('update');

      if (!link || link.expiresAt < new Date() || link.usedAt) {
        return c.json({ error: 'Der Link ist abgelaufen oder wurde schon benutzt.' }, 400);
      }

      return completeLink(c, tx, link, password, cookie);
    });
  })

  .post('/code/verify', zValidator('json', verifyCodeSchema), async (c) => {
    const db = c.get('db');
    if (!(await codeChecksPerIp.hit(db, clientIp(c)))) return tooManyRequests(c);
    const { email, code } = c.req.valid('json');
    const codeHash = await hashToken(code);
    return db.transaction(async (tx) => {
      // Count each guess against every active code of this address, under row locks.
      const links = await tx.update(magicLinks)
        .set({ codeAttempts: sql`${magicLinks.codeAttempts} + 1` })
        .where(and(
          sql`lower(${magicLinks.email}) = ${email.toLowerCase()}`,
          isNotNull(magicLinks.codeHash), isNull(magicLinks.usedAt),
          gt(magicLinks.expiresAt, new Date()), lt(magicLinks.codeAttempts, 5),
        )).returning();
      const link = links.find((row) => row.codeHash === codeHash);
      if (!link) return c.json({ error: loginTexts(c.req.header('accept-language')).wrongCode }, 400);
      return completeLink(c, tx, link);
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
      .select(userColumns)
      .from(users)
      .where(and(eq(users.id, session.userId), isNull(users.blockedAt)))
      .limit(1);
    if (!user) return c.json({ user: null });

    await renewSession(c, db, session, sessionToken);
    await markSeen(db, user.id);
    return c.json({ user: toUser(user) });
  })

  .patch('/me', requireAuth, zValidator('json', updateMeSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const { name, versionMails, updates } = c.req.valid('json');

    const [user] = await db
      .update(users)
      .set({
        name,
        versionMails,
        ...(updates !== undefined && { updatesConsentAt: updates ? consentNow : null }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning(userColumns);

    return c.json({ user: toUser(user) });
  });
