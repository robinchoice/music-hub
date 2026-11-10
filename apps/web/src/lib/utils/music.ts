// "Meine Musik" as folders like a drive: artists, their projects, then the tracks of a project.
// The artist is no folder of its own in the database, only the artist field of a project.
import { t } from '$lib/i18n/index.js';
import type { OverviewProject, ProjectGroup, TrackInfo } from './overview.js';

export type Folder = {
  key: string;
  kind: 'artist' | 'project';
  href: string;
  name: string;
  coverUrl: string | null;
  /** Projects of an artist, tracks of a project */
  count: number;
  /** Latest activity inside, '' without any */
  changedAt: string;
};

export type Crumb = { label: string; href?: string };

export const artistOf = (project: Pick<OverviewProject, 'artist'>) => project.artist?.trim() || '';
export const artistHref = (artist: string) => `/artists/${encodeURIComponent(artist)}`;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export const projectFolder = (g: ProjectGroup): Folder => ({
  key: g.project.id,
  kind: 'project',
  href: `/projects/${g.project.id}`,
  name: g.project.name,
  coverUrl: g.project.coverUrl,
  count: g.list.length,
  changedAt: g.lastAt,
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

/** Meine Musik › Artist › Project: the path above a page */
export function musicCrumbs(artist: string, project?: { id: string; name: string }): Crumb[] {
  const crumbs: Crumb[] = [{ label: t().workspace.nav.music, href: '/music' }];
  if (artist) crumbs.push({ label: artist, href: artistHref(artist) });
  if (project) crumbs.push({ label: project.name, href: `/projects/${project.id}` });
  return crumbs;
}
