import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, lt, gt, isNull } from 'drizzle-orm';
import { deviceStartSchema, deviceApproveSchema, deviceTokenSchema } from '@music-hub/shared';
import { deviceCodes, sessions, users } from '@music-hub/db';
import { requireAuth, generateToken, hashToken } from '../middleware/auth.js';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import type { AppEnv } from '../types.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const CODE_LIFETIME = 10 * MINUTE;
// The token lives in the user's profile directory and a DAW shouldn't ask
// for a login every month, so plugin sessions outlive browser sessions.
const SESSION_LIFETIME = 180 * DAY;
const POLL_INTERVAL_SECONDS = 5;

const startsPerIp = rateLimit(20, 60 * MINUTE);
const pollsPerIp = rateLimit(300, 15 * MINUTE);
const lookupsPerUser = rateLimit(20, 15 * MINUTE);

// No letters or digits that look alike when read off a plugin window
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';

function generateUserCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

// Accepts what the user typed: lowercase, missing dash, surrounding spaces
function normalizeUserCode(input: string) {
  const chars = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

function pendingCode(userCode: string) {
  return and(
    eq(deviceCodes.userCode, userCode),
    isNull(deviceCodes.approvedAt),
    gt(deviceCodes.expiresAt, new Date()),
  );
}

export const deviceRoutes = new Hono<AppEnv>()
  // The plugin asks for a code to show the user
  .post('/', zValidator('json', deviceStartSchema), async (c) => {
    if (!startsPerIp.hit(clientIp(c))) return tooManyRequests(c);
    const db = c.get('db');
    const { client } = c.req.valid('json');

    await db.delete(deviceCodes).where(lt(deviceCodes.expiresAt, new Date()));

    const deviceCode = generateToken();
    const userCode = generateUserCode();
    const expiresAt = new Date(Date.now() + CODE_LIFETIME);
    await db.insert(deviceCodes).values({
      deviceCodeHash: await hashToken(deviceCode),
      userCode,
      client,
      expiresAt,
    });

    return c.json({
      deviceCode,
      userCode,
      verificationUrl: `${process.env.APP_URL}/device?code=${userCode}`,
      expiresAt,
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    });
  })

  // The browser shows what is asking before the user approves it
  .get('/:userCode', requireAuth, async (c) => {
    if (!lookupsPerUser.hit(c.get('userId'))) return tooManyRequests(c);
    const db = c.get('db');

    const [code] = await db
      .select({ client: deviceCodes.client, expiresAt: deviceCodes.expiresAt })
      .from(deviceCodes)
      .where(pendingCode(normalizeUserCode(c.req.param('userCode'))))
      .limit(1);
    if (!code) return c.json({ error: 'Code ungültig oder abgelaufen' }, 404);

    return c.json(code);
  })

  // The user approves the code the plugin shows
  .post('/approve', requireAuth, zValidator('json', deviceApproveSchema), async (c) => {
    const userId = c.get('userId');
    if (!lookupsPerUser.hit(userId)) return tooManyRequests(c);
    const db = c.get('db');

    const [approved] = await db
      .update(deviceCodes)
      .set({ userId, approvedAt: new Date() })
      .where(pendingCode(normalizeUserCode(c.req.valid('json').userCode)))
      .returning({ client: deviceCodes.client });
    if (!approved) return c.json({ error: 'Code ungültig oder abgelaufen' }, 404);

    return c.json({ client: approved.client });
  })

  // The plugin polls until the user has approved, then receives its session
  .post('/token', zValidator('json', deviceTokenSchema), async (c) => {
    if (!pollsPerIp.hit(clientIp(c))) return tooManyRequests(c);
    const db = c.get('db');

    const [code] = await db
      .select()
      .from(deviceCodes)
      .where(eq(deviceCodes.deviceCodeHash, await hashToken(c.req.valid('json').deviceCode)))
      .limit(1);
    if (!code || code.expiresAt < new Date()) {
      return c.json({ error: 'Code abgelaufen — bitte im Plugin neu anmelden' }, 400);
    }
    if (!code.approvedAt || !code.userId) return c.json({ status: 'pending' }, 202);

    // A code yields exactly one session
    const [redeemed] = await db.delete(deviceCodes).where(eq(deviceCodes.id, code.id)).returning({ id: deviceCodes.id });
    if (!redeemed) return c.json({ error: 'Code abgelaufen — bitte im Plugin neu anmelden' }, 400);

    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME);
    await db.insert(sessions).values({ userId: code.userId, tokenHash: await hashToken(token), expiresAt });

    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, code.userId))
      .limit(1);

    return c.json({ token, expiresAt, user });
  });
