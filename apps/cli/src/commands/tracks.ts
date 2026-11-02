import { TRACK_STATUS_LABELS, TRACK_STATUSES } from '@music-hub/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure } from '../command';
import { SLUG } from '../config';
import { findProject, tracksOf } from '../lookup';
import { texts } from '../texts';

const createdSchema = z.object({ track: z.looseObject({ id: z.string(), name: z.string(), status: z.enum(TRACK_STATUSES) }) });

// The tracks of a project as its page in the web lists them, and a new one
export const tracks: Command = {
  help: [
    ['tracks --project <name or ID>', texts.tracksHelp],
    ['tracks create <name> --project <name or ID>', texts.tracksCreateHelp],
  ],
  positionals: true,
  options: { project: { type: 'string' } },
  async run({ api, session, values, positionals }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const [sub, ...words] = positionals;

    if (sub === 'create') {
      const name = words.join(' ').trim();
      if (!name) throw new Failure(texts.badOptions(texts.missingName, SLUG), EXIT.usage);
      const project = await findProject(api, values.project);
      const { track } = await api.post(`/tracks/${project.id}`, createdSchema, { name });
      return { data: { track }, text: texts.trackCreated(track.name, project.name) };
    }
    if (sub !== undefined) throw new Failure(texts.tracksUsage(SLUG), EXIT.usage);

    const project = await findProject(api, values.project);
    const list = await tracksOf(api, project);
    const line = (t: (typeof list)[number]) => [t.name, TRACK_STATUS_LABELS.en[t.status], texts.versions(t.versionCount)].join(' · ');
    return { data: { project, tracks: list }, text: list.length ? list.map(line).join('\n') : texts.noTracksYet };
  },
};
