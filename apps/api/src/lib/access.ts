import { and, eq } from 'drizzle-orm';
import { projectMembers, type Database } from '@music-hub/db';
import { liveTrack, liveVersion } from './trash.js';

// Who may reach what: the user's membership in a project carries their rights (canUpload, canComment,
// canApprove, role). Routes look it up here together with the track or version they were asked for,
// so the lookup and the trash rule live in one place. What a missing membership answers (404 or 403)
// stays with the route: reads hide the thing, writes refuse.

// The user's membership in the project, undefined if they are no member
export async function membershipOf(db: Pick<Database, 'select'>, projectId: string, userId: string) {
  const [membership] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return membership;
}

// The track with the user's membership in its project. null: no such track, or it is in the trash.
export async function trackAccess(db: Database, trackId: string, userId: string) {
  const track = await liveTrack(db, trackId);
  if (!track) return null;
  return { track, membership: await membershipOf(db, track.projectId, userId) };
}

// The version with its track and the user's membership in the project. null: version or track gone or in the trash.
export async function versionAccess(db: Database, versionId: string, userId: string) {
  const found = await liveVersion(db, versionId);
  if (!found) return null;
  return { ...found, membership: await membershipOf(db, found.track.projectId, userId) };
}
