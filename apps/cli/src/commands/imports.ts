import { z } from 'zod';
import { type Command, EXIT, Failure } from '../command';
import { SLUG } from '../config';
import { texts } from '../texts';

const importsSchema = z.object({
  imports: z.array(z.object({ id: z.string(), status: z.string(), rootPath: z.string(), createdAt: z.string(), finishedAt: z.string().nullable() })),
});

// The latest imports from Dropbox. Starting one needs the browser: connecting Dropbox and checking the preview happen there.
export const imports: Command = {
  help: [['imports', texts.importsHelp]],
  options: {},
  async run({ api, session }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const list = (await api.get('/imports', importsSchema)).imports;
    const line = (i: (typeof list)[number]) => [i.createdAt.slice(0, 16).replace('T', ' '), i.rootPath || '/', i.status].join(' · ');
    return { data: { imports: list }, text: list.length ? list.map(line).join('\n') : texts.noImports };
  },
};
