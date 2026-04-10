import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { coverUploadSchema } from '@music-hub/shared';
import { requireAuth } from '../middleware/auth.js';
import { createUploadUrl } from '../storage/s3.js';
import type { AppEnv } from '../types.js';

export const uploadRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .post('/cover', zValidator('json', coverUploadSchema), async (c) => {
    const { fileName, mimeType, fileSize } = c.req.valid('json');
    const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg';
    const key = `covers/${crypto.randomUUID()}.${ext}`;
    const uploadUrl = await createUploadUrl(key, mimeType, fileSize);
    return c.json({ uploadUrl, key });
  });
