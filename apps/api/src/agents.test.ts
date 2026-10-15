import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { agentRoutes } from './routes/agents.js';
import { publicPages, SITE } from './lib/public-pages.js';

process.env.APP_URL = 'https://app.test';
const app = new Hono().route('/', agentRoutes);
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers });

test('llms.txt lists every public page as Markdown', async () => {
  const res = await get('/llms.txt');
  expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  const text = await res.text();
  expect(text).toStartWith(`# Music Hub\n\n> ${SITE.de.tagline}`);
  expect(text).toContain('https://app.test/llms-full.txt');
  expect(text).toContain('https://app.test/llms.txt?lang=en');
  expect(text).toContain(`- [Music Hub](https://app.test/index.md): ${SITE.de.tagline}`);
  expect(text).toContain('https://app.test/datenschutz.md');
});

test('the language follows ?lang= before Accept-Language, and links keep it', async () => {
  const text = await (await get('/llms.txt?lang=en', { 'accept-language': 'de' })).text();
  expect(text).toContain(SITE.en.tagline);
  expect(text).toContain('https://app.test/index.md?lang=en');
  expect(await (await get('/index.md', { 'accept-language': 'en-US,en' })).text()).toContain(SITE.en.tagline);
});

test('every page is Markdown at <path>.md, and llms-full.txt holds all of them', async () => {
  const full = await (await get('/llms-full.txt')).text();
  for (const page of publicPages('de')) {
    const res = await get(page.path === '/' ? '/index.md' : `${page.path}.md`);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    const markdown = await res.text();
    expect(markdown).toStartWith(`# ${page.title}\n\n> ${page.description}`);
    expect(full).toContain(markdown.trim());
  }
});

test('pages that are not public have no Markdown', async () => {
  expect((await get('/dashboard.md')).status).toBe(404);
  expect((await get('/offen.md')).status).toBe(404);
  expect((await get('/api/v1/auth/me.md')).status).toBe(404);
});
