import { expect, test, type Page } from '@playwright/test';
import { addUnprocessedVersion, addVersion, logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

async function newTrack(page: Page) {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json();
  return { projectId: project.id as string, trackId: track.id as string };
}

test('the project header fits the screen and "Mix hochladen" opens the file dialog', async ({ page }) => {
  const { projectId } = await newTrack(page);
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole('heading', { name: 'Nachtbus EP' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // Icon-only on phones, the buttons keep their names
  for (const name of ['Einstellungen', 'Upload-Link', 'Neuer Track']) {
    const action = page.getByRole('button', { name }).or(page.getByRole('link', { name }));
    await expect(action).toBeVisible();
    await expect(action).toHaveAttribute('title', name);
  }
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
  await page.getByRole('button', { name: 'Mix hochladen' }).click();
  await chooser;
});

for (const state of ['processing', 'unreadable'] as const) {
  test(`a ${state} version can't be approved and asks for no waveform, so the console stays clean`, async ({ page, baseURL }) => {
    const { projectId, trackId } = await newTrack(page);
    // The CI bucket holds no files, so the player gets a short silence
    await page.route('**/stream-url', (route) => route.fulfill({ json: { url: `${baseURL}/fake-s3/mix.wav` } }));
    await page.route('**/fake-s3/**', (route) => route.fulfill({ body: Buffer.alloc(0), contentType: 'audio/wav' }));
    if (state === 'processing') addVersion(trackId, userId, 'processing');
    else addUnprocessedVersion(trackId, userId);
    const asked: string[] = [];
    page.on('request', (r) => r.url().includes('/waveform-data') && asked.push(r.url()));
    await page.goto(`/projects/${projectId}/tracks/${trackId}`);
    await expect(page.locator('.version-card').getByText(state === 'processing' ? 'Wird verarbeitet' : 'Nicht verarbeitet')).toBeVisible();
    // Nothing to judge yet
    await expect(page.getByRole('button', { name: /Freigeben/ })).toHaveCount(0);
    // The project page and the overview draw small waveforms of the latest version
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByRole('heading', { name: 'Nachtbus EP' })).toBeVisible();
    await page.goto('/dashboard');
    // The event stream keeps the network busy, so give late requests a moment instead of waiting for idle
    await page.waitForTimeout(1500);
    expect(asked).toEqual([]);
  });
}

test('picked files upload in the order people number them', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  // Only the order matters here, so the uploads stop before they create anything
  await page.route(`**/api/v1/tracks/${project.id}`, (route) => route.abort());
  await page.goto(`/projects/${project.id}`);
  const wav = (name: string) => ({ name, mimeType: 'audio/wav', buffer: Buffer.from('RIFF0000WAVE') });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dateien auswählen' }).click();
  await (await chooser).setFiles([wav('Bridge 10.wav'), wav('Bridge 3 lauter.wav'), wav('Bridge 3.wav')]);
  await expect(page.locator('.rows li')).toHaveCount(3);
  await expect(page.locator('.rows li')).toContainText(['Bridge 3.wav', 'Bridge 3 lauter.wav', 'Bridge 10.wav']);
  await expect(page.locator('.rows [role="alert"]')).toHaveCount(3);
});

test('upload validation errors are announced for projects, versions and stems', async ({ page }) => {
  const { projectId, trackId } = await newTrack(page);
  const invalid = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') };
  await page.goto(`/projects/${projectId}`);
  await page.locator('input[type="file"]').setInputFiles(invalid);
  await expect(page.getByRole('alert').filter({ hasText: /notes.txt/ })).toBeVisible();

  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Neue Version', exact: true }).click();
  await (await chooser).setFiles(invalid);
  await expect(page.locator('.upload-section').getByRole('alert')).toContainText('notes.txt');
  await page.getByRole('button', { name: 'Upload abbrechen' }).click();

  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Spuren hochladen', exact: true }).click();
  await (await chooser).setFiles(invalid);
  await expect(page.locator('.stem-upload').getByRole('alert')).toContainText('notes.txt');
});

test('ready versions keep compact actions and the comparison metadata fits each strip', async ({ page, isMobile, baseURL }) => {
  const { projectId, trackId } = await newTrack(page);
  const firstId = addVersion(trackId, userId, 'ready', 1);
  addVersion(trackId, userId, 'ready', 2);
  await page.request.post(`/api/v1/versions/${firstId}/approve`);
  await page.route('**/stream-url', (route) => route.fulfill({ json: { url: `${baseURL}/demo/nachtbus-v1.mp3` } }));
  await page.route('**/waveform-data', (route) => route.fulfill({ json: [0.2, 0.4, 0.1] }));
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  const approval = page.locator('.version-card').getByRole('button', { name: 'Freigeben', exact: true });
  await expect(approval).toBeVisible();
  expect((await approval.boundingBox())!.width).toBeLessThan(150);
  const picker = page.locator('.version-card .picker');
  await picker.click();
  await expect(page.locator('.picker-menu[role="menu"]')).toHaveCount(0);
  if (!isMobile) {
    await expect(page.locator('.picker-menu')).toBeVisible();
    await page.locator('.picker-menu').getByRole('button', { name: /V1/ }).click();
    await expect(picker).toContainText('V1');
  } else {
    await page.keyboard.press('Escape');
  }

  await page.getByRole('tab', { name: /Vergleichen/ }).click();
  await expect(page.locator('.strip')).toHaveCount(2);
  await expect(page.locator('.strip .lamp.s-feedback')).toHaveText('Wartet auf Feedback');
  await expect(page.locator('.strip .lamp.s-approved')).toHaveText('Frei');
  const meterTops = await page.locator('.strip .meters').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  expect(new Set(meterTops).size).toBe(1);
  for (const strip of await page.locator('.strip').all()) {
    await expect(strip.locator('.who')).toContainText('Testperson');
    expect(await strip.locator('.who').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await strip.locator('.lamp').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});

test('tempo and key are corrected in the edit dialog of the version', async ({ page, baseURL }, testInfo) => {
  const { projectId, trackId } = await newTrack(page);
  const versionId = addVersion(trackId, userId, 'ready');
  await page.request.patch(`/api/v1/versions/${versionId}`, { data: { bpm: 168.4, keyRoot: 'D', keyScale: 'minor' } });
  await page.route('**/stream-url', (route) => route.fulfill({ json: { url: `${baseURL}/demo/nachtbus-v1.mp3` } }));
  await page.route('**/waveform-data', (route) => route.fulfill({ json: [0.2, 0.4, 0.1] }));
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  const card = page.locator('.version-card');
  await expect(card.getByText('168 BPM')).toBeVisible();
  await expect(card.getByText('d-Moll')).toBeVisible();

  await card.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page.getByRole('menuitem', { name: 'Version bearbeiten' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('BPM')).toHaveValue('168.4');
  await expect(dialog.getByLabel('Tonart')).toHaveValue('D minor');
  await page.screenshot({ path: testInfo.outputPath('edit-dialog.png') });
  await dialog.getByLabel('BPM').fill('84');
  await dialog.getByLabel('Tonart').selectOption({ label: 'F-Dur' });
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(card.getByText('84 BPM')).toBeVisible();
  await expect(card.getByText('F-Dur')).toBeVisible();
});
