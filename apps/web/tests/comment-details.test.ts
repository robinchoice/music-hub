import { expect, test, type Page } from '@playwright/test';
import { addMember, addVersion, logIn, makeViewer, removeUser } from './session.js';

// Details of the comment list on the track page, found by the UX review of 1 Nov 2026
let userId: string;
let lena: string | undefined;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!, 'Robin');
});
test.afterEach(() => {
  removeUser(userId);
  if (lena) removeUser(lena);
  lena = undefined;
});

async function openTrack(page: Page, baseURL: string, uploadedByMe: boolean, realAudio = false) {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json();
  lena = addMember(project.id);
  const versionId = addVersion(track.id, uploadedByMe ? userId : lena, 'ready');
  await page.route('**/stream-url', (route) => route.fulfill({ json: { url: `${baseURL}/${realAudio ? 'demo/nachtbus-v1.mp3' : 'fake-s3/mix.wav'}` } }));
  await page.route('**/waveform-data', (route) => route.fulfill({ json: [0.1, 0.4, 0.8, 0.5, 0.2] }));
  await page.route('**/fake-s3/**', (route) => route.fulfill({ body: Buffer.alloc(0), contentType: 'audio/wav' }));
  await page.goto(`/projects/${project.id}/tracks/${track.id}`);
  await expect(page.locator('.version-card .status')).toHaveText('Bereit');
  return versionId;
}

async function comment(page: Page, body: string) {
  const composer = page.getByPlaceholder('Kommentar zu V1 …');
  await composer.fill(body);
  await composer.press('Enter');
  const item = page.locator('.comment', { hasText: body }).first();
  await expect(item).toBeVisible();
  return item;
}

test('the uploader has no "Fertig" to send, so their comments are not marked as new in a pass', async ({ page, baseURL }) => {
  await openTrack(page, baseURL!, true);
  const item = await comment(page, 'Snare zu dünn');
  await expect(item.locator('.fresh-tag')).toHaveCount(0);
  await expect(item).not.toHaveClass(/fresh/);
});

test('ticking a comment off can be undone from the toast', async ({ page, baseURL }) => {
  await openTrack(page, baseURL!, false);
  const item = await comment(page, 'Hall kürzer');
  await item.getByRole('button', { name: 'Abhaken' }).click();
  await expect(page.getByText('Keine offenen Kommentare')).toBeVisible();
  const toast = page.locator('.toast-container').getByText('Kommentar abgehakt').locator('..');
  await toast.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('.comment', { hasText: 'Hall kürzer' })).toBeVisible();
  await expect(page.locator('.filter').getByRole('button', { name: /^Offen \d/ })).toContainText('1');
});

test('answering and editing put the cursor straight into the field', async ({ page, baseURL }) => {
  await openTrack(page, baseURL!, false);
  const item = await comment(page, 'Bass dröhnt');
  await item.getByRole('button', { name: 'Antworten' }).click();
  await expect(item.getByPlaceholder('Antwort schreiben …')).toBeFocused();
  await item.getByRole('button', { name: 'Abbrechen' }).click();
  await item.getByRole('button', { name: 'Bearbeiten' }).click();
  // While editing, the text sits in the field and no longer matches the item
  await expect(page.locator('.comment textarea')).toBeFocused();
});

test('a reply lines up with its comment on the right and keeps the stripe off its avatar', async ({ page, baseURL }) => {
  await openTrack(page, baseURL!, false);
  const item = await comment(page, 'Intro zu lang');
  await item.getByRole('button', { name: 'Antworten' }).click();
  await item.getByPlaceholder('Antwort schreiben …').fill('Kürze ich');
  await item.getByRole('button', { name: 'Antworten' }).last().click();
  const reply = page.locator('.comment.reply', { hasText: 'Kürze ich' });
  await expect(reply).toBeVisible();

  const right = async (el: ReturnType<Page['locator']>) => { const b = (await el.boundingBox())!; return b.x + b.width; };
  expect(Math.abs((await right(reply.locator('.when'))) - (await right(item.locator('.when').first())))).toBeLessThan(2);
  const replyBox = (await reply.boundingBox())!;
  const avatarBox = (await reply.locator('> :first-child').boundingBox())!;
  expect(avatarBox.x - replyBox.x).toBeGreaterThanOrEqual(8);
});

