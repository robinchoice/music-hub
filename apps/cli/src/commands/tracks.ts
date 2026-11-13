import { TRACK_STATUS_LABELS, TRACK_STATUSES } from '@music-hub/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure, str } from '../command';
import { SLUG } from '../config';
import { findProject, findTrack, type Project, tracksOf } from '../lookup';
import { texts } from '../texts';

const createdSchema = z.object({ track: z.looseObject({ id: z.string(), name: z.string(), status: z.enum(TRACK_STATUSES) }) });
const trackSchema = z.object({ track: z.looseObject({ id: z.string(), name: z.string(), section: z.string().nullable() }).nullable() });
const mergeSchema = z.object({
  preview: z.object({
    versions: z.array(z.object({ id: z.string(), from: z.number(), to: z.number(), duplicateOf: z.number().nullable() })),
    stems: z.object({ added: z.number(), revised: z.number(), duplicates: z.number() }),
    files: z.number(),
  }),
  track: z.looseObject({ id: z.string(), name: z.string() }).nullable(),
});
const duplicatesSchema = z.object({
  groups: z.array(
    z.object({
      reasons: z.array(z.enum(['file', 'name'])),
      tracks: z.array(z.looseObject({ id: z.string(), name: z.string(), projectId: z.string(), section: z.string().nullable(), versionCount: z.number() })),
    }),
  ),
});

const projectNamesSchema = z.object({ projects: z.array(z.object({ project: z.object({ id: z.string(), name: z.string() }) })) });

const usage = () => new Failure(texts.tracksUsage(SLUG), EXIT.usage);
const where = (project: Project, section: string | null) => (section ? `${project.name} › ${section}` : project.name);

// The tracks of a project as its page in the web lists them, a new one, and tidying up: moving, merging,
// renaming, sections and possible duplicates
export const tracks: Command = {
  help: [
    ['tracks --project <name or ID>', texts.tracksHelp],
    ['tracks create <name> --project <name or ID>', texts.tracksCreateHelp],
    ['tracks rename <new name> --project <…> --track <…>', texts.tracksRenameHelp],
    ['tracks section <name> --project <…> --track <…>  |  --none', texts.tracksSectionHelp],
    ['tracks move --project <…> --track <…> --to <project> [--section <name> | --none]', texts.tracksMoveHelp],
    ['tracks merge --project <…> --track <…> --into <track> [--into-project <…>] [--dry-run]', texts.tracksMergeHelp],
    ['tracks duplicates [--project <…>]', texts.tracksDuplicatesHelp],
  ],
  positionals: true,
  options: {
    project: { type: 'string' },
    track: { type: 'string' },
    to: { type: 'string' },
    section: { type: 'string' },
    none: { type: 'boolean' },
    into: { type: 'string' },
    'into-project': { type: 'string' },
    'dry-run': { type: 'boolean' },
  },
  async run({ api, session, values, positionals }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const [sub, ...words] = positionals;
    const name = words.join(' ').trim();

    if (sub === 'create') {
      if (!name) throw new Failure(texts.badOptions(texts.missingName, SLUG), EXIT.usage);
      const project = await findProject(api, values.project);
      const { track } = await api.post(`/tracks/${project.id}`, createdSchema, { name });
      return { data: { track }, text: texts.trackCreated(track.name, project.name) };
    }

    if (sub === 'rename') {
      if (!name) throw new Failure(texts.badOptions(texts.missingName, SLUG), EXIT.usage);
      const { track } = await findTrack(api, values);
      const { track: renamed } = await api.patch(`/tracks/${track.id}`, trackSchema, { name });
      return { data: { track: renamed }, text: texts.trackRenamed(track.name, name) };
    }

    if (sub === 'section') {
      if (!name && !values.none) throw new Failure(texts.badOptions(texts.missingSection, SLUG), EXIT.usage);
      const { project, track } = await findTrack(api, values);
      const section = values.none ? null : name;
      const { track: changed } = await api.patch(`/tracks/${track.id}`, trackSchema, { section });
      return { data: { track: changed }, text: texts.trackMoved(track.name, where(project, section)) };
    }

    if (sub === 'move' && !words.length) {
      if (!str(values.to)) throw new Failure(texts.badOptions(texts.missingOption('--to'), SLUG), EXIT.usage);
      const { track } = await findTrack(api, values);
      const to = await findProject(api, values.to);
      const section = values.none ? null : str(values.section)?.trim();
      const { track: moved } = await api.post(`/tracks/${track.id}/move`, trackSchema, { projectId: to.id, ...(section !== undefined && { section }) });
      return { data: { track: moved }, text: texts.trackMoved(track.name, where(to, moved?.section ?? null)) };
    }

    if (sub === 'merge' && !words.length) {
      if (!str(values.into)) throw new Failure(texts.badOptions(texts.missingOption('--into'), SLUG), EXIT.usage);
      const { project, track } = await findTrack(api, values);
      const intoProject = values['into-project'] ? await findProject(api, values['into-project']) : project;
      const target = await findTrack(api, { project: intoProject.id, track: values.into });
      const dryRun = values['dry-run'] === true;
      const { preview, track: merged } = await api.post(`/tracks/${track.id}/merge`, mergeSchema, { intoTrackId: target.track.id, dryRun });
      const lines = [
        (dryRun ? texts.wouldMerge : texts.merged)(track.name, target.track.name),
        ...preview.versions.map((v) => texts.mergedVersion(v.from, v.to, v.duplicateOf)),
        texts.mergedStems(preview.stems.added, preview.stems.revised, preview.stems.duplicates),
        ...(preview.files ? [texts.mergedFiles(preview.files)] : []),
      ];
      return { data: { preview, track: merged, dryRun }, text: lines.join('\n') };
    }

    if (sub === 'duplicates' && !words.length) {
      const project = values.project ? await findProject(api, values.project) : null;
      const { groups } = await api.get(`/tracks/duplicates${project ? `?projectId=${project.id}` : ''}`, duplicatesSchema);
      if (!groups.length) return { data: { groups }, text: texts.noDuplicates };
      const names = new Map((await api.get('/projects', projectNamesSchema)).projects.map((p) => [p.project.id, p.project.name]));
      const text = groups
        .map((g) =>
          [
            texts.duplicateGroup(g.reasons),
            ...g.tracks.map((t) => `  ${t.name} · ${[names.get(t.projectId) ?? t.projectId, t.section].filter(Boolean).join(' › ')} · ${texts.versions(t.versionCount)} · ${t.id}`),
          ].join('\n'),
        )
        .join('\n\n');
      return { data: { groups }, text };
    }

    if (sub !== undefined) throw usage();
    const project = await findProject(api, values.project);
    const list = await tracksOf(api, project);
    const line = (t: (typeof list)[number]) => [t.name, TRACK_STATUS_LABELS.en[t.status], texts.versions(t.versionCount)].join(' · ');
    return { data: { project, tracks: list }, text: list.length ? list.map(line).join('\n') : texts.noTracksYet };
  },
};

