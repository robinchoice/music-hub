import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and } from 'drizzle-orm';
import { subscribePushSchema, unsubscribePushSchema } from '@music-hub/shared';
import { pushSubscriptions } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { notificationsFor } from '../lib/push-notifications.js';
import type { AppEnv } from '../types.js';

export const pushRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/notifications', async (c) => {
    c.header('Cache-Control', 'no-store');
    const userId = c.get('userId');
    const since = c.req.query('account') === userId ? c.req.query('since') ?? '0' : '0';
    if (!/^\d{1,19}$/.test(since) || BigInt(since) > 9223372036854775807n) return c.json({ error: 'Invalid cursor' }, 400);
    return c.json({ userId, ...await notificationsFor(c.get('db'), userId, BigInt(since)) });
  })

  .get('/notifications/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!/^\d{1,19}$/.test(id) || BigInt(id) > 9223372036854775807n) return c.json({ error: 'Not found' }, 404);
    const { notifications } = await notificationsFor(c.get('db'), c.get('userId'), 0n, BigInt(id));
    if (!notifications[0]) return c.json({ error: 'Not found' }, 404);
    return c.json({ notification: notifications[0] });
  })

  .get('/vapid-public-key', (c) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return c.json({ error: 'Push not configured' }, 503);
    return c.json({ key });
  })

  .post('/subscribe', zValidator('json', subscribePushSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { endpoint, keys, userAgent } = c.req.valid('json');

    await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent },
      });

    return c.json({ ok: true }, 201);
  })

  .delete('/subscribe', zValidator('json', unsubscribePushSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const { endpoint } = c.req.valid('json');

    if (endpoint) {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
    } else {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    }

    return c.json({ ok: true });
  });
