import { expect, test } from '@playwright/test';
import { planImport, type ImportPlan } from '@music-hub/shared';
import { logIn, removeUser } from './session.js';

// The import page against a mocked Dropbox API: pick a folder, check the preview, rename, sort, start, follow the progress.
let userId = '';
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

const MB = 1_000_000;
const entries = [
  { path: 'Album/Kreise/Kreise.als', size: 200_000 },
  { path: 'Album/Kreise/Bounces/Kreise v1.wav', size: 40 * MB },
  { path: 'Album/Kreise/Bounces/Kreise v2.wav', size: 40 * MB },
  { path: 'Album/Kreise/Stems/Kick.wav', size: 40 * MB },
  { path: 'Album/Kreise/Stems/Bass.wav', size: 40 * MB },
  { path: 'Album/Mixes/Letzte Bahn Mix 1.wav', size: 30 * MB },
  { path: 'Album/Mixes/Letzte Bahn Mix 2.wav', size: 30 * MB },
  { path: 'Album/Cover.jpg', size: 2 * MB },
].map((e, i) => ({ ...e, modified: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));

test('a Dropbox folder becomes a preview with songs, versions and stems, and the import follows the edited plan', async ({ page }) => {
  let started: ImportPlan | null = null;
  await page.route('**/api/v1/dropbox', (route) => route.fulfill({ json: { configured: true, connected: true, displayName: 'Studio Nord' } }));
  await page.route('**/api/v1/dropbox/folders?*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path');
    return route.fulfill({ json: { folders: path === '' ? [{ name: 'Studio', path: '/Studio' }] : [] } });
  });
  await page.route('**/api/v1/imports/dropbox', (route) =>
    route.fulfill({ json: { id: '00000000-0000-4000-8000-000000000001', rootName: 'Studio', entries, plan: planImport(entries, 'Studio'), duplicates: [], storage: { used: 0, limit: 5e9 } } }));
  await page.route('**/api/v1/imports/*/start', (route) => {
    started = route.request().postDataJSON() as ImportPlan;
    return route.fulfill({ json: { ok: true, items: 7, duplicates: 0 } });
  });
  await page.route('**/api/v1/imports/00000000-0000-4000-8000-000000000001', (route) => route.fulfill({
    json: {
      id: '00000000-0000-4000-8000-000000000001', status: 'done', rootName: 'Studio',
      items: [{ id: 'a', kind: 'version', name: 'Kreise v1', status: 'done', error: null, fileSize: 1, projectId: '00000000-0000-4000-8000-0000000000aa', trackId: null, projectName: 'Album 2026', trackName: 'Kreise' }],
    },
  }));

  await page.goto('/import');
  await expect(page.getByText('Verbunden als Studio Nord')).toBeVisible();
  await page.getByRole('button', { name: 'Studio' }).click();
  await page.getByRole('button', { name: 'Diesen Ordner analysieren' }).click();

  await expect(page.getByText('1 Projekt · 2 Songs · 4 Versionen · 2 Spuren')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name des Projekts' })).toHaveValue('Album');
  await expect(page.getByRole('textbox', { name: 'Name des Songs' }).first()).toHaveValue('Kreise');
  await expect(page.getByRole('textbox', { name: 'Name des Songs' }).nth(1)).toHaveValue('Letzte Bahn');
  await expect(page.getByText('Nicht zugeordnet')).toBeVisible();

  await page.getByRole('textbox', { name: 'Name des Projekts' }).fill('Album 2026');
  // V2 of Kreise moves before V1
  const v2 = page.locator('li.item', { hasText: 'Kreise v2.wav' });
  await v2.getByRole('button', { name: 'Früher' }).click();
  await expect(v2.locator('.kind-tag')).toHaveText('V1');
  // A stem is left out
  await page.locator('li.item', { hasText: 'Bass.wav' }).getByRole('combobox', { name: 'Was wird daraus?' }).selectOption('skip');
  await expect(page.getByText('1 Projekt · 2 Songs · 4 Versionen · 1 Spur')).toBeVisible();

  await page.getByRole('button', { name: 'Importieren', exact: true }).click();
  await expect(page.getByText('Import fertig')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Album 2026 öffnen' })).toBeVisible();

  const plan = started as ImportPlan | null;
  expect(plan?.projects).toEqual([{ name: 'Album 2026' }]);
  const kreise = plan!.items.filter((item) => item.kind === 'version' && item.track === 0).map((item) => entries[item.entry].path.split('/').at(-1));
  expect(kreise).toEqual(['Kreise v2.wav', 'Kreise v1.wav']);
  expect(plan!.items.find((item) => entries[item.entry].path.endsWith('Bass.wav'))?.kind).toBe('skip');
});

test('without a connection the page explains the import and offers to connect', async ({ page }) => {
  await page.route('**/api/v1/dropbox', (route) => route.fulfill({ json: { configured: true, connected: false, displayName: null } }));
  await page.goto('/import');
  await expect(page.getByRole('heading', { name: 'Aus Dropbox importieren' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dropbox verbinden' })).toBeVisible();
  await expect(page.getByText('Nur lesend.')).toBeVisible();
});
