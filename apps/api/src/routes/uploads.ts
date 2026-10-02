import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { coverUploadSchema } from '@music-hub/shared';
import { requireAuth } from '../middleware/auth.js';
import { createUploadUrl } from '../storage/s3.js';
import { takeUploadVolume, uploadVolumeExceeded } from '../lib/storage.js';
import type { AppEnv } from '../types.js';

const COVER_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

export const uploadRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .post('/cover', zValidator('json', coverUploadSchema), async (c) => {
    const { mimeType, fileSize } = c.req.valid('json');
    if (!takeUploadVolume(c.get('userId'), fileSize)) return uploadVolumeExceeded(c);
    const key = `covers/${crypto.randomUUID()}.${COVER_EXTENSIONS[mimeType]}`;
    const uploadUrl = await createUploadUrl(key, mimeType, fileSize);
    return c.json({ uploadUrl, key });
  });
