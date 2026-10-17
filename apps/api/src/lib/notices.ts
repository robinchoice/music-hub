import { and, asc, eq, inArray, isNull, max, min, ne, or, sql } from 'drizzle-orm';
import { projectMembers, projects, pushSubscriptions, tracks, users, versionNotices, versions, type Database } from '@music-hub/db';
import { notifyUsers } from '../services/push.js';
import { sendVersionsEmail } from '../services/email.js';

// A batch goes out once its uploader has been quiet this long, or at the latest after MAX_WAIT
export const QUIET = '2 minutes';
export const MAX_WAIT = '10 minutes';

export async function queueVersionNotice(db: Database, projectId: string, actorId: string, versionId: string) {
  await db.insert(versionNotices).values({ projectId, actorId, versionId });
}

export type NoticeBatch = Awaited<ReturnType<typeof takeDueNotices>>[number];

// Takes the notices that are due off the queue, one batch per project and uploader.
// Deleting them first means two workers never announce the same version twice.
export async function takeDueNotices(db: Database) {
  const due = await db
    .select({ projectId: versionNotices.projectId, actorId: versionNotices.actorId })
    .from(versionNotices)
    .groupBy(versionNotices.projectId, versionNotices.actorId)
    .having(
      or(
        sql`${max(versionNotices.createdAt)} < now() - ${QUIET}::interval`,
        sql`${min(versionNotices.createdAt)} < now() - ${MAX_WAIT}::interval`,
      ),
    );

  const batches = [];
  for (const { projectId, actorId } of due) {
    const taken = await db
      .delete(versionNotices)
      .where(and(eq(versionNotices.projectId, projectId), eq(versionNotices.actorId, actorId)))
      .returning({ versionId: versionNotices.versionId });
    if (taken.length === 0) continue;

    // Versions moved to the trash in the meantime stay quiet
    const items = await db
      .select({ versionId: versions.id, versionNumber: versions.versionNumber, trackId: tracks.id, trackName: tracks.name })
      .from(versions)
      .innerJoin(tracks, eq(tracks.id, versions.trackId))
      .where(and(inArray(versions.id, taken.map((t) => t.versionId)), isNull(versions.deletedAt), isNull(tracks.deletedAt)))
      .orderBy(asc(tracks.name), asc(versions.versionNumber));
    if (items.length === 0) continue;

    const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId));
    const [actor] = await db.select({ name: users.name }).from(users).where(eq(users.id, actorId));
    const members = await db
      .select({
        userId: users.id,
        email: users.email,
        mailToken: users.mailToken,
        versionMails: users.versionMails,
        blocked: sql<boolean>`${users.blockedAt} is not null`,
        hasPush: sql<boolean>`exists (select 1 from ${pushSubscriptions} where ${pushSubscriptions.userId} = ${users.id})`,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(and(eq(projectMembers.projectId, projectId), ne(projectMembers.userId, actorId)));

    batches.push({
      projectId,
      projectName: project.name,
      actorName: actor.name,
      items,
      pushTo: members.filter((m) => m.hasPush && !m.blocked).map((m) => m.userId),
      mailTo: members
        .filter((m) => !m.hasPush && m.versionMails && !m.blocked)
        .map((m) => ({ email: m.email, mailToken: m.mailToken })),
    });
  }
  return batches;
}

export async function deliverNotices(db: Database, batch: NoticeBatch) {
  const [first] = batch.items;
  const payload =
    batch.items.length === 1
      ? { title: 'Neue Version', body: `${first.trackName} — V${first.versionNumber} hochgeladen`, url: `/projects/${batch.projectId}/tracks/${first.trackId}` }
      : { title: 'Neue Versionen', body: `${batch.actorName}: ${batch.items.length} neue Versionen in ${batch.projectName}`, url: `/projects/${batch.projectId}` };
  await notifyUsers(db, batch.pushTo, { ...payload, projectId: batch.projectId, ...(batch.items.length === 1 ? { trackId: first.trackId } : {}) });
  for (const { email, mailToken } of batch.mailTo) {
    await sendVersionsEmail(email, mailToken, batch).catch((err) => console.error('[Notices] Mail failed:', err));
  }
}

export async function sendDueNotices(db: Database) {
  for (const batch of await takeDueNotices(db)) await deliverNotices(db, batch);
}
