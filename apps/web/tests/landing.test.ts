import { expect, test } from '@playwright/test';

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
  if (!isMobile) await expect(feedback.locator('.hint')).toHaveText('Klick in die Wellenform wählt die Stelle · Taste C nimmt die aktuelle Position');
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
  await expect(decision.getByRole('button', { name: 'Ablehnen' })).toBeVisible();
});

test('resolving a comment and the filter of resolved ones have different names', async ({ page }) => {
  await page.goto('/');
  const feedback = page.locator('.frag-stack').first();
  await feedback.scrollIntoViewIfNeeded();
  await expect(feedback.getByRole('button', { name: 'Abhaken' }).first()).toBeVisible();
  await expect(feedback.getByRole('button', { name: /^Erledigte/ })).toBeVisible();
  await expect(feedback.getByRole('button', { name: 'Erledigt', exact: true })).toHaveCount(0);
});
