import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and } from 'drizzle-orm';
import { subscribePushSchema } from '@music-hub/shared';
import { pushSubscriptions } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const pushRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

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

  .delete('/subscribe', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const body = await c.req.json().catch(() => ({}));
    const endpoint = body?.endpoint;

    if (endpoint) {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
    } else {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    }

    return c.json({ ok: true });
  });
