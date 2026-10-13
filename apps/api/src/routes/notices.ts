import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { users } from '@music-hub/db';
import type { AppEnv } from '../types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const noticeRoutes = new Hono<AppEnv>()
  // Without login: the token from the mail's unsubscribe link, also used by one-click unsubscribe in mail clients
  .post('/unsubscribe', async (c) => {
    const token = c.req.query('t') ?? '';
    if (UUID.test(token)) {
      await c.get('db').update(users).set({ versionMails: false }).where(eq(users.mailToken, token));
    }
    return c.json({ ok: true });
  });
