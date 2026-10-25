import { expect, test } from '@playwright/test';
import { addVersion, logIn, removeUser } from './session.js';

let userId: string;
let versionId: string;
let shareUrl: string;

test.beforeEach(async ({ page, context, baseURL }) => {
  userId = await logIn(context, baseURL!, 'Lena');
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json();
  versionId = addVersion(track.id, userId, 'ready');
  const { link } = await (await page.request.post(`/api/v1/share/version/${versionId}`, { data: { allowComments: true } })).json();
  shareUrl = `/listen/${link.token}`;
  // The guest has no account; the test bucket holds no audio.
  await context.clearCookies();
  await page.route('**/api/v1/share/public/*', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    return route.fulfill({ response, json: { ...await response.json(), streamUrl: '/test-audio.wav', waveformUrl: null } });
  });
  await page.route('**/test-audio.wav', (route) => route.fulfill({ body: Buffer.alloc(0), contentType: 'audio/wav' }));
});
test.afterEach(() => removeUser(userId));

test('a failed guest comment keeps the player and draft, and can be retried', async ({ page }) => {
  await page.goto(shareUrl);
  const input = page.locator('.comment-form textarea');
  await page.locator('.comment-form input').fill('Mira');
  await input.fill('Mehr Raum für die Snare');
  await page.route('**/comments', (route) => route.fulfill({ status: 429, json: { error: 'Too many requests' } }));
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Zu viele Kommentare');
  await expect(input).toHaveValue('Mehr Raum für die Snare');
  await expect(page.locator('.player')).toBeVisible();
  await page.unroute('**/comments');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(page.locator('.comments')).toContainText('Mehr Raum für die Snare');
  await expect(input).toHaveValue('');
});

test('network failures keep the comment and show a retryable page error on first load', async ({ page }) => {
  await page.route('**/api/v1/share/public/*', (route) => route.abort());
  await page.goto(shareUrl);
  await expect(page.getByRole('alert')).toContainText('Keine Verbindung');
  await page.unroute('**/api/v1/share/public/*');
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.locator('.comment-form')).toBeVisible();
  await page.locator('.comment-form input').fill('Mira');
  await page.locator('.comment-form textarea').fill('Mein Entwurf');
  await page.route('**/comments', (route) => route.abort());
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Dein Kommentar bleibt hier');
  await expect(page.locator('.comment-form textarea')).toHaveValue('Mein Entwurf');
});

test('an invalid link gives a German error without creating a listen event', async ({ page }) => {
  const listens: string[] = [];
  page.on('request', (request) => { if (request.url().endsWith('/listen') && request.method() === 'POST') listens.push(request.url()); });
  await page.goto('/listen/ungueltig');
  await expect(page.getByRole('alert')).toHaveText('Dieser Link wurde nicht gefunden.');
  expect(listens).toEqual([]);
});

test('a failed guest review keeps the dialog, note and player', async ({ page }) => {
  await page.goto(shareUrl);
  await page.locator('.comment-form input').fill('Mira');
  await page.getByRole('button', { name: 'Fertig mit dem Song', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Nur Anmerkungen', { exact: true }).click();
  await dialog.getByLabel('Gesamteindruck').fill('Bitte erhalten');
  await page.route('**/review', (route) => route.fulfill({ status: 429, json: { error: 'Too many requests' } }));
  await dialog.getByRole('button', { name: 'Abschicken' }).click();
  await expect(page.getByRole('alert')).toContainText('Zu viele Rückmeldungen');
  await expect(dialog.getByLabel('Gesamteindruck')).toHaveValue('Bitte erhalten');
  await expect(page.locator('.player')).toBeVisible();
});

test('a protected link accepts Enter and explains a wrong password', async ({ page, context, baseURL }) => {
  // Create another link with the owner, then open it without a session.
  const owner = await page.context().browser()!.newContext();
  const ownerId = await logIn(owner, baseURL!);
  try {
    const { project } = await (await owner.request.post(`${baseURL}/api/v1/projects`, { data: { name: 'Geschützt' } })).json();
    const { track } = await (await owner.request.post(`${baseURL}/api/v1/tracks/${project.id}`, { data: { name: 'Passwortmix' } })).json();
    const id = addVersion(track.id, ownerId, 'ready');
    const { link } = await (await owner.request.post(`${baseURL}/api/v1/share/version/${id}`, { data: { password: 'nachtbus', allowComments: true } })).json();
    await context.clearCookies();
    await page.goto(`/listen/${link.token}`);
    const field = page.getByLabel('Passwort', { exact: true });
    await field.fill('falsch');
    await field.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Das Passwort ist nicht richtig');
    await expect(field).toHaveValue('falsch');
    await field.fill('nachtbus');
    await field.press('Enter');
    await expect(page.getByRole('heading', { name: 'Passwortmix', exact: true })).toBeVisible();
    await expect(field).toHaveCount(0);
  } finally {
    await owner.close();
    removeUser(ownerId);
  }
});

test('guests see replies next to the comment they answer', async ({ page }) => {
  await page.route('**/api/v1/share/public/*', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const comment = { timestampSeconds: null, resolvedAt: null, createdAt: new Date().toISOString(), guestName: 'Mira', user: null };
    await route.fulfill({ response, json: { ...data, streamUrl: '/test-audio.wav', waveformUrl: null, comments: [
      { ...comment, id: 'parent', parentId: null, body: 'Mehr Raum für die Snare' },
      { ...comment, id: 'reply', parentId: 'parent', body: 'Ist im nächsten Mix drin' },
      { ...comment, id: 'orphan', parentId: 'deleted', body: 'Antwort auf gelöschten Kommentar' },
    ] } });
  });
  await page.goto(shareUrl);
  await expect(page.getByRole('heading', { name: 'Kommentare (3)' })).toBeVisible();
  const parent = page.locator('.comment', { hasText: 'Mehr Raum für die Snare' });
  await expect(parent.locator('.reply')).toHaveText(/Ist im nächsten Mix drin/);
  await expect(page.locator('.comments')).toContainText('Antwort auf gelöschten Kommentar');
});

test('the listener name controls stay inside their panel at phone width', async ({ page }) => {
  // A real, short PCM WAV lets the player enter its first-play state.
  const audio = Buffer.alloc(44 + 16000);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(16000, 40);
  await page.route('**/test-audio.wav', (route) => route.fulfill({ body: audio, contentType: 'audio/wav' }));
  await page.goto(shareUrl);
  await page.getByRole('button', { name: 'Abspielen', exact: true }).click();
  const prompt = page.locator('.name-prompt');
  await expect(prompt).toBeVisible();
  for (const width of [393, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const panel = (await prompt.boundingBox())!;
    for (const control of await prompt.locator('input, button').all()) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(panel.x);
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
    }
  }
  await prompt.getByRole('button', { name: 'Überspringen' }).click();
  await expect(prompt).toHaveCount(0);
});
