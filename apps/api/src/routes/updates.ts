import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, count, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { updateDeliveries, updates, users } from '@music-hub/db';
import { saveUpdateSchema, type UpdateSummary, updateComplete } from '@music-hub/shared';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../lib/admin.js';
import { rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { imageType, redact, UUID } from '../lib/updates.js';
import { TEST_ACCOUNT_EMAIL } from '../lib/users.js';
import { sendUpdateMail, updateMail } from '../services/email.js';
import type { AppEnv } from '../types.js';
import { t } from '../lib/i18n.js';

const HOUR = 60 * 60 * 1000;
const testMailsPerUser = rateLimit('update-tests-per-user', 20, HOUR);
const sendsPerUser = rateLimit('update-sends-per-user', 5, HOUR);

const NOT_FOUND = 'Update nicht gefunden';
const ALREADY_SENT = 'Dieses Update ist schon versendet.';
const INCOMPLETE = 'Zum Senden braucht das Update einen Titel und ein Feature.';
const INVALID_IMAGE = 'Das Bild muss ein PNG oder JPEG sein.';

const counts = (status: string) => sql<number>`count(*) filter (where ${updateDeliveries.status} = ${status})::int`;

async function summaries(c: Context<AppEnv>, id?: string): Promise<UpdateSummary[]> {
  const db = c.get('db');
  const deliveries = db
    .select({
      updateId: updateDeliveries.updateId,
      sent: counts('sent').as('sent'),
      failed: counts('failed').as('failed'),
      pending: counts('pending').as('pending'),
    })
    .from(updateDeliveries)
    .groupBy(updateDeliveries.updateId)
    .as('deliveries');
  const rows = await db
    .select({
      id: updates.id,
      slug: updates.slug,
      content: updates.content,
      hasImage: sql<boolean>`${updates.image} is not null`,
      createdAt: updates.createdAt,
      sentAt: updates.sentAt,
      sent: deliveries.sent,
      failed: deliveries.failed,
      pending: deliveries.pending,
    })
    .from(updates)
    .leftJoin(deliveries, eq(deliveries.updateId, updates.id))
    .where(id ? eq(updates.id, id) : undefined)
    .orderBy(desc(updates.createdAt));
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    sent: row.sent ?? 0,
    failed: row.failed ?? 0,
    pending: row.pending ?? 0,
  }));
}

// The update and the admin's own address and mail token, for previews and test mails
async function forAdmin(c: Context<AppEnv>) {
  const id = c.req.param('id') ?? '';
  if (!UUID.test(id)) return null;
  const db = c.get('db');
  const [update] = await db
    .select({ content: updates.content, image: updates.image, sentAt: updates.sentAt })
    .from(updates)
    .where(eq(updates.id, id));
  if (!update) return null;
  const [user] = await db
    .select({ email: users.email, token: users.mailToken })
    .from(users)
    .where(eq(users.id, c.get('userId')));
  return {
    update: { id, content: update.content, hasImage: !!update.image, date: update.sentAt ?? new Date() },
    user: user!,
  };
}

// Unsubscribing and subscribing again with the token from the mail, no login.
// The one-click POST from the mail client lands here as well. Like the version
// mails it answers ok for unknown tokens too.
async function setConsent(c: Context<AppEnv>, on: boolean) {
  const token = c.req.query('t') ?? '';
  if (UUID.test(token)) {
    await c
      .get('db')
      .update(users)
      .set({ updatesConsentAt: on ? sql`coalesce(${users.updatesConsentAt}, now())` : null })
      .where(eq(users.mailToken, token));
  }
  return c.json({ ok: true });
}

