import { TRACK_STAGES, TRACK_STATUS_LABELS, TRACK_STATUSES, type TrackStatus } from '@music-hub/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure, str } from '../command';
import { SLUG } from '../config';
import { texts } from '../texts';

const projectsSchema = z.object({
  projects: z.array(z.object({ project: z.object({ id: z.string(), name: z.string() }) })),
});
const trackSchema = z.object({ id: z.string(), name: z.string(), status: z.enum(TRACK_STATUSES) });
const tracksSchema = z.object({ tracks: z.array(trackSchema) });

const stages = TRACK_STAGES.join(', ');
const usage = (detail: string) => new Failure(texts.badOptions(detail, SLUG), EXIT.usage);

// By ID or by name, as `share --project`
function find<T extends { id: string; name: string }>(list: T[], wanted: string): T | undefined {
  return list.find((x) => x.id === wanted) ?? list.find((x) => x.name.toLowerCase() === wanted.toLowerCase());
}

// The board of the web: tracks by production stage, and moving one to another stage
export const board: Command = {
  help: [
    ['board [--project <name or ID>]', texts.boardHelp],
    ['board move <stage> --project <name or ID> --track <name or ID>', texts.boardMoveHelp(stages)],
  ],
  positionals: true,
  options: { project: { type: 'string' }, track: { type: 'string' } },
  async run({ api, session, values, positionals }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const [sub, stage, ...more] = positionals;
    const all = (await api.get('/projects', projectsSchema)).projects.map((p) => p.project);
    const wanted = str(values.project)?.trim();
    const project = wanted ? find(all, wanted) : undefined;
    if (wanted && !project) throw new Failure(texts.noSuchProject(wanted, SLUG), EXIT.error);

    if (sub === 'move' && !more.length) {
      if (!stage) throw usage(texts.boardUsage(SLUG));
      if (!(TRACK_STAGES as readonly string[]).includes(stage)) throw usage(texts.badStage(stage, stages));
      if (!project) throw usage(texts.missingOption('--project'));
      const trackName = str(values.track)?.trim();
      if (!trackName) throw usage(texts.missingOption('--track'));
      const track = find((await api.get(`/tracks/project/${project.id}`, tracksSchema)).tracks, trackName);
      if (!track) throw new Failure(texts.noSuchTrack(trackName), EXIT.error);
      const moved = (await api.patch(`/tracks/${track.id}`, z.object({ track: trackSchema }), { status: stage })).track;
      return { data: { track: { ...moved, projectId: project.id } }, text: texts.moved(moved.name, TRACK_STATUS_LABELS.en[moved.status]) };
    }
    if (sub !== undefined) throw new Failure(texts.boardUsage(SLUG), EXIT.usage);

    const chosen = project ? [project] : all;
    const lists = await Promise.all(chosen.map((p) => api.get(`/tracks/project/${p.id}`, tracksSchema)));
    const tracks = chosen.flatMap((p, i) => lists[i]!.tracks.map((t) => ({ ...t, projectId: p.id, project: p.name })));
    const column = (s: TrackStatus) => {
      const list = tracks.filter((t) => t.status === s);
      return list.length ? [`${TRACK_STATUS_LABELS.en[s]} (${list.length})`, ...list.map((t) => `  ${project ? t.name : `${t.name} · ${t.project}`}`)].join('\n') : '';
    };
    const text = TRACK_STATUSES.map(column).filter(Boolean).join('\n\n');
    return { data: { tracks }, text: text || texts.noTracksYet };
  },
};
