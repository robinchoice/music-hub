// "Meine Musik" as folders like a drive: artists, their projects, the tracks of a project, then
// the versions, stems and files of a track. The artist is no folder of its own in the database,
// only the artist field of a project.
import { t } from '$lib/i18n/index.js';
import type { OverviewProject, ProjectGroup, TrackInfo } from './overview.js';

export type Folder = {
  key: string;
  kind: 'artist' | 'project' | 'track';
  href: string;
  name: string;
  coverUrl: string | null;
  /** Projects of an artist, tracks of a project, versions of a track */
  count: number;
  /** Files filed with a track */
  files?: number;
  /** Latest activity inside, '' without any */
  changedAt: string;
};

export type Crumb = { label: string; href?: string };

export const artistOf = (project: Pick<OverviewProject, 'artist'>) => project.artist?.trim() || '';
export const artistHref = (artist: string) => `/artists/${encodeURIComponent(artist)}`;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

// Opened from Meine Musik a project shows its folder view: the tracks as folders and its files
export const projectFolderHref = (projectId: string) => `/projects/${projectId}?view=dateien`;
export const trackFolderHref = (projectId: string, trackId: string) => `/projects/${projectId}/tracks/${trackId}/files`;

export const projectFolder = (g: ProjectGroup): Folder => ({
  key: g.project.id,
  kind: 'project',
  href: projectFolderHref(g.project.id),
  name: g.project.name,
  coverUrl: g.project.coverUrl,
  count: g.list.length,
  changedAt: g.lastAt,
});

/** A track as a folder: its versions and the files filed with it */
export const trackFolder = (
  projectId: string,
  track: { id: string; name: string; coverUrl?: string | null },
  info: TrackInfo | undefined,
  files: number,
): Folder => ({
  key: track.id,
  kind: 'track',
  href: trackFolderHref(projectId, track.id),
  name: track.name,
  coverUrl: track.coverUrl ?? null,
  count: info?.versions.length ?? 0,
  files,
  changedAt: info?.last.at ?? '',
});

/** Artists first, then the projects without an artist, each by name */
export function musicFolders(groups: ProjectGroup[]): Folder[] {
  const artists = new Map<string, ProjectGroup[]>();
  const loose: ProjectGroup[] = [];
  for (const g of groups) {
    const artist = artistOf(g.project);
    if (!artist) loose.push(g);
    else artists.set(artist, [...(artists.get(artist) ?? []), g]);
  }
  const artistFolders = [...artists].map(([name, list]): Folder => ({
    key: `artist:${name}`,
    kind: 'artist',
    href: artistHref(name),
    name,
    coverUrl: null,
    count: list.length,
    changedAt: list.reduce((max, g) => (g.lastAt > max ? g.lastAt : max), ''),
  }));
  return [...artistFolders.sort(byName), ...loose.map(projectFolder).sort(byName)];
}

/** The tracks with the latest activity, across all projects */
export const recentTracks = (groups: ProjectGroup[], count: number): TrackInfo[] =>
  groups
    .flatMap((g) => g.list)
    .sort((a, b) => b.last.at.localeCompare(a.last.at))
    .slice(0, count);

/** Meine Musik › Artist › Project: the path above a page; asFolder leads to the project's folder view */
export function musicCrumbs(artist: string, project?: { id: string; name: string }, asFolder = false): Crumb[] {
  const crumbs: Crumb[] = [{ label: t().workspace.nav.music, href: '/music' }];
  if (artist) crumbs.push({ label: artist, href: artistHref(artist) });
  if (project) crumbs.push({ label: project.name, href: asFolder ? projectFolderHref(project.id) : `/projects/${project.id}` });
  return crumbs;
}
