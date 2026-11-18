import { and, eq, isNull, sql } from 'drizzle-orm';
import { tracks, versionNotices, versions, type Database } from '@music-hub/db';
import { enqueueAudioJob } from '../services/audio-jobs.js';

// How a version enters a track, the same for an upload, a file of an import and an automatic mix:
// lockTrack first, then addVersion in the same transaction. Storage and rights stay with the caller.

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// The track's row, held until the transaction ends: two uploads never get the same version number, and
// moving or merging the track waits. undefined: the track is gone or in the trash.
export async function lockTrack(tx: Tx, trackId: string) {
  const [track] = await tx.select().from(tracks).where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt))).for('update');
  return track;
}

// The number the track's next version gets. Versions in the trash keep theirs, so they count too.
export async function nextVersionNumber(db: Pick<Database, 'select'>, trackId: string) {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${versions.versionNumber}), 0)` })
    .from(versions)
    .where(eq(versions.trackId, trackId));
  return Number(row?.max ?? 0) + 1;
}

// A new version of the track from lockTrack: the next number, its audio job for MP3 and waveform, and the
// notice that tells the project once the uploader pauses (lib/notices.ts sends it).
export async function addVersion(
  tx: Tx,
  track: { id: string; projectId: string },
  values: Omit<typeof versions.$inferInsert, 'trackId' | 'versionNumber'>,
) {
  const [version] = await tx
    .insert(versions)
    .values({ ...values, trackId: track.id, versionNumber: await nextVersionNumber(tx, track.id) })
    .returning();
  await enqueueAudioJob(tx, version.id);
  await tx.insert(versionNotices).values({ projectId: track.projectId, actorId: values.createdById, versionId: version.id });
  return version;
}
