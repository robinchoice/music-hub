import { expect, test } from '@playwright/test';
import { addVersion, logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => { userId = await logIn(context, baseURL!); });
test.afterEach(() => removeUser(userId));

test('track menus rename, set sections, move and follow old addresses', async ({ page }) => {
  const { project: from } = await (await page.request.post('/api/v1/projects', { data: { name: 'Demos' } })).json();
  const { project: to } = await (await page.request.post('/api/v1/projects', { data: { name: 'Fernlicht' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${from.id}`, { data: { name: 'Idee 3' } })).json();
  await page.goto(`/projects/${from.id}`);
  await page.getByRole('button', { name: 'Aktionen für Idee 3', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Umbenennen', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Umbenennen', exact: true });
  await rename.getByRole('textbox').fill('Kreisel');
  await rename.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Aktionen für Kreisel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Abschnitt', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Neuer Abschnitt …', exact: true }).click();
  const section = page.getByRole('dialog', { name: 'Neuer Abschnitt', exact: true });
  await section.getByRole('textbox').fill('Nachtbus EP');
  await section.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await page.getByRole('button', { name: 'Aktionen für Kreisel', exact: true }).click();
  await page.getByRole('menuitem', { name: 'In anderes Projekt verschieben …', exact: true }).click();
  const move = page.getByRole('dialog', { name: '„Kreisel“ verschieben', exact: true });
  await move.getByRole('radio', { name: 'Fernlicht', exact: true }).click();
  await move.getByRole('button', { name: 'Verschieben', exact: true }).click();
  await expect(move).toBeHidden();
  await expect(page.getByRole('button', { name: 'Aktionen für Kreisel', exact: true })).toHaveCount(0);
  await page.goto(`/projects/${from.id}/tracks/${track.id}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${to.id}/tracks/${track.id}`));
  await expect(page.getByRole('heading', { name: 'Kreisel', exact: true })).toBeVisible();
});

test('selection merges tracks after a preview and the old track opens the target', async ({ page }, testInfo) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Fernlicht' } })).json();
  const { track: a } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Kreisel' } })).json();
  const { track: b } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Kreisel Demo' } })).json();
  addVersion(a.id, userId, 'ready');
  addVersion(b.id, userId, 'ready');
  await page.goto(`/projects/${project.id}`);
  if (testInfo.project.name === 'handy') {
    const row = page.getByRole('group', { name: 'Kreisel', exact: true });
    const box = await row.boundingBox();
    await page.dispatchEvent('[aria-label="Kreisel"][role="group"]', 'pointerdown', { pointerType: 'touch', clientX: box!.x + 40, clientY: box!.y + 20 });
    await page.waitForTimeout(500);
    await page.dispatchEvent('[aria-label="Kreisel"][role="group"]', 'pointerup', { pointerType: 'touch' });
    await page.getByRole('checkbox', { name: 'Kreisel Demo auswählen', exact: true }).check();
  } else {
    await page.getByRole('checkbox', { name: 'Kreisel auswählen', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Kreisel Demo auswählen', exact: true }).check();
  }
  await page.getByRole('region', { name: '2 ausgewählt' }).getByRole('button', { name: 'Zusammenführen', exact: true }).click();
  const merge = page.getByRole('dialog', { name: '2 Tracks zusammenführen', exact: true });
  await expect(merge.getByText('Zusammenführen lässt sich nicht als Ganzes rückgängig machen.', { exact: false })).toBeVisible();
  await expect(merge.getByText('V2', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('merge-preview.png'), fullPage: true });
  await merge.getByRole('button', { name: 'Zusammenführen', exact: true }).click();
  await expect(merge).toBeHidden();
  const res = await page.request.get(`/api/v1/versions/track/${a.id}`);
  expect((await res.json()).versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
  await page.goto(`/projects/${project.id}/tracks/${b.id}`);
  await expect(page).toHaveURL(new RegExp(`/tracks/${a.id}`));
});

test('folder menus reach track actions and dragging changes a section', async ({ page }, testInfo) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Fernlicht' } })).json();
  const { track: a } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Kreisel' } })).json();
  const { track: b } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Nachtbus' } })).json();
  await page.request.patch(`/api/v1/tracks/${a.id}`, { data: { section: 'Demos' } });
  await page.request.patch(`/api/v1/tracks/${b.id}`, { data: { section: 'EP' } });
  await page.goto(`/projects/${project.id}?view=dateien`);
  await page.getByRole('button', { name: 'Aktionen für Kreisel', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Mit anderem Track zusammenführen …', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  if (testInfo.project.name === 'desktop') {
    await page.goto(`/projects/${project.id}`);
    await page.getByRole('group', { name: 'Kreisel', exact: true }).dragTo(page.getByRole('heading', { name: 'EP 1', exact: true }));
    await expect.poll(async () => (await (await page.request.get(`/api/v1/tracks/${a.id}`)).json()).track.section).toBe('EP');
  }
});
