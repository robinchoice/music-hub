import { and, eq } from 'drizzle-orm';
import { hasPermission, memberRoles, type ProjectRole } from '@music-hub/shared';
import { projectMembers, projects, type Database } from '@music-hub/db';
import { liveTrack, liveVersion } from './trash.js';

// Who may reach what: the user's membership in a project carries their rights (canUpload, canComment,
// canApprove, role). Routes look it up here together with the track or version they were asked for,
// so the lookup and the trash rule live in one place. What a missing membership answers (404 or 403)
// stays with the route: reads hide the thing, writes refuse.

// The user's membership in the project, undefined if they are no member. An archived project is
// read-only: the membership stays (reading, managing, restoring the project), the rights to upload,
// comment and approve rest until it is restored.
export async function membershipOf(db: Pick<Database, 'select'>, projectId: string, userId: string) {
  const [row] = await db
    .select({ membership: projectMembers, archived: projects.isArchived })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!row) return undefined;
  return row.archived ? { ...row.membership, canUpload: false, canComment: false, canApprove: false } : row.membership;
}

// Whether the roles of a membership include downloading originals (versions, stems, ZIP). Listening
// stays open to every member, and an archived project doesn't take the download away.
export const mayDownload = (m: { role: ProjectRole; extraRoles?: ProjectRole[] | null }) =>
  memberRoles(m).some((r) => hasPermission(r, 'track.download'));

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
