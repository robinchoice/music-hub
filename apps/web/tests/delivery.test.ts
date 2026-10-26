import { expect, test } from '@playwright/test';
import { addStem, addVersion, logIn, removeUser, setPlan } from './session.js';

let userId: string;
let projectId: string;
const trackIds: string[] = [];

test.beforeEach(async ({ page, context, baseURL }) => {
  userId = await logIn(context, baseURL!, 'Studio Klanglabor');
  setPlan(userId, 'solo');
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Zwischenstand' } })).json();
  projectId = project.id;
  trackIds.length = 0;
  for (const name of ['Nordlicht', 'Kaltfront']) {
    const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name } })).json();
    addVersion(track.id, userId, 'ready');
    trackIds.push(track.id);
  }
  addStem(trackIds[0]!, userId, 'Gesang');
  const account = await page.request.put('/api/v1/payment-account', {
    data: { iban: 'DE89 3704 0044 0532 0130 00', accountHolder: 'Studio Klanglabor' },
  });
  expect(account.ok()).toBe(true);
  // The test bucket holds no audio, the preview plays a silent file
  await page.route('**/api/v1/share/public/*', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    return route.fulfill({ response, json: { ...await response.json(), streamUrl: '/test-audio.wav', waveformUrl: null, processing: false } });
  });
  await page.route('**/test-audio.wav', (route) => route.fulfill({ body: Buffer.alloc(0), contentType: 'audio/wav' }));
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  removeUser(userId);
});

test('a client approves every song, pays by transfer, and downloads once the studio confirms', async ({ page, context }) => {
  // Studio and client take turns, which takes longer than one page
  test.setTimeout(120_000);
  // The studio sets up the order on the project page
  await page.goto(`/projects/${projectId}?view=auftrag`);
  await page.getByLabel('Kunde', { exact: true }).fill('Lena Berger');
  await page.getByLabel('Preis pro Song (€)').fill('120');
  await page.getByLabel('Korrekturrunden inklusive').fill('0');
  await page.getByRole('button', { name: 'Auftrag anlegen' }).click();
  await expect(page.getByRole('heading', { name: /Songs und Runden/ })).toBeVisible();
  const link = new URL(await page.getByLabel('Link für den Kunden').inputValue()).pathname;
  const studio = await context.cookies();

  // The client hears without an account; paying waits for every approval
  await context.clearCookies();
  await page.goto(link);
  await expect(page.getByText('Ablieferung für Lena Berger')).toBeVisible();
  await expect(page.getByText('von Studio Klanglabor')).toBeVisible();
  await page.getByRole('button', { name: 'Bezahlen und herunterladen' }).click();
  await expect(page.getByText('Bezahlen geht, sobald alle Songs freigegeben sind.')).toBeVisible();
  await expect(page.getByText(/WAV und Spuren gibt es nach der Zahlung/)).toBeVisible();

  const rows = page.locator('.tracklist .row');
  const dialog = page.getByRole('dialog');
  await expect(page.getByRole('heading', { name: 'Nordlicht', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
  await dialog.getByLabel('Dein Name').fill('Lena');
  await dialog.getByRole('button', { name: 'Freigeben', exact: true }).click();
  await expect(rows.nth(0)).toContainText('Freigegeben');

  // No round is included, so asking for changes costs extra and has to be ordered explicitly
  await rows.nth(1).click();
  await expect(page.getByRole('heading', { name: 'Kaltfront', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Zusatzrunde anfordern · 40 €' }).click();
  await dialog.getByLabel('Was soll sich ändern? (optional)').fill('Gesang in der Bridge lauter');
  await dialog.getByRole('button', { name: 'Zahlungspflichtig beauftragen · 40 €' }).click();
  await expect(rows.nth(1)).toContainText('Studio arbeitet');
  await expect(page.getByText('1 Zusatzrunde (40 €)', { exact: false }).first()).toBeVisible();

  // The studio could give that round for free; its table fits the phone with the extra button
  const client = await context.cookies();
  await context.addCookies(studio);
  await page.goto(`/projects/${projectId}?view=auftrag`);
  await expect(page.getByRole('button', { name: 'Runde schenken' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await context.clearCookies();
  await context.addCookies(client);
  await page.goto(link);

  // The studio delivers V2, the client approves it
  addVersion(trackIds[1]!, userId, 'ready', 2);
  await page.reload();
  await rows.nth(1).click();
  await expect(page.locator('.tracklist .row').nth(1)).toContainText('V2');
  await page.getByRole('button', { name: 'Freigeben', exact: true }).click();
  await dialog.getByRole('button', { name: 'Freigeben', exact: true }).click();
  await expect(rows.nth(1)).toContainText('Freigegeben');
  await expect(page.getByText('2 von 2 freigegeben')).toBeVisible();

  // Transfer with a GiroCode, then "Ich habe überwiesen"
  await page.getByRole('button', { name: 'Bezahlen und herunterladen · 280 €' }).click();
  await dialog.getByRole('button', { name: /Überweisung/ }).click();
  await expect(dialog.getByRole('img', { name: 'GiroCode für die Überweisung' })).toBeVisible();
  await expect(dialog).toContainText('DE89 3704 0044 0532 0130 00');
  await expect(dialog).toContainText('280 €');
  await dialog.getByRole('button', { name: 'Ich habe überwiesen' }).click();
  await expect(dialog.getByRole('heading', { name: 'Überweisung angekündigt' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Überweisung angekündigt · Details' })).toBeVisible();
  await expect(page.getByRole('link', { name: /WAV/ })).toHaveCount(0);

  // The studio sees the announcement and confirms the money arrived
  await context.addCookies(studio);
  await page.goto(`/projects/${projectId}?view=auftrag`);
  await expect(page.getByText('Lena Berger hat 280 € per Überweisung angekündigt.')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Zahlung eingegangen' }).first().click();
  await expect(page.getByText('Bezahlt', { exact: true })).toBeVisible();

  // Now the originals are there
  await context.clearCookies();
  await page.goto(link);
  await expect(page.getByText('Bezahlt · 280 €')).toBeVisible();
  const wav = page.getByRole('link', { name: 'WAV', exact: true });
  await expect(wav).toBeVisible();
  await expect(page.getByRole('link', { name: 'Spuren (ZIP)' })).toBeVisible();
  const res = await page.request.get((await wav.getAttribute('href'))!, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  await rows.nth(1).click();
  await expect(page.getByRole('heading', { name: 'Kaltfront', level: 2 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'WAV', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Spuren (ZIP)' })).toHaveCount(0);
});
