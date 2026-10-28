import { expect, test, type Page } from '@playwright/test';
import { addVersion, logIn, makeViewer, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

async function project(page: Page, name: string, tracks: [string, string][]) {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name } })).json();
  for (const [trackName, status] of tracks) {
    const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: trackName } })).json();
    if (status !== 'sketch') await page.request.patch(`/api/v1/tracks/${track.id}`, { data: { status } });
    addVersion(track.id, userId, 'ready');
  }
  return project.id as string;
}

const column = (page: Page, stage: string) => page.locator(`.col[data-stage="${stage}"]`);
const card = (page: Page, name: string) => page.locator('.card', { hasText: name });
const saved = (page: Page) => page.waitForResponse((r) => r.url().includes('/api/v1/tracks/') && r.request().method() === 'PATCH');

test('the board shows every project by stage and moves tracks by picker, button or dragging', async ({ page, isMobile }, info) => {
  await project(page, 'Nachtbus EP', [['Letzte Bahn', 'sketch'], ['Heute Kind sein', 'in_progress']]);
  const fernlicht = await project(page, 'Fernlicht', [['Morgenrot', 'recording']]);
  await page.goto('/board');

  // "In Arbeit" only while a track has it
  await expect(page.locator('.col h2')).toHaveText([/^Demo1/, /^In Arbeit1/, /^Recording1/, /^Mix0/, /^Master0/, /^Final0/, /^Veröffentlicht0/]);
  await expect(card(page, 'Letzte Bahn')).toContainText('Nachtbus EP');
  await expect(card(page, 'Letzte Bahn')).toContainText('V1');
  await page.screenshot({ path: info.outputPath('board.png'), fullPage: true });

  // Any stage from the picker, with undo
  let done = saved(page);
  await card(page, 'Letzte Bahn').getByLabel('Phase von „Letzte Bahn“ ändern').selectOption('mixing');
  await done;
  await expect(column(page, 'mixing')).toContainText('Letzte Bahn');
  done = saved(page);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await done;
  await expect(column(page, 'sketch')).toContainText('Letzte Bahn');

  // The picker offers the stages only, the old status disappears with its last track
  await expect(card(page, 'Heute Kind sein').locator('select option:not([disabled])')).toHaveText(['Demo', 'Recording', 'Mix', 'Master', 'Final', 'Veröffentlicht']);
  await card(page, 'Heute Kind sein').locator('select').selectOption('recording');
  await expect(column(page, 'in_progress')).toHaveCount(0);

  // One step on: the button on phones, dragging with a mouse
  done = saved(page);
  if (isMobile) await card(page, 'Morgenrot').getByRole('button', { name: 'Weiter: Mix' }).click();
  else {
    await expect(card(page, 'Morgenrot').getByRole('button', { name: 'Weiter: Mix' })).toBeHidden();
    await card(page, 'Morgenrot').dragTo(column(page, 'mixing'));
  }
  await done;
  await page.reload();
  await expect(column(page, 'mixing')).toContainText('Morgenrot');

  // The filter sits in the URL; one project needs no project names on the cards
  await page.getByRole('button', { name: 'Fernlicht', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/board\\?p=${fernlicht}$`));
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(card(page, 'Morgenrot')).not.toContainText('Fernlicht');
  await page.getByRole('button', { name: 'Du bist dran' }).click();
  await expect(page).toHaveURL(new RegExp(`p=${fernlicht}&dran=1$`));
});

test('the project page has the board as a tab', async ({ page }) => {
  const id = await project(page, 'Nachtbus EP', [['Letzte Bahn', 'final']]);
  await page.goto(`/projects/${id}`);
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${id}\\?view=board$`));
  await expect(column(page, 'final')).toContainText('Letzte Bahn');
  await expect(card(page, 'Letzte Bahn')).not.toContainText('Nachtbus EP');
});

test('listening only: the board shows a lock instead of the picker', async ({ page }) => {
  const id = await project(page, 'Nachtbus EP', [['Letzte Bahn', 'mixing']]);
  makeViewer(id, userId);
  await page.goto('/board');
  await expect(card(page, 'Letzte Bahn').locator('select')).toHaveCount(0);
  await expect(card(page, 'Letzte Bahn').locator('.lock')).toBeVisible();
  await expect(card(page, 'Letzte Bahn')).toHaveAttribute('draggable', 'false');
});
