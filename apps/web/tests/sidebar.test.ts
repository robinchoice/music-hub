import { expect, test, type Page } from '@playwright/test';
import { logIn, makeViewer, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

const project = async (page: Page, name: string, artist: string | null) =>
  ((await (await page.request.post('/api/v1/projects', { data: { name, artist } })).json()).project as { id: string });

// Two projects of one artist, one without: "Nachtbus EP" carries two tracks
async function seed(page: Page) {
  const track = (projectId: string, name: string) => page.request.post(`/api/v1/tracks/${projectId}`, { data: { name } });
  const nachtbus = await project(page, 'Nachtbus EP', 'Tiefgang');
  const single = await project(page, 'Single', 'Tiefgang');
  const loose = await project(page, 'Jam Session', null);
  await track(nachtbus.id, 'Letzte Bahn');
  await track(nachtbus.id, 'Intro');
  await track(loose.id, 'Freitag');
  return { nachtbus, single, loose };
}

const sidebar = (page: Page) => page.locator('aside.sidebar');
async function openSidebar(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await expect(sidebar(page)).toBeVisible();
}

const folders = (page: Page) => page.locator('.folders .folder');

test('Meine Musik opens like a drive: artist, project, track', async ({ page, isMobile }) => {
  await seed(page);
  await page.goto('/music');
  await expect(folders(page).locator('.name b')).toHaveText(['Tiefgang', 'Jam Session']);
  await expect(folders(page).locator('.contents')).toHaveText(['2 Projekte', '1 Track']);

  await folders(page).filter({ hasText: 'Tiefgang' }).click();
  await expect(page).toHaveURL(/\/artists\/Tiefgang$/);
  await expect(folders(page).locator('.name b')).toHaveText(['Nachtbus EP', 'Single']);
  await expect(folders(page).locator('.contents')).toHaveText(['2 Tracks', '0 Tracks']);

  await folders(page).filter({ hasText: 'Nachtbus EP' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\?view=dateien$/);
  await expect(folders(page).locator('.name b')).toHaveText(['Letzte Bahn', 'Intro']);
  // Phones show only the last crumb
  if (!isMobile) {
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link')).toHaveText(['Meine Musik', 'Tiefgang']);
    await crumbs.getByRole('link', { name: 'Meine Musik' }).click();
    await expect(page).toHaveURL(/\/music$/);
  }
});

test('the sidebar holds places, not projects', async ({ page, isMobile }) => {
  const { nachtbus } = await seed(page);
  await page.goto(`/projects/${nachtbus.id}`);
  await openSidebar(page, isMobile);
  await expect(sidebar(page).getByRole('link', { name: 'Meine Musik' })).toHaveAttribute('aria-current', 'page');
  await expect(sidebar(page).getByText('Nachtbus EP')).toHaveCount(0);
});

test('shared with me lists the projects you do not own', async ({ page }) => {
  await page.goto('/shared');
  await expect(page.getByText('Noch nichts mit dir geteilt')).toBeVisible();
  const { nachtbus } = await seed(page);
  makeViewer(nachtbus.id, userId);
  await page.reload();
  await expect(folders(page).locator('.name b')).toHaveText(['Nachtbus EP']);
  await expect(folders(page).locator('.name small')).toContainText('Tiefgang');
});

test('the search narrows the projects by name, artist and track and says when nothing matches', async ({ page, isMobile }) => {
  await seed(page);
  await page.goto('/dashboard');
  await openSidebar(page, isMobile);
  const search = sidebar(page).getByLabel('Suchen');
  await search.fill('nacht');
  await expect(sidebar(page).locator('.project .name')).toHaveText(['Nachtbus EP']);
  await search.fill('tiefgang');
  await expect(sidebar(page).locator('.project .name')).toHaveText(['Nachtbus EP', 'Single']);
  // A track of a project that was never opened counts too
  await search.fill('freitag');
  await expect(sidebar(page).locator('.project .name')).toHaveText(['Jam Session']);
  await expect(sidebar(page).locator('.track')).toHaveText(['Freitag']);
  await search.fill('xyz');
  await expect(sidebar(page).locator('.project')).toHaveCount(0);
  await expect(sidebar(page).getByText('Nichts gefunden für „xyz“')).toBeVisible();
  await search.fill('');
  await expect(sidebar(page).locator('.project')).toHaveCount(0);
  await expect(sidebar(page).getByRole('link', { name: 'Meine Musik' })).toBeVisible();
});

test('"Neu" picks files and asks only for the project', async ({ page, isMobile }) => {
  await seed(page);
  await page.goto('/music');
  await openSidebar(page, isMobile);
  await sidebar(page).getByRole('button', { name: 'Neu' }).click();
  await expect(sidebar(page).getByRole('menuitem', { name: 'Neues Projekt' })).toHaveAttribute('href', '/projects/new');
  const chooser = page.waitForEvent('filechooser');
  await sidebar(page).getByRole('menuitem', { name: 'Dateien hochladen' }).click();
  await (await chooser).setFiles({ name: 'Text.txt', mimeType: 'text/plain', buffer: Buffer.from('la la') });
  await expect(page.getByRole('dialog', { name: 'Datei hochladen' })).toBeVisible();
});

test('a new project picks an existing artist from the list and keeps its spelling', async ({ page }) => {
  await seed(page);
  await project(page, 'Demo', 'Anna Berger');
  await page.goto('/projects/new');
  const field = page.getByLabel('Artist (optional)');
  const options = page.getByRole('listbox', { name: 'Bestehende Artists' }).getByRole('option');
  await expect(options).toHaveCount(0);
  await field.click();
  await expect(options).toHaveText(['Anna Berger', 'Tiefgang']);
  await field.fill('tief');
  await expect(options).toHaveText(['Tiefgang']);
  await options.first().click();
  await expect(field).toHaveValue('Tiefgang');
  await expect(options).toHaveCount(0);

  // Typed in other case it is still the same artist, not a second group
  await field.fill('tiefgang ');
  await expect(page.getByText('Neuer Artist')).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Tiefgang' })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Name').fill('Zweite EP');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.goto('/artists/Tiefgang');
  await expect(folders(page).locator('.name b')).toHaveText(['Nachtbus EP', 'Single', 'Zweite EP']);
  await page.goto('/music');
  await expect(folders(page).locator('.name b')).toHaveText(['Anna Berger', 'Tiefgang', 'Jam Session']);
});

test('the artist list follows the keyboard, a new name says so', async ({ page }) => {
  await seed(page);
  await project(page, 'Demo', 'Anna Berger');
  await page.goto('/projects/new');
  const field = page.getByLabel('Artist (optional)');
  await field.focus();
  await field.press('ArrowDown');
  await field.press('ArrowDown');
  await field.press('Enter');
  await expect(field).toHaveValue('Tiefgang');
  await expect(page).toHaveURL(/\/projects\/new$/);
  await field.fill('Neue Band');
  await expect(page.getByText('Neuer Artist')).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(0);
});
