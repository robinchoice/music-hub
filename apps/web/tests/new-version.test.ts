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
  for (const name of ['Einstellungen', 'Upload-Link', 'Neuer Track']) await expect(page.getByRole('button', { name }).or(page.getByRole('link', { name }))).toBeVisible();
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
});
