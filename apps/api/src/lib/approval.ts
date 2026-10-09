import { and, eq, notExists } from 'drizzle-orm';
import { openTracks, versions, type Database } from '@music-hub/db';

// The toast after an approval offers to undo it. Only whoever approved can, and only while no
// request to open the track builds on that version. Returns the version, or null if nothing changed.
export async function undoApproval(db: Database, versionId: string, userId: string) {
  const [version] = await db
    .update(versions)
    .set({ status: 'ready', decidedById: null, decidedAt: null })
    .where(
      and(
        eq(versions.id, versionId),
        eq(versions.status, 'approved'),
        eq(versions.decidedById, userId),
        notExists(db.select().from(openTracks).where(eq(openTracks.versionId, versionId))),
      ),
    )
    .returning();
  return version ?? null;
}