export const updateRoutes = new Hono<AppEnv>()
  .post('/unsubscribe', (c) => setConsent(c, false))
  .post('/subscribe', (c) => setConsent(c, true))

  // Linked from the mails, so without login. The random id is the key.
  .get('/:id/image', async (c) => {
    const id = c.req.param('id');
    const [row] = UUID.test(id)
      ? await c.get('db').select({ image: updates.image, sentAt: updates.sentAt }).from(updates).where(eq(updates.id, id))
      : [];
    if (!row?.image) return c.json({ error: NOT_FOUND }, 404);
    // A draft's image may still change, the preview must not show an old one
    return c.body(new Uint8Array(row.image), 200, {
      'content-type': imageType(row.image)!,
      'cache-control': row.sentAt ? 'public, max-age=86400' : 'no-cache',
    });
  })

  // Only admins from ADMIN_EMAILS. admin@pleasance.org is not among them, so
  // agents write drafts as files and never send.
  .use('*', requireAuth, requireAdmin)

  .get('/', async (c) => {
    const [subscribers] = await c
      .get('db')
      .select({ count: count() })
      .from(users)
      .where(and(isNotNull(users.updatesConsentAt), isNull(users.blockedAt), ne(users.email, TEST_ACCOUNT_EMAIL)));
    return c.json({ updates: await summaries(c), subscribers: subscribers!.count });
  })

  .post('/', zValidator('json', saveUpdateSchema), async (c) => {
    const { content, image } = c.req.valid('json');
    const bytes = image ? Buffer.from(image, 'base64') : null;
    if (bytes && !imageType(bytes)) return c.json({ error: INVALID_IMAGE }, 400);
    const [row] = await c.get('db').insert(updates).values({ content, image: bytes }).returning({ id: updates.id });
    return c.json({ update: (await summaries(c, row!.id))[0] });
  })

  // Drafts only, a sent update stays as it went out
  .put('/:id', zValidator('json', saveUpdateSchema), async (c) => {
    const id = c.req.param('id');
    const { content, image } = c.req.valid('json');
    const bytes = image == null ? image : Buffer.from(image, 'base64');
    if (bytes && !imageType(bytes)) return c.json({ error: INVALID_IMAGE }, 400);
    const [row] = UUID.test(id)
      ? await c
          .get('db')
          .update(updates)
          .set({ content, image: bytes, updatedAt: new Date() })
          .where(and(eq(updates.id, id), isNull(updates.sentAt)))
          .returning({ id: updates.id })
      : [];
    if (!row) return c.json({ error: ALREADY_SENT }, 409);
    return c.json({ update: (await summaries(c, id))[0] });
  })

  .delete('/:id', async (c) => {
    const id = c.req.param('id');
    const [row] = UUID.test(id)
      ? await c
          .get('db')
          .delete(updates)
          .where(and(eq(updates.id, id), isNull(updates.sentAt)))
          .returning({ id: updates.id })
      : [];
    if (!row) return c.json({ error: ALREADY_SENT }, 409);
    return c.json({ ok: true });
  })

  // The mail as recipients see it, for the iframe on the admin page
  .get('/:id/preview', async (c) => {
    const found = await forAdmin(c);
    if (!found) return c.json({ error: NOT_FOUND }, 404);
    c.header('content-security-policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline'");
    return c.html(updateMail(found.update, found.user.token).html);
  })

  // To the admin, before and after sending
  .post('/:id/test', async (c) => {
    if (!(await testMailsPerUser.hit(c.get('db'), c.get('userId')))) return tooManyRequests(c);
    const found = await forAdmin(c);
    if (!found) return c.json({ error: NOT_FOUND }, 404);
    try {
      await sendUpdateMail(found.user.email, updateMail(found.update, found.user.token));
    } catch (err) {
      // Not to the global handler, SMTP errors may quote the address
      console.error(`[Updates] Test mail of update ${found.update.id} failed: ${redact(err)}`);
      return c.json({ error: t(c).errors.testMailFailed }, 502);
    }
    return c.json({ ok: true });
  })

  // Queues one delivery per opted-in account, the API sends them throttled
  // (deliverUpdates). Marking it sent first makes a double click harmless.
  // The onboarding test account has no mailbox, it never gets one.
  .post('/:id/send', async (c) => {
    if (!(await sendsPerUser.hit(c.get('db'), c.get('userId')))) return tooManyRequests(c);
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: NOT_FOUND }, 404);
    // Checked on the locked row, so a save from another tab can't slip in between
    const error = await c.get('db').transaction(async (tx) => {
      const [row] = await tx
        .select({ content: updates.content, sentAt: updates.sentAt })
        .from(updates)
        .where(eq(updates.id, id))
        .for('update');
      if (!row) return NOT_FOUND;
      if (row.sentAt) return ALREADY_SENT;
      if (!updateComplete(row.content)) return INCOMPLETE;
      await tx.update(updates).set({ sentAt: new Date() }).where(eq(updates.id, id));
      await tx.execute(
        sql`insert into ${updateDeliveries} (update_id, user_id) select ${id}::uuid, id from ${users} where updates_consent_at is not null and blocked_at is null and email <> ${TEST_ACCOUNT_EMAIL}`,
      );
      return null;
    });
    if (error) return c.json({ error }, error === NOT_FOUND ? 404 : error === INCOMPLETE ? 400 : 409);
    return c.json({ update: (await summaries(c, id))[0] });
  });
