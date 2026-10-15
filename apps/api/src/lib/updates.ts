import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { updateDeliveries, updates, users, type Database } from '@music-hub/db';
import { type UpdateContent, updateComplete } from '@music-hub/shared';
import { sendUpdateMail, updateMail } from '../services/email.js';

// Agents write drafts as updates/<slug>.md in the repo, admins send them in
// /admin/updates (README, „Update-Mails“). Format:
//
//   # Spuren lassen sich jetzt als ZIP laden
//   - Ein Klick lädt alle Spuren eines Tracks.
//   ![](zip.png)
export const DRAFTS_DIR = path.join(import.meta.dir, '../../../../updates');

export type Draft = { slug: string; content: UpdateContent; image: Buffer | null };

// The image formats we accept, by their magic bytes
export function imageType(bytes: Buffer) {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  return null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseDraft(slug: string, text: string, dir = DRAFTS_DIR): Draft {
  const content: UpdateContent = { title: '', features: [] };
  let image: Buffer | null = null;
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    const heading = line.match(/^#\s+(.+)$/);
    const item = line.match(/^[-*]\s+(.+)$/);
    const picture = line.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (!line) continue;
    if (heading && !content.title) {
      content.title = heading[1]!.trim();
    } else if (item && content.title) {
      content.features.push(item[1]!.trim());
    } else if (picture) {
      image = readFileSync(path.join(dir, picture[1]!));
      if (!imageType(image)) throw new Error(`updates/${slug}.md: ${picture[1]} is no PNG or JPEG`);
    } else {
      throw new Error(`updates/${slug}.md, line ${index + 1}: expected "# Title", "- Feature" or "![](image.png)"`);
    }
  }
  if (!updateComplete(content)) throw new Error(`updates/${slug}.md needs a title and at least one feature`);
  return { slug, content, image };
}

export function readDrafts(dir = DRAFTS_DIR) {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => parseDraft(file.slice(0, -3), readFileSync(path.join(dir, file), 'utf8'), dir));
}

// On every API start. A file becomes a draft once and is never overwritten, so
// edits in the admin page stay. A broken file only costs its own draft, the
// API test parses all of them before a deploy.
export async function importDrafts(db: Database) {
  let drafts: Draft[];
  try {
    drafts = readDrafts();
  } catch (err) {
    console.error('[Updates] Drafts not imported:', err);
    return;
  }
  for (const draft of drafts) await db.insert(updates).values(draft).onConflictDoNothing();
}

const MAX_ATTEMPTS = 3;
// A failed delivery waits this long, the SMTP server may be over its limit
const RETRY_MS = 60_000;

// SMTP errors may quote the recipient, the log gets neither address nor name
export function redact(err: unknown) {
  const { responseCode, code, message } = err as { responseCode?: number; code?: string; message?: string };
  const text = String(message ?? err).replace(/[^\s<>"'@]+@[^\s<>"'@]+/g, '<address>');
  return [responseCode ?? code, text].filter(Boolean).join(' ');
}

// Sends the oldest due delivery, at most one per intervalMs across all API
// instances: an advisory lock lets one instance at a time in, and the last
// attempt of any instance sets the pace. The row stays locked until it is
// marked, so no mail goes out twice. 'wait' means another instance or the pace
// holds it back.
export function deliverNext(db: Database, intervalMs: number): Promise<'idle' | 'wait' | 'sent' | 'skipped' | 'failed'> {
  return db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('update-mails')) as ok`);
    if (!lock?.ok) return 'wait';
    const [recent] = await tx
      .select({ id: updateDeliveries.id })
      .from(updateDeliveries)
      .where(gt(updateDeliveries.attemptedAt, sql`now() - make_interval(secs => ${intervalMs / 1000})`))
      .limit(1);
    if (recent) return 'wait';

    const [row] = await tx
      .select({
        id: updateDeliveries.id,
        attempts: updateDeliveries.attempts,
        updateId: updates.id,
        content: updates.content,
        hasImage: sql<boolean>`${updates.image} is not null`,
        sentAt: updates.sentAt,
        email: users.email,
        consent: users.updatesConsentAt,
        blocked: users.blockedAt,
        token: users.mailToken,
      })
      .from(updateDeliveries)
      .innerJoin(updates, eq(updates.id, updateDeliveries.updateId))
      .innerJoin(users, eq(users.id, updateDeliveries.userId))
      .where(
        and(
          eq(updateDeliveries.status, 'pending'),
          or(isNull(updateDeliveries.attemptedAt), lt(updateDeliveries.attemptedAt, sql`now() - make_interval(secs => ${RETRY_MS / 1000})`)),
        ),
      )
      .orderBy(asc(updateDeliveries.createdAt))
      .limit(1)
      .for('update', { of: updateDeliveries, skipLocked: true });
    if (!row) return 'idle';

    const mark = (status: string) =>
      tx
        .update(updateDeliveries)
        .set({ status, attempts: row.attempts + 1, attemptedAt: sql`now()` })
        .where(eq(updateDeliveries.id, row.id));

    // Unsubscribed or blocked since the admin pressed send
    if (!row.consent || row.blocked) {
      await tx.update(updateDeliveries).set({ status: 'skipped' }).where(eq(updateDeliveries.id, row.id));
      return 'skipped';
    }

    const mail = updateMail({ id: row.updateId, content: row.content, hasImage: row.hasImage, date: row.sentAt! }, row.token);
    try {
      await sendUpdateMail(row.email, mail);
    } catch (err) {
      console.error(`[Updates] Delivery ${row.id} of update ${row.updateId} failed, attempt ${row.attempts + 1}: ${redact(err)}`);
      await mark(row.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending');
      return 'failed';
    }
    await mark('sent');
    return 'sent';
  });
}

// Runs in the API like the version notices: the worker has no SMTP. Proton's
// SMTP limits the rate, so one mail per UPDATE_MAIL_INTERVAL_MS across all instances.
export async function deliverUpdates(db: Database, onError: (err: unknown) => void) {
  const interval = Number(process.env.UPDATE_MAIL_INTERVAL_MS || 6000);
  while (true) {
    const result = await deliverNext(db, interval).catch((err) => {
      console.error('[Updates] Delivery crashed:', err);
      onError(err);
      return 'failed' as const;
    });
    // Nothing due: look again soon. The pace and retries are kept in deliverNext.
    await Bun.sleep({ idle: 10_000, wait: interval, sent: interval, skipped: 0, failed: interval }[result]);
  }
}
