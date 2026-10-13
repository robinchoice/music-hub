import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { projectMembers, projects, stems, tracks, versions, type Database } from '@music-hub/db';

// Everything the sync app mirrors into its folder: live projects, tracks, versions and the current file of each stem.
// The app compares it with what it has; what's missing here was deleted in the hub.
export async function syncState(db: Database, userId: string) {
  const projectRows = await db
    .select({ id: projects.id, name: projects.name, artist: projects.artist, role: projectMembers.role, canUpload: projectMembers.canUpload })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.userId, userId), eq(projects.isArchived, false)))
    .orderBy(asc(projects.name));
  const projectIds = projectRows.map((p) => p.id);

  const trackRows = projectIds.length
    ? await db
        .select({ id: tracks.id, projectId: tracks.projectId, name: tracks.name })
        .from(tracks)
        .where(and(inArray(tracks.projectId, projectIds), isNull(tracks.deletedAt)))
        .orderBy(asc(tracks.name))
    : [];
  const trackIds = trackRows.map((t) => t.id);

  const versionRows = trackIds.length
    ? await db
        .select({
          id: versions.id,
          trackId: versions.trackId,
          versionNumber: versions.versionNumber,
          label: versions.label,
          originalFileName: versions.originalFileName,
          fileSize: versions.fileSize,
          sha256: versions.sha256,
          createdAt: versions.createdAt,
        })
        .from(versions)
        .where(and(inArray(versions.trackId, trackIds), isNull(versions.deletedAt)))
        .orderBy(asc(versions.versionNumber))
    : [];
  const stemRows = trackIds.length
    ? await db
        .select({
          id: stems.id,
          trackId: stems.trackId,
          name: stems.name,
          originalFileName: stems.originalFileName,
          fileSize: stems.fileSize,
          sha256: stems.sha256,
          createdAt: stems.createdAt,
          revisedAt: stems.revisedAt,
        })
        .from(stems)
        .where(and(inArray(stems.trackId, trackIds), isNull(stems.deletedAt)))
        .orderBy(asc(stems.sortOrder), asc(stems.name))
    : [];

  return {
    projects: projectRows.map((project) => ({
      ...project,
      tracks: trackRows
        .filter((t) => t.projectId === project.id)
        .map(({ projectId, ...track }) => ({
          ...track,
          versions: versionRows.filter((v) => v.trackId === track.id).map(({ trackId, ...v }) => v),
          stems: stemRows
            .filter((s) => s.trackId === track.id)
            .map(({ trackId, createdAt, revisedAt, ...s }) => ({ ...s, updatedAt: revisedAt ?? createdAt })),
        })),
    })),
  };
}
