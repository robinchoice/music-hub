import { and, asc, eq, exists, gt, isNull, or, sql } from 'drizzle-orm';
import { contactRequests, projectMembers, pushNotifications, tracks, users, type Database } from '@music-hub/db';

export type NotificationDetails = {
  title: string;
  body: string;
  url: string;
} & ({ projectId: string; trackId?: string; requestId?: never } | { requestId: string; projectId?: never; trackId?: never });

export async function saveNotifications(db: Database, userIds: string[], details: NotificationDetails) {
  if (!userIds.length) return [];
  return db.transaction(async (tx) => {
    // Commit in cursor order, including sends from other API instances.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('push-notifications'))`);
    return tx.insert(pushNotifications).values([...new Set(userIds)].map((userId) => ({ userId, ...details }))).returning();
  });
}

export async function pruneNotifications(db: Database) {
  await db.delete(pushNotifications).where(sql`${pushNotifications.createdAt} < now() - interval '7 days'`);
}

export async function notificationsFor(db: Database, userId: string, since: bigint, id?: bigint) {
  const n = pushNotifications;
  const rows = await db.select().from(n).where(and(
    eq(n.userId, userId),
    id === undefined ? gt(n.id, since) : eq(n.id, id),
    sql`${n.createdAt} >= now() - interval '7 days'`,
  )).orderBy(asc(n.id)).limit(50);
  const visible: { id: string; title: string; body: string; url: string }[] = [];
  for (const row of rows) {
    const [allowed] = await db.select({ id: n.id }).from(n).where(and(
      eq(n.id, row.id),
      or(
        exists(db.select().from(projectMembers).where(and(eq(projectMembers.projectId, n.projectId), eq(projectMembers.userId, userId)))),
        exists(db.select().from(contactRequests)
          .innerJoin(users, and(eq(users.id, contactRequests.fromUserId), isNull(users.blockedAt)))
          .where(and(eq(contactRequests.id, n.requestId), eq(contactRequests.toUserId, userId), eq(contactRequests.status, 'pending')))),
      ),
      or(isNull(n.trackId), exists(db.select().from(tracks).where(and(eq(tracks.id, n.trackId), eq(tracks.projectId, n.projectId), isNull(tracks.deletedAt))))),
    ));
    if (allowed) visible.push({ id: row.id.toString(), title: row.title, body: row.body, url: row.url });
  }
  return { notifications: visible, cursor: rows.at(-1)?.id.toString() ?? since.toString(), more: rows.length === 50 };
}
