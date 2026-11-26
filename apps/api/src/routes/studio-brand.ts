import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { users } from '@music-hub/db';
import { DELIVERY_ERRORS, studioBrandSchema } from '@music-hub/shared';
import { requireAuth } from '../middleware/auth.js';
import { runInBackground } from '../lib/background.js';
import { locale } from '../lib/i18n.js';
import { studioBrandOf } from '../lib/studio-brand.js';
import { deleteUnusedFiles } from '../lib/trash.js';
import { getObjectSize } from '../storage/s3.js';
import type { AppEnv } from '../types.js';

// The caller's studio brand, see lib/studio-brand.ts. Anyone may set it; it only shows on the guest page
// while the plan is Studio, so a plan that ends keeps it for the next one.

export const studioBrandRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => c.json({ brand: await studioBrandOf(c.get('db'), c.get('userId')) }))

  // undefined keeps a value, null or an empty text clears it
  .put('/', zValidator('json', studioBrandSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const input = c.req.valid('json');
    const set: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) set.studioName = input.name || null;
    if (input.line !== undefined) set.studioLine = input.line || null;
    if (input.logoKey !== undefined) {
      // Only a logo that reached the bucket through POST /uploads/cover
      if (input.logoKey !== null && (await getObjectSize(input.logoKey)) === null) {
        return c.json({ error: DELIVERY_ERRORS[locale(c)].logo_missing, code: 'logo_missing' }, 400);
      }
      set.studioLogoKey = input.logoKey;
    }
    const [before] = await db.select({ logoKey: users.studioLogoKey }).from(users).where(eq(users.id, userId)).limit(1);
    if (Object.keys(set).length) await db.update(users).set({ ...set, updatedAt: new Date() }).where(eq(users.id, userId));
    // A replaced logo goes unless another row still points to it
    if (set.studioLogoKey !== undefined && before?.logoKey && before.logoKey !== set.studioLogoKey) {
      const old = before.logoKey;
      runInBackground(deleteUnusedFiles(db, [old]).catch((err: unknown) => console.error('[Studio] Could not delete the old logo', err)));
    }
    return c.json({ brand: await studioBrandOf(db, userId) });
  });
