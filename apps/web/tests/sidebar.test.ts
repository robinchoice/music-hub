import { expect, test, type Page } from '@playwright/test';
import { logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

// Two projects of one artist, one without: "Nachtbus EP" carries two tracks
async function seed(page: Page) {
  const project = async (name: string, artist: string | null) =>
    ((await (await page.request.post('/api/v1/projects', { data: { name, artist } })).json()).project as { id: string });
  const track = (projectId: string, name: string) => page.request.post(`/api/v1/tracks/${projectId}`, { data: { name } });
  const nachtbus = await project('Nachtbus EP', 'Tiefgang');
  const single = await project('Single', 'Tiefgang');
  const loose = await project('Jam Session', null);
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
