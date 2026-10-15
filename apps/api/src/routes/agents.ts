import { Hono, type Context } from 'hono';
import { type Locale, type PublicPage, publicPages, SITE } from '../lib/public-pages.js';
import type { AppEnv } from '../types.js';

// Public content for other people's agents, after llms.txt (https://llmstxt.org):
// /llms.txt lists the pages, /llms-full.txt holds all of them, every page is
// <path>.md as well. The web server forwards these paths here and answers
// Accept: text/markdown with the .md (hooks.server.ts). ?lang= picks the
// language, since agents rarely send Accept-Language.

const markdownPath = (path: string) => (path === '/' ? '/index.md' : `${path}.md`);

function language(c: Context<AppEnv>) {
  const lang = c.req.query('lang');
  const locale: Locale = (lang ?? c.req.header('accept-language') ?? '').toLowerCase().startsWith('en') ? 'en' : 'de';
  // Links keep an explicit ?lang= so an agent stays in its language
  return { locale, query: lang ? `?lang=${locale}` : '' };
}

const markdown = (page: PublicPage) =>
  [`# ${page.title}`, `> ${page.description}`, page.body].filter(Boolean).join('\n\n');

function text(c: Context<AppEnv>, body: string, type: string) {
  c.header('content-type', `${type}; charset=utf-8`);
  c.header('vary', 'accept, accept-language');
  return c.body(`${body}\n`);
}

export const agentRoutes = new Hono<AppEnv>()
  .get('/llms.txt', (c) => {
    const { locale, query } = language(c);
    const url = process.env.APP_URL;
    const site = SITE[locale];
    return text(
      c,
      [
        '# Music Hub',
        `> ${site.tagline}`,
        `${site.intro(`${url}/llms-full.txt${query}`)}\n\n${site.otherLanguage}: ${url}/llms.txt?lang=${locale === 'de' ? 'en' : 'de'}`,
        `## ${site.pages}`,
        publicPages(locale)
          .map((page) => `- [${page.title}](${url}${markdownPath(page.path)}${query}): ${page.description}`)
          .join('\n'),
      ].join('\n\n'),
      'text/plain',
    );
  })
  .get('/llms-full.txt', (c) => text(c, publicPages(language(c).locale).map(markdown).join('\n\n---\n\n'), 'text/plain'))
  .get('/:path{.+\\.md}', (c) => {
    const page = publicPages(language(c).locale).find((p) => markdownPath(p.path) === c.req.path);
    if (!page) return c.json({ error: 'Not found' }, 404);
    return text(c, markdown(page), 'text/markdown');
  });
