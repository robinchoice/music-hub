import { extname } from 'node:path';
import { z } from 'zod';
import { type Command, EXIT, Failure, str } from '../command';
import { SLUG } from '../config';
import { texts } from '../texts';
import { bucket, mb } from './versions';

const brandSchema = z.object({
  brand: z.object({
    name: z.string().nullable(),
    line: z.string().nullable(),
    logoKey: z.string().nullable(),
    logoUrl: z.string().nullable(),
    shown: z.boolean(),
    allowed: z.boolean(),
  }),
});
const coverSchema = z.object({ uploadUrl: z.string(), key: z.string() });
const LOGO_TYPES: Record<string, 'image/png' | 'image/jpeg' | 'image/webp'> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const LOGO_MAX = 2 * 1024 * 1024;

// How the studio appears on the client page of its orders, as under "Account" › "Your studio on the client page"
export const studio: Command = {
  help: [
    ['studio', texts.studioHelp],
    ['studio set [--name <text>] [--line <text>] [--logo <file> | --clear-logo]', texts.studioSetHelp],
  ],
  positionals: true,
  options: { name: { type: 'string' }, line: { type: 'string' }, logo: { type: 'string' }, 'clear-logo': { type: 'boolean' } },
  async run({ api, session, values, positionals }) {
    if (!session) throw new Failure(texts.notLoggedIn(SLUG), EXIT.loggedOut);
    const [sub, ...more] = positionals;
    if (more.length || (sub !== undefined && sub !== 'set')) throw new Failure(texts.studioUsage(SLUG), EXIT.usage);

    let view: z.infer<typeof brandSchema>['brand'];
    if (sub === 'set') {
      const body: { name?: string | null; line?: string | null; logoKey?: string | null } = {};
      const name = str(values.name);
      const line = str(values.line);
      const logo = str(values.logo);
      if (name !== undefined) body.name = name.trim() || null;
      if (line !== undefined) body.line = line.trim() || null;
      if (logo !== undefined && values['clear-logo']) throw new Failure(texts.studioUsage(SLUG), EXIT.usage);
      if (values['clear-logo']) body.logoKey = null;
      if (logo !== undefined) {
        const source = Bun.file(logo);
        if (!(await source.exists())) throw new Failure(texts.noSuchFile(logo), EXIT.error);
        const mimeType = LOGO_TYPES[extname(logo).toLowerCase()];
        if (!mimeType) throw new Failure(texts.studioLogoType(logo), EXIT.error);
        if (source.size > LOGO_MAX) throw new Failure(texts.fileTooBig(logo, mb(LOGO_MAX)), EXIT.error);
        const { uploadUrl, key } = await api.post('/uploads/cover', coverSchema, { fileName: 'logo', mimeType, fileSize: source.size });
        await bucket(uploadUrl, { method: 'PUT', headers: { 'content-type': mimeType }, body: source });
        body.logoKey = key;
      }
      if (!Object.keys(body).length) throw new Failure(texts.badOptions(texts.studioNothingToSet, SLUG), EXIT.usage);
      view = (await api.put('/studio-brand', brandSchema, body)).brand;
    } else {
      view = (await api.get('/studio-brand', brandSchema)).brand;
    }

    const { logoKey: _key, ...data } = view;
    const set = view.name || view.line || view.logoKey;
    const text = set
      ? [[view.name, view.line].filter(Boolean).join(' · ') || null, texts.studioLogo(!!view.logoKey), texts.studioShown(view.shown, view.allowed)]
          .filter(Boolean)
          .join('\n')
      : texts.studioNotSet;
    return { data, text };
  },
};
