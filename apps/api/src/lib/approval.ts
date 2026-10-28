import { and, desc, eq, inArray, lt, notExists } from 'drizzle-orm';
import { openTracks, projectMembers, reviews, tracks, versions, type Database } from '@music-hub/db';

// The toast after an approval offers to undo it. Only whoever approved can, and only while no
// request to open the track builds on that version. The version goes back to the decision before
// (an earlier "Änderungen nötig" leaves it rejected), without one it is ready again.
// Returns the version, or null if nothing changed.
export async function undoApproval(db: Database, versionId: string, userId: string) {
  const [version] = await db.select().from(versions).where(eq(versions.id, versionId));
  if (!version?.decidedAt) return null;
  const [before] = await db
    .select({ userId: projectMembers.userId, verdict: reviews.verdict, createdAt: reviews.createdAt })
    .from(reviews)
    .innerJoin(tracks, eq(tracks.id, version.trackId))
    // A verdict decides only from someone who may approve
    .innerJoin(projectMembers, and(eq(projectMembers.projectId, tracks.projectId), eq(projectMembers.userId, reviews.userId), eq(projectMembers.canApprove, true)))
    .where(and(eq(reviews.versionId, versionId), inArray(reviews.verdict, ['approve', 'changes']), lt(reviews.createdAt, version.decidedAt)))
    .orderBy(desc(reviews.createdAt))
    .limit(1);

  const [undone] = await db
    .update(versions)
    .set({
      status: before ? (before.verdict === 'approve' ? 'approved' : 'rejected') : 'ready',
      decidedById: before?.userId ?? null,
      decidedAt: before?.createdAt ?? null,
    })
    .where(
      and(
        eq(versions.id, versionId),
        eq(versions.status, 'approved'),
        eq(versions.decidedById, userId),
        notExists(db.select().from(openTracks).where(eq(openTracks.versionId, versionId))),
      ),
    )
    .returning();
  return undone ?? null;
}
