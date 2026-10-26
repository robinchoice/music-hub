import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { versions, type Database } from '@music-hub/db';

const PLAYABLE = ['ready', 'approved', 'rejected'] as const;

// The newest playable (or approved) version of a track, null when there is none
export async function newestVersionId(db: Pick<Database, 'select'>, trackId: string, follows: string) {
  const [newest] = await db
    .select({ id: versions.id })
    .from(versions)
    .where(
      and(
        eq(versions.trackId, trackId),
        isNull(versions.deletedAt),
        follows === 'approved' ? eq(versions.status, 'approved') : inArray(versions.status, PLAYABLE),
      ),
    )
    .orderBy(desc(versions.versionNumber))
    .limit(1);
  return newest?.id ?? null;
}

// The version a link shows: its own, or the newest playable (or approved) one of its track.
// null when there is none, e.g. no version approved yet. A link that follows the track
// does not pause with the version it was made on, only with the track.
export async function shownVersionId(db: Pick<Database, 'select'>, link: { versionId: string; follows: string }) {
  if (link.follows === 'version') return link.versionId;
  const [origin] = await db.select({ trackId: versions.trackId }).from(versions).where(eq(versions.id, link.versionId));
  if (!origin) return null;
  return newestVersionId(db, origin.trackId, link.follows);
}