test('comment actions are big enough for a finger on touch screens', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'Touch screens only');
  const versionId = await openTrack(page, baseURL!, false);
  await page.request.post(`/api/v1/comments/version/${versionId}`, { data: { body: 'Knackt hier', timestampSeconds: 27 } });
  const item = await comment(page, 'Gesang lauter');
  for (const name of ['Antworten', 'Reagieren', 'Abhaken']) {
    expect((await item.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(32);
  }
  expect((await page.locator('.filter button').first().boundingBox())!.height).toBeGreaterThanOrEqual(32);
  expect((await page.locator('.comment .ts', { hasText: '0:27' }).boundingBox())!.height).toBeGreaterThanOrEqual(32);
});

test('a waveform position stays in the mobile composer while reading and is sent with the comment', async ({ page, baseURL, isMobile }, testInfo) => {
  const versionId = await openTrack(page, baseURL!, false, true);
  await expect(page.getByRole('button', { name: 'Abspielen', exact: true })).toBeEnabled();
  const wave = page.locator('.waveform');
  const box = (await wave.boundingBox())!;
  await wave.click({ position: { x: box.width / 4, y: box.height / 2 } });
  const composer = page.locator('.composer');
  await expect(composer.locator('.ts-chip')).toBeVisible();
  const position = await composer.locator('.ts-seek').innerText();
  await expect(composer.locator('input')).toHaveAttribute('placeholder', `Was fällt dir bei ${position.trim()} auf?`);
  if (isMobile) {
    await expect(page.locator('.selected-position')).toBeVisible();
    const nav = (await page.locator('.bottom-nav').boundingBox())!;
    const before = (await composer.boundingBox())!;
    expect(Math.abs(before.y + before.height - nav.y)).toBeLessThan(2);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(Math.abs((await composer.boundingBox())!.y - before.y)).toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath('composer.png') });
  } else {
    await expect(page.locator('.selected-position')).toBeHidden();
    expect(await composer.evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');
  }
  await composer.locator('input').fill('An dieser Stelle den Bass leiser');
  await composer.getByRole('button', { name: 'Senden' }).click();
  if (isMobile) {
    const notice = page.getByRole('alert', { name: '' }).filter({ hasText: 'Kommentar gespeichert' });
    await expect(notice).toBeVisible();
    const toastBox = (await notice.boundingBox())!;
    expect(toastBox.y + toastBox.height).toBeLessThan((await composer.boundingBox())!.y);
  }
  await expect(page.locator('.comment', { hasText: 'An dieser Stelle den Bass leiser' })).toBeVisible();
  const { comments } = await (await page.request.get(`/api/v1/comments/version/${versionId}`)).json();
  expect(comments.find((c: { body: string }) => c.body === 'An dieser Stelle den Bass leiser').timestampSeconds).toBeGreaterThan(0);
  await expect(composer.locator('.ts-chip')).toHaveCount(0);
  await expect(page.locator('.selected-position')).toHaveCount(0);
  await wave.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await composer.getByRole('button', { name: 'Stelle entfernen' }).click();
  await expect(composer.locator('input')).toHaveAttribute('placeholder', 'Kommentar zu V1 …');
});

test('a listener without comment permission has no docked composer', async ({ page, baseURL }) => {
  await openTrack(page, baseURL!, false, true);
  const projectId = new URL(page.url()).pathname.split('/')[2]!;
  makeViewer(projectId, userId);
  await page.reload();
  await expect(page.locator('.version-card')).toBeVisible();
  await expect(page.locator('.composer')).toHaveCount(0);
});
