import { z } from 'zod';
import { type Command, EXIT, Failure, str } from '../command';
import { SLUG } from '../config';
import { texts } from '../texts';

const projectsSchema = z.object({
  projects: z.array(z.object({ project: z.object({ id: z.string(), name: z.string() }) })),
});

const linkSchema = z.object({
  link: z.object({
    id: z.string(),
    token: z.string(),
    follows: z.enum(['latest', 'approved']),
    allowComments: z.boolean(),
    allowDownload: z.boolean(),
    hasPassword: z.boolean(),
    expiresAt: z.string().nullable(),
    trackIds: z.array(z.string()).nullable(),
  }),
});

// The link to listen to a whole project without an account, as the share dialog of the web makes it
export const share: Command = {
  help: [['share --project <Name oder ID>', texts.shareHelp]],
  options: { project: { type: 'string' } },
  async run({ api, url, session, values }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const wanted = str(values.project)?.trim();
    if (!wanted) throw new Failure(texts.badOptions('--project fehlt', SLUG), EXIT.usage);
    const list = (await api.get('/projects', projectsSchema)).projects.map((p) => p.project);
    const project = list.find((p) => p.id === wanted) ?? list.find((p) => p.name.toLowerCase() === wanted.toLowerCase());
    if (!project) throw new Failure(texts.noSuchProject(wanted, SLUG), EXIT.error);

    const { link } = await api.post(`/share/project/${project.id}`, linkSchema);
    const shareUrl = `${url}/album/${link.token}`;
    return { data: { project, url: shareUrl, link }, text: shareUrl };
  },
};
