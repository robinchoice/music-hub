import { expect, test, type Page } from '@playwright/test';
import { addVersion, finishProcessing, logIn, removeEmail, removeUser } from './session.js';

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

// The test bucket holds no files: the player gets a short silence and a waveform
async function fakeAudio(page: Page, baseURL: string) {
  await page.route('**/stream-url', (route) => route.fulfill({ json: { url: `${baseURL}/fake-s3/mix.wav` } }));
  await page.route('**/fake-s3/**', (route) => route.fulfill({ body: Buffer.alloc(0), contentType: 'audio/wav' }));
  await page.route('**/waveform-data', (route) => route.fulfill({ json: Array.from({ length: 200 }, (_, i) => Math.abs(Math.sin(i / 7))) }));
}

test('while the worker runs, the version reads as processing with a grey play button', async ({ page, baseURL }) => {
  const { projectId, trackId } = await newTrack(page);
  addVersion(trackId, userId, 'processing');
  await fakeAudio(page, baseURL!);
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  const card = page.locator('.version-card');
  await expect(card.getByText('Wird verarbeitet')).toBeVisible();
  await expect(card).toContainText('meist unter einer Minute');
  await expect(card.locator('.breath i')).toHaveCount(64);
  await expect(card.getByRole('button', { name: 'Abspielen' })).toBeDisabled();
  // The invitation waits until there is something to hear
  await expect(page.getByText('Wer soll reinhören?')).toHaveCount(0);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`the finished waveform ${reducedMotion === 'reduce' ? 'appears without motion' : 'grows in once'}`, async ({ page, baseURL }) => {
    await page.emulateMedia({ reducedMotion });
    const { projectId, trackId } = await newTrack(page);
    const versionId = addVersion(trackId, userId, 'processing');
    await fakeAudio(page, baseURL!);
    await page.goto(`/projects/${projectId}/tracks/${trackId}`);
    await expect(page.locator('.breath')).toBeVisible();

    // The event stream may still be connecting, so the worker reports until the page hears it
    await expect(async () => {
      finishProcessing(trackId, versionId);
      await expect(page.locator('.player.grow .waveform')).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(page.locator('.breath')).toHaveCount(0);
    await expect(page.locator('.version-card').getByText('Bereit', { exact: true })).toBeVisible();
    const animation = await page.locator('.player.grow .waveform').evaluate((el) => getComputedStyle(el).animationName);
    if (reducedMotion === 'reduce') expect(animation).toBe('none');
    else expect(animation).toContain('grow-in');
  });
}

test('alone in the project, the first version asks who should listen', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { projectId, trackId } = await newTrack(page);
  addVersion(trackId, userId, 'ready');
  await fakeAudio(page, baseURL!);
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  const invite = page.locator('section.invite');
  await expect(invite).toContainText('V1 ist da. Wer soll reinhören?');

  await invite.getByRole('button', { name: 'Link kopieren' }).click();
  await expect(invite.getByLabel('Gast-Link')).toHaveValue(new RegExp(`^${baseURL}/listen/\\w+`));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/listen\/\w+/);

  const email = `test-${crypto.randomUUID()}@example.com`;
  try {
    await invite.getByLabel('E-Mail-Adresse').fill(email);
    await invite.getByRole('button', { name: 'Einladen' }).click();
    await expect(page.locator('.toast-container')).toContainText(`${email} ist eingeladen`);
    await expect(invite).toHaveCount(0);
    const { members } = await (await page.request.get(`/api/v1/projects/${projectId}/members`)).json();
    expect(members.map((m: { user: { email: string } }) => m.user.email)).toContain(email);

    // With someone in the project the card stays away
    const loaded = page.waitForResponse(/\/members$/);
    await page.reload();
    await loaded;
    await expect(page.locator('.version-card')).toBeVisible();
    await expect(page.getByText('Wer soll reinhören?')).toHaveCount(0);
  } finally {
    removeEmail(email);
  }
});

test('"Nicht jetzt" hides the invitation for this track, later versions never show it', async ({ page, baseURL }) => {
  const { projectId, trackId } = await newTrack(page);
  addVersion(trackId, userId, 'ready');
  await fakeAudio(page, baseURL!);
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  await page.getByRole('button', { name: 'Nicht jetzt' }).click();
  await expect(page.locator('section.invite')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.version-card')).toBeVisible();
  await expect(page.locator('section.invite')).toHaveCount(0);

  const other = await newTrack(page);
  addVersion(other.trackId, userId, 'ready', 1);
  addVersion(other.trackId, userId, 'ready', 2);
  const loaded = page.waitForResponse(/\/members$/);
  await page.goto(`/projects/${other.projectId}/tracks/${other.trackId}`);
  await loaded;
  await expect(page.locator('.version-card')).toBeVisible();
  await expect(page.locator('section.invite')).toHaveCount(0);
});
