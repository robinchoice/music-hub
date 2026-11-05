import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { planImport } from '@music-hub/shared';
import { dropboxConnections, imports } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { authorizeUrl, connect, dropboxConfigured, DropboxError, listFolder, pkcePair, revoke, session } from '../lib/dropbox.js';
import { cancelImport, earlierImports, importStatus, scanFolder, startImport, startSchema } from '../lib/imports.js';
import { storageFull, storageOf, uploadVolumeExceeded } from '../lib/storage.js';
import { rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { t } from '../lib/i18n.js';
import type { AppEnv } from '../types.js';

const PKCE_COOKIE = 'dropbox_pkce';
// Each scan lists a whole folder tree at Dropbox
const scans = rateLimit('dropbox-scans', 30, 60 * 60 * 1000);

const idParam = zValidator('param', z.object({ id: z.uuid() }));
const pathSchema = z.string().max(1000).refine((p) => p === '' || (p.startsWith('/') && !p.endsWith('/')));

function dropboxProblem(c: Context<AppEnv>, err: unknown) {
  if (err instanceof DropboxError) {
    console.error('[Dropbox]', err.message);
    if (err.unauthorized) return c.json({ error: t(c).errors.dropboxReconnect, code: 'dropbox_reconnect' }, 409);
    return c.json({ error: t(c).errors.dropboxFailed }, 502);
  }
  throw err;
}

async function sessionOf(c: Context<AppEnv>) {
  if (!dropboxConfigured()) return { error: c.json({ error: t(c).errors.dropboxUnconfigured, code: 'dropbox_unconfigured' }, 503) } as const;
  try {
    const s = await session(c.get('db'), c.get('userId'));
    if (!s) return { error: c.json({ error: t(c).errors.dropboxNotConnected, code: 'dropbox_not_connected' }, 409) } as const;
    return { session: s } as const;
  } catch (err) {
    return { error: dropboxProblem(c, err) } as const;
  }
}

export const dropboxRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const [row] = await c.get('db').select({ displayName: dropboxConnections.displayName }).from(dropboxConnections)
      .where(eq(dropboxConnections.userId, c.get('userId'))).limit(1);
    return c.json({ configured: dropboxConfigured(), connected: Boolean(row), displayName: row?.displayName ?? null });
  })

  // Off to Dropbox; the verifier waits in a cookie only this route and the callback see
  .get('/connect', (c) => {
    if (!dropboxConfigured()) return c.redirect('/import?dropbox=unconfigured');
    const state = crypto.randomUUID();
    const { verifier, challenge } = pkcePair();
    setCookie(c, PKCE_COOKIE, `${state}.${verifier}`, {
      httpOnly: true,
      secure: (process.env.APP_URL ?? '').startsWith('https://'),
      sameSite: 'Lax',
      path: '/api/v1/dropbox',
      maxAge: 600,
    });
    return c.redirect(authorizeUrl(state, challenge));
  })

  .get('/callback', async (c) => {
    const [state, verifier] = (getCookie(c, PKCE_COOKIE) ?? '').split('.');
    deleteCookie(c, PKCE_COOKIE, { path: '/api/v1/dropbox' });
    const code = c.req.query('code');
    if (!state || !verifier || !code || c.req.query('state') !== state) return c.redirect('/import?dropbox=failed');
    try {
      await connect(c.get('db'), c.get('userId'), code, verifier);
    } catch (err) {
      console.error('[Dropbox] Connecting failed:', err instanceof DropboxError ? err.message : err);
      return c.redirect('/import?dropbox=failed');
    }
    return c.redirect('/import');
  })

  .delete('/', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const s = dropboxConfigured() ? await session(db, userId).catch(() => null) : null;
    if (s) await revoke(s);
    await db.delete(dropboxConnections).where(eq(dropboxConnections.userId, userId));
    return c.json({ ok: true });
  })

  // The folders in one folder, for picking what to import
  .get('/folders', zValidator('query', z.object({ path: pathSchema.default('') })), async (c) => {
    const found = await sessionOf(c);
    if ('error' in found) return found.error;
    try {
      const entries = await listFolder(found.session, c.req.valid('query').path, false, 100_000);
      const folders = (entries ?? [])
        .filter((e) => e['.tag'] === 'folder' && e.path_display)
        .map((e) => ({ name: e.name, path: e.path_display! }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return c.json({ folders });
    } catch (err) {
      return dropboxProblem(c, err);
    }
  });

export const importRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const rows = await c.get('db').select({ id: imports.id, status: imports.status, rootPath: imports.rootPath, createdAt: imports.createdAt, finishedAt: imports.finishedAt })
      .from(imports).where(eq(imports.userId, c.get('userId'))).orderBy(desc(imports.createdAt)).limit(20);
    return c.json({ imports: rows.filter((row) => row.status !== 'scanned') });
  })

  // Looks at a Dropbox folder and proposes projects, songs, versions and stems
  .post('/dropbox', zValidator('json', z.object({ path: pathSchema })), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    if (!(await scans.hit(db, userId))) return tooManyRequests(c);
    const found = await sessionOf(c);
    if ('error' in found) return found.error;
    try {
      const scan = await scanFolder(db, userId, found.session, c.req.valid('json').path);
      if (!scan) return c.json({ error: t(c).errors.tooManyFiles, code: 'too_many_files' }, 413);
      const earlier = await earlierImports(db, userId, scan.entries);
      return c.json({
        id: scan.id,
        rootName: scan.rootName,
        entries: scan.entries.map(({ path, size, modified }) => ({ path, size, modified })),
        plan: planImport(scan.entries, scan.rootName),
        duplicates: scan.entries.flatMap((e, i) => (e.hash && earlier.has(e.hash) ? [i] : [])),
        storage: await storageOf(db, userId),
      });
    } catch (err) {
      return dropboxProblem(c, err);
    }
  })

  .post('/:id/start', idParam, zValidator('json', startSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const result = await startImport(db, userId, c.req.valid('param').id, c.req.valid('json'));
    if (result.ok) return c.json(result);
    if (result.error === 'not_found') return c.json({ error: 'Not found' }, 404);
    if (result.error === 'storage_full') return storageFull(c, await storageOf(db, userId));
    if (result.error === 'upload_volume') return uploadVolumeExceeded(c);
    return c.json({ error: t(c).errors.importPlanInvalid }, 400);
  })

  .get('/:id', idParam, async (c) => {
    const status = await importStatus(c.get('db'), c.get('userId'), c.req.valid('param').id);
    if (!status) return c.json({ error: 'Not found' }, 404);
    return c.json(status);
  })

  .post('/:id/cancel', idParam, async (c) => {
    if (!(await cancelImport(c.get('db'), c.get('userId'), c.req.valid('param').id))) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });
