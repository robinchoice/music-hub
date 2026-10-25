import { expect, test, type Page } from '@playwright/test';
import { logIn, removeUser } from './session.js';

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

test('projects stand under their artist with their track counts, the group folds', async ({ page, isMobile }) => {
  await seed(page);
  await page.goto('/dashboard');
  await openSidebar(page, isMobile);
  const group = sidebar(page).locator('.artist-group').filter({ hasText: 'Tiefgang' });
  await expect(group.locator('.artist-head .count')).toHaveText('2');
  await expect(group.locator('.project .name')).toHaveText(['Nachtbus EP', 'Single']);
  await expect(group.locator('.project .count')).toHaveText(['2', '0']);
  const loose = sidebar(page).locator('.artist-group').filter({ hasText: 'Ohne Zuordnung' });
  await expect(loose.locator('.project .name')).toHaveText(['Jam Session']);
  await expect(loose.locator('.project .count')).toHaveText(['1']);

  await group.getByRole('button', { name: 'Zuklappen' }).click();
  await expect(group.locator('.project')).toHaveCount(0);
  await group.getByRole('button', { name: 'Aufklappen' }).click();
  await expect(group.locator('.project')).toHaveCount(2);
});

test('the open project lists its tracks in order, the others keep theirs folded', async ({ page, isMobile }) => {
  const { nachtbus } = await seed(page);
  await page.goto(`/projects/${nachtbus.id}`);
  await openSidebar(page, isMobile);
  const project = sidebar(page).locator('.projects > li').filter({ has: page.locator('.project.active') });
  await expect(project.locator('.track')).toHaveText(['Letzte Bahn', 'Intro']);
  await expect(sidebar(page).locator('.track')).toHaveCount(2);
  await expect(sidebar(page).getByText('Freitag')).toHaveCount(0);

  await project.locator('.track', { hasText: 'Intro' }).click();
  await expect(page).toHaveURL(/\/tracks\/[0-9a-f-]{36}$/);
  if (isMobile) await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await expect(sidebar(page).locator('.track.active')).toHaveText('Intro');
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
  await expect(sidebar(page).locator('.project')).toHaveCount(3);
});

test('a new project picks an existing artist from the list and keeps its spelling', async ({ page, isMobile }) => {
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
  await openSidebar(page, isMobile);
  const group = sidebar(page).locator('.artist-group').filter({ hasText: 'Tiefgang' });
  await expect(group.locator('.project .name')).toHaveText(['Nachtbus EP', 'Single', 'Zweite EP']);
  await expect(sidebar(page).locator('.artist-head')).toHaveCount(3);
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
