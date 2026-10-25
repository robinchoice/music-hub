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
