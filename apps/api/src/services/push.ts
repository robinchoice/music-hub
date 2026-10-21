import webpush from 'web-push';
import { eq, inArray } from 'drizzle-orm';
import { pushSubscriptions, projectMembers, type Database } from '@music-hub/db';
import { saveNotifications, type NotificationDetails } from '../lib/push-notifications.js';

export function pushSignal(id: bigint) {
  return { type: 'notification', id: id.toString() };
}

function initVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL || 'admin@musichub.app';
  if (pub && priv) {
    webpush.setVapidDetails(`mailto:${email}`, pub, priv);
  }
}

initVapid();

async function send(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: ReturnType<typeof pushSignal>,
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 7 * 86400, timeout: 10_000 },
    );
    return true;
  } catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err.statusCode === 410 || err.statusCode === 404)) return false; // subscription gone
    console.error('[Push] send error:', err instanceof Error ? err.message : String(err));
    return true;
  }
}

export async function notifyProjectMembers(
  db: Database,
  projectId: string,
  excludeUserId: string,
  payload: NotificationDetails,
): Promise<void> {
  if (!process.env.VAPID_PUBLIC_KEY) return;

  const members = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));

  const userIds = members
    .map((m: { userId: string }) => m.userId)
    .filter((id: string) => id !== excludeUserId);

  await notifyUsers(db, userIds, payload);
}

export async function notifyUsers(db: Database, userIds: string[], payload: NotificationDetails): Promise<void> {
  if (!process.env.VAPID_PUBLIC_KEY || userIds.length === 0) return;

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));

  const notifications = await saveNotifications(db, subs.map((sub) => sub.userId), payload);
  const stale: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      const notification = notifications.find((n) => n.userId === sub.userId)!;
      const ok = await send(sub, pushSignal(notification.id));
      if (!ok) stale.push(sub.id);
    }),
  );

  if (stale.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, stale));
  }
}

export async function notifyUser(
  db: Database,
  userId: string,
  payload: NotificationDetails,
): Promise<void> {
  await notifyUsers(db, [userId], payload);
}
