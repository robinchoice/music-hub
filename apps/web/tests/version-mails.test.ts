import { expect, test } from '@playwright/test';
import { logIn, mailTokenOf, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

test('mails about new versions turn off in the account and through the link in the mail', async ({ page }) => {
  await page.goto('/account');
  const mails = page.getByRole('checkbox', { name: /Mails zu neuen Versionen/ });
  await expect(mails).toBeChecked();
  const saved = () => page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/me') && r.request().method() === 'PATCH');
  await Promise.all([saved(), mails.uncheck()]);
  await page.reload();
  await expect(mails).not.toBeChecked();
  await Promise.all([saved(), mails.check()]);
  await page.reload();
  await expect(mails).toBeChecked();

  await page.goto(`/abbestellen?t=${mailTokenOf(userId)}`);
  await page.getByRole('button', { name: 'Abbestellen' }).click();
  await expect(page.getByText('Abbestellt.')).toBeVisible();
  await page.goto('/account');
  await expect(mails).not.toBeChecked();
});
