import webpush from 'web-push';
import { eq, inArray } from 'drizzle-orm';
import { pushSubscriptions, projectMembers } from '@music-hub/db';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  icon?: string;
};

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
  payload: PushPayload,
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return true;
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) return false; // subscription gone
    console.error('[Push] send error:', err.message);
    return true;
  }
}

export async function notifyProjectMembers(
  db: any,
  projectId: string,
  excludeUserId: string,
  payload: PushPayload,
): Promise<void> {
  if (!process.env.VAPID_PUBLIC_KEY) return;

  const members = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));

  const userIds = members
    .map((m: { userId: string }) => m.userId)
    .filter((id: string) => id !== excludeUserId);

  if (userIds.length === 0) return;

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));

  const stale: string[] = [];
  await Promise.all(
    subs.map(async (sub: typeof pushSubscriptions.$inferSelect) => {
      const ok = await send(sub, payload);
      if (!ok) stale.push(sub.id);
    }),
  );

  if (stale.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, stale));
  }
}

export async function notifyUser(
  db: any,
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!process.env.VAPID_PUBLIC_KEY) return;

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  const stale: string[] = [];
  await Promise.all(
    subs.map(async (sub: typeof pushSubscriptions.$inferSelect) => {
      const ok = await send(sub, payload);
      if (!ok) stale.push(sub.id);
    }),
  );

  if (stale.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, stale));
  }
}
