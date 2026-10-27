import { expect, test } from '@playwright/test';
import { logIn, removeUser } from './session.js';

// Console errors fail the test
let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test('initials skip brackets in guest names', async ({ page }) => {
  await page.goto('/');
  const feedback = page.locator('.frag-stack').first();
  await feedback.scrollIntoViewIfNeeded();
  // The demo guest "Tom (Label)" on the waveform and next to his comment
  await expect(feedback.locator('.marker-dot', { hasText: 'TL' })).toHaveCount(1);
  await expect(feedback.locator('.avatar', { hasText: 'TL' })).toHaveCount(1);
  await expect(feedback.getByText('T(', { exact: true })).toHaveCount(0);
});

test('the comment box fits the phone and hides keyboard hints on touch', async ({ page, isMobile }) => {
  await page.goto('/');
  const feedback = page.locator('.frag-stack').first();
  await feedback.scrollIntoViewIfNeeded();
  // The chip in front already shows the position, the placeholder doesn't repeat it
  await expect(feedback.locator('.ts-chip')).toBeVisible();
  await expect(feedback.locator('.composer input')).toHaveAttribute('placeholder', 'Kommentar zu V4 …');
  await expect(feedback.getByText('Taste C nimmt die aktuelle Position')).toBeVisible({ visible: !isMobile });
  if (!isMobile) await expect(feedback.locator('.hint')).toHaveText('Klick in die Wellenform wählt die Stelle · Taste C nimmt die aktuelle Position', { useInnerText: true });
});

test('the last file of the chaos box is fully visible', async ({ page }) => {
  await page.goto('/');
  const box = page.locator('.ba-col.before');
  await box.scrollIntoViewIfNeeded();
  const col = (await box.boundingBox())!;
  const file = (await box.locator('.f4').boundingBox())!;
  expect(file.y + file.height).toBeLessThanOrEqual(col.y + col.height);
});

test('all bottom nav labels sit on one line', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The bottom nav only shows on phones');
  await page.goto('/');
  const labels = page.frameLocator('.phone-demo iframe').locator('.bottom-nav .nav-item > span:last-child');
  await expect(labels).toHaveCount(3);
  const ys = await labels.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(ys).size).toBe(1);
});

test('an approval shows open points first and can be undone', async ({ page }) => {
  await page.goto('/');
  const decision = page.locator('.frag-stack').nth(1);
  await decision.scrollIntoViewIfNeeded();
  await expect(decision.locator('.open-hint')).toHaveText('Noch 5 offene Punkte zu V4');

  await decision.getByRole('button', { name: 'Freigeben' }).click();
  await expect(decision.locator('.version-card .status')).toHaveText('Freigegeben');
  await expect(decision.locator('.open-hint')).toHaveCount(0);

  const toast = page.getByRole('alert').filter({ hasText: 'V4 ist freigegeben' });
  await toast.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(decision.locator('.version-card .status')).toHaveText('Bereit');
  await expect(decision.getByRole('button', { name: /Fertig mit V4/ })).toBeVisible();
});

test('"Fertig" sends the open pass with a verdict and shows up under Rückmeldungen', async ({ page }) => {
  await page.goto('/');
  const decision = page.locator('.frag-stack').nth(1);
  await decision.scrollIntoViewIfNeeded();
  // Mara's comment on V4 from ten minutes ago is still open
  await decision.getByRole('button', { name: 'Fertig mit V4 1' }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Eine Anmerkung geht gesammelt an Kai.')).toBeVisible();
  await sheet.getByText('Änderungen nötig', { exact: true }).click();
  await expect(sheet.getByRole('radio', { name: /Änderungen nötig/ })).toBeChecked();
  await sheet.getByLabel('Gesamteindruck').fill('Höhen noch etwas runter');
  await sheet.getByRole('button', { name: 'Abschicken' }).click();

  await expect(decision.locator('.version-card .status')).toHaveText('Abgelehnt');
  const feedback = decision.locator('.feedback');
  await expect(feedback.getByText('Änderungen nötig')).toBeVisible();
  await expect(feedback.getByText('„Höhen noch etwas runter“')).toBeVisible();
  await expect(decision.getByRole('button', { name: 'Fertig mit V4', exact: true })).toBeVisible();
});

test('resolving a comment and the filter of resolved ones have different names', async ({ page }) => {
  await page.goto('/');
  const feedback = page.locator('.frag-stack').first();
  await feedback.scrollIntoViewIfNeeded();
  await expect(feedback.getByRole('button', { name: 'Abhaken' }).first()).toBeVisible();
  await expect(feedback.getByRole('button', { name: /^Erledigte/ })).toBeVisible();
  await expect(feedback.getByRole('button', { name: 'Erledigt', exact: true })).toHaveCount(0);
});

test('signed in, the server-rendered nav already leads to the dashboard', async ({ page, context, baseURL }) => {
  const userId = await logIn(context, baseURL!);
  try {
    const html = await (await page.request.get('/')).text();
    expect(html).toContain('Zum Dashboard');
    expect(html).not.toContain('Konto anlegen');
  } finally {
    removeUser(userId);
  }
});

test('a reaction shows who reacted and a second tap takes it back', async ({ page, isMobile }) => {
  await page.goto('/');
  const feedback = page.locator('.frag-stack').first();
  await feedback.scrollIntoViewIfNeeded();
  const item = feedback.locator('.comment', { hasText: 'Backings im Refrain noch etwas lauter?' });
  const thumbs = item.locator('.reaction', { hasText: '👍' });
  await expect(thumbs.locator('.chip')).toHaveText('👍 2');
  await expect(thumbs.locator('.chip')).toHaveAttribute('aria-pressed', 'true');

  // Hover on desktop, a tap on phones
  if (isMobile) await thumbs.locator('.chip').tap();
  else await thumbs.hover();
  await expect(thumbs.locator('.who')).toHaveText('Lisa, Du');

  await item.getByRole('button', { name: 'Reagieren' }).first().click();
  await item.locator('.picker').getByRole('button', { name: '🔥' }).click();
  await expect(item.locator('.reaction', { hasText: '🔥' }).locator('.chip')).toHaveText('🔥 1');

  await item.getByRole('button', { name: 'Reagieren' }).first().click();
  await item.locator('.picker').getByRole('button', { name: '🔥' }).click();
  await expect(item.locator('.reaction', { hasText: '🔥' })).toHaveCount(0);
});

test('the demo version shows its file details', async ({ page }) => {
  await page.goto('/');
  const file = page.locator('.version-card .file').first();
  await file.scrollIntoViewIfNeeded();
  await expect(file).toHaveText(/WAV.*48 kHz.*24 Bit.*−15,3 LUFS.*−0,4 dBTP.*LRA 8,7 LU/);
});

test.describe('in English', () => {
  test.use({ locale: 'en-GB' });

  test('the start page and its demo follow the browser language', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Versions for music. Without the chaos.');
    const feedback = page.locator('.frag-stack').first();
    await feedback.scrollIntoViewIfNeeded();
    await expect(feedback.getByText('Snare in the verse is a bit too loud')).toBeVisible();
  });
});
