import { PROJECT_ROLES, ROLE_LABELS } from '@music-hub/shared';
import { z } from 'zod';
import { type Command, EXIT, Failure } from '../command';
import { SLUG } from '../config';
import { texts } from '../texts';

const projectsSchema = z.object({
  projects: z.array(
    z.object({
      project: z.object({ id: z.string(), name: z.string(), artist: z.string().nullable() }),
      roles: z.array(z.enum(PROJECT_ROLES)),
      trackCount: z.number(),
    }),
  ),
});

// The projects the sidebar of the web shows, over the same API. New commands follow it (README, „CLI“).
export const projects: Command = {
  help: [['projects [--archived]', texts.projectsHelp]],
  options: { archived: { type: 'boolean' } },
  async run({ api, session, values }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const list = (await api.get(values.archived ? '/projects?archived=1' : '/projects', projectsSchema)).projects.map(
      ({ project, roles, trackCount }) => ({ ...project, roles, trackCount }),
    );
    const line = (p: (typeof list)[number]) =>
      [p.artist ? `${p.name} – ${p.artist}` : p.name, p.roles.map((role) => ROLE_LABELS.de[role]).join(', '), texts.tracks(p.trackCount)].join(' · ');
    return { data: { projects: list }, text: list.length ? list.map(line).join('\n') : texts.noProjects };
  },
};
