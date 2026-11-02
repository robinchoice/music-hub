import { TRACK_STATUSES, VERSION_STATUSES } from '@music-hub/shared';
import { z } from 'zod';
import type { Client } from './client';
import { EXIT, Failure, str } from './command';
import { SLUG } from './config';
import { texts } from './texts';

// Project, track and version from --project, --track and --version, by name or ID as `share --project`

const projectsSchema = z.object({
  projects: z.array(z.object({ project: z.object({ id: z.string(), name: z.string() }) })),
});
const tracksSchema = z.object({
  tracks: z.array(z.looseObject({ id: z.string(), name: z.string(), status: z.enum(TRACK_STATUSES), versionCount: z.number() })),
});
// The fields the texts need; --json passes on the whole answer
const versionsSchema = z.object({
  versions: z.array(
    z.looseObject({
      id: z.string(),
      versionNumber: z.number(),
      label: z.string().nullable(),
      autoMix: z.boolean().optional(),
      status: z.enum(VERSION_STATUSES),
      originalFileName: z.string(),
      fileSize: z.number(),
      openCommentCount: z.number(),
      createdAt: z.string(),
    }),
  ),
});

export type Project = { id: string; name: string };
export type Track = z.infer<typeof tracksSchema>['tracks'][number];
export type Version = z.infer<typeof versionsSchema>['versions'][number];

const usage = (detail: string) => new Failure(texts.badOptions(detail, SLUG), EXIT.usage);

function find<T extends { id: string; name: string }>(list: T[], wanted: string): T | undefined {
  return list.find((x) => x.id === wanted) ?? list.find((x) => x.name.toLowerCase() === wanted.toLowerCase());
}

export async function findProject(api: Client, value: unknown): Promise<Project> {
  const wanted = str(value)?.trim();
  if (!wanted) throw usage(texts.missingOption('--project'));
  const project = find((await api.get('/projects', projectsSchema)).projects.map((p) => p.project), wanted);
  if (!project) throw new Failure(texts.noSuchProject(wanted, SLUG), EXIT.error);
  return project;
}

export const tracksOf = async (api: Client, project: Project) => (await api.get(`/tracks/project/${project.id}`, tracksSchema)).tracks;

export async function findTrack(api: Client, values: Record<string, unknown>): Promise<{ project: Project; track: Track }> {
  const wanted = str(values.track)?.trim();
  if (!wanted) throw usage(texts.missingOption('--track'));
  const project = await findProject(api, values.project);
  const track = find(await tracksOf(api, project), wanted);
  if (!track) throw new Failure(texts.noSuchTrack(wanted), EXIT.error);
  return { project, track };
}

// Newest first, as the API lists them
export const versionsOf = async (api: Client, track: Track) => (await api.get(`/versions/track/${track.id}`, versionsSchema)).versions;

// --version as 3, V3 or ID; without it the newest version
export async function findVersion(api: Client, values: Record<string, unknown>) {
  const { project, track } = await findTrack(api, values);
  const list = await versionsOf(api, track);
  const wanted = str(values.version)?.trim();
  const number = wanted && /^v?\d+$/i.test(wanted) ? Number(wanted.replace(/^v/i, '')) : null;
  const version = wanted ? list.find((v) => v.id === wanted || v.versionNumber === number) : list[0];
  if (!version) throw new Failure(wanted ? texts.noSuchVersion(wanted, track.name) : texts.noVersions(track.name), EXIT.error);
  return { project, track, version };
}
