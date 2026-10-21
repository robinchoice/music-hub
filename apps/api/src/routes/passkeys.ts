import { passkeyChallenges, passkeys, users } from '@music-hub/db';
import { type Passkey, passkeyRegisterSchema, passkeyLoginSchema, loginTexts } from '@music-hub/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { relyingParty } from '../lib/passkeys.js';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { zValidator } from '@hono/zod-validator';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';
import { createSession, toUser } from './auth.js';

const MINUTE = 60 * 1000;
// The login page asks for options on every visit, for the autofill
const optionsPerIp = rateLimit('passkey-options-per-ip', 60, 15 * MINUTE);
const loginsPerIp = rateLimit('passkey-logins-per-ip', 30, 15 * MINUTE);

// A challenge is good for one ceremony within five minutes.
async function saveChallenge(c: Context<AppEnv>, challenge: string, userId: string | null) {
  const db = c.get('db');
  await db.insert(passkeyChallenges).values({ challenge, userId, expiresAt: new Date(Date.now() + 5 * MINUTE) });
}

// Deleting it in the check keeps it single-use even when two requests race
function useChallenge(c: Context<AppEnv>, userId: string | null) {
  return async (challenge: string) => {
    const used = await c
      .get('db')
      .delete(passkeyChallenges)
      .where(
        and(
          eq(passkeyChallenges.challenge, challenge),
          userId ? eq(passkeyChallenges.userId, userId) : isNull(passkeyChallenges.userId),
          gt(passkeyChallenges.expiresAt, new Date()),
        ),
      )
      .returning({ challenge: passkeyChallenges.challenge });
    return used.length > 0;
  };
}

const passkeyColumns = {
  id: passkeys.id,
  backedUp: passkeys.backedUp,
  createdAt: passkeys.createdAt,
  lastUsedAt: passkeys.lastUsedAt,
};

const toPasskey = (row: { id: string; backedUp: boolean; createdAt: Date; lastUsedAt: Date | null }): Passkey => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});

// Adding a passkey needs a session, so only existing accounts get one and the
// closed sign-up holds. New devices and recovery go through the mail.
export const passkeyRoutes = new Hono<AppEnv>()
  .get('/', requireAuth, async (c) => {
    const rows = await c
      .get('db')
      .select(passkeyColumns)
      .from(passkeys)
      .where(eq(passkeys.userId, c.get('userId')))
      .orderBy(passkeys.createdAt);
    return c.json({ passkeys: rows.map(toPasskey) });
  })

  .post('/register/options', requireAuth, async (c) => {
    if (!(await optionsPerIp.hit(c.get('db'), clientIp(c)))) return tooManyRequests(c);
    const [user] = await c.get('db').select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, c.get('userId')));
    const existing = await c
      .get('db')
      .select({ id: passkeys.id, transports: passkeys.transports })
      .from(passkeys)
      .where(eq(passkeys.userId, user.id));
    const options = await generateRegistrationOptions({
      rpName: 'Music Hub',
      rpID: relyingParty().rpID,
      userName: user.email,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      excludeCredentials: existing.map(({ id, transports }) => (transports ? { id, transports } : { id })),
      // Discoverable, so the login needs no address and the browser can offer it as autofill
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    await saveChallenge(c, options.challenge, user.id);
    return c.json(options);
  })

  .post('/register', requireAuth, zValidator('json', passkeyRegisterSchema), async (c) => {
    const userId = c.get('userId');
    const texts = loginTexts(c.req.header('accept-language'));
    const { rpID, origins } = relyingParty();
    const result = await verifyRegistrationResponse({
      response: c.req.valid('json').response,
      expectedChallenge: useChallenge(c, userId),
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: false,
    }).catch(() => null);
    if (!result?.verified) return c.json({ error: texts.failed }, 400);

    const { credential, credentialBackedUp } = result.registrationInfo;
    const [row] = await c
      .get('db')
      .insert(passkeys)
      .values({
        id: credential.id,
        userId,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? null,
        backedUp: credentialBackedUp,
      })
      .onConflictDoNothing({ target: passkeys.id })
      .returning(passkeyColumns);
    if (!row) return c.json({ error: texts.failed }, 409);
    return c.json({ passkey: toPasskey(row) });
  })

  .delete('/:id', requireAuth, async (c) => {
    const [row] = await c
      .get('db')
      .delete(passkeys)
      .where(and(eq(passkeys.id, c.req.param('id')), eq(passkeys.userId, c.get('userId'))))
      .returning({ id: passkeys.id });
    if (!row) return c.json({ error: loginTexts(c.req.header('accept-language')).notFound }, 404);
    return c.json({ ok: true });
  })

  .post('/login/options', async (c) => {
    if (!(await optionsPerIp.hit(c.get('db'), clientIp(c)))) return tooManyRequests(c);
    // No allowCredentials: the authenticator offers the passkeys it holds for this domain
    const options = await generateAuthenticationOptions({ rpID: relyingParty().rpID, userVerification: 'preferred' });
    await saveChallenge(c, options.challenge, null);
    return c.json(options);
  })

  .post('/login', zValidator('json', passkeyLoginSchema), async (c) => {
    if (!(await loginsPerIp.hit(c.get('db'), clientIp(c)))) return tooManyRequests(c);
    const texts = loginTexts(c.req.header('accept-language'));
    const { response } = c.req.valid('json');
    const db = c.get('db');
    const [passkey] = await db
      .select({
        id: passkeys.id,
        publicKey: passkeys.publicKey,
        counter: passkeys.counter,
        transports: passkeys.transports,
        user: users,
      })
      .from(passkeys)
      .innerJoin(users, eq(users.id, passkeys.userId))
      .where(eq(passkeys.id, response.id));
    // Removed here, still on the device. The web asks the browser to forget it.
    if (!passkey) return c.json({ error: texts.unknown, code: 'passkeyUnknown' }, 400);
    if (passkey.user.blockedAt) return c.json({ error: texts.failed }, 403);

    const { rpID, origins } = relyingParty();
    const result = await verifyAuthenticationResponse({
      response: response,
      expectedChallenge: useChallenge(c, null),
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        ...(passkey.transports && { transports: passkey.transports }),
      },
      requireUserVerification: false,
    }).catch(() => null);
    if (!result?.verified) return c.json({ error: texts.failed }, 400);

    await db
      .update(passkeys)
      .set({
        counter: result.authenticationInfo.newCounter,
        backedUp: result.authenticationInfo.credentialBackedUp,
        lastUsedAt: new Date(),
      })
      .where(eq(passkeys.id, passkey.id));
    await createSession(c, db, passkey.user.id, 'passkey');
    return c.json({ user: toUser(passkey.user) });
  });
