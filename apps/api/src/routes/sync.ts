import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { syncState } from '../lib/sync.js';
import type { AppEnv } from '../types.js';

export const syncRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // The sync app polls this; unchanged state answers 304 without a body
  .get('/state', async (c) => {
    const body = JSON.stringify(await syncState(c.get('db'), c.get('userId')));
    const etag = `"${new Bun.CryptoHasher('sha1').update(body).digest('hex')}"`;
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, { ETag: etag });
    return c.body(body, 200, { 'Content-Type': 'application/json', ETag: etag });
  });
