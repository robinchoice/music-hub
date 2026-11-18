import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { logIn, removeUser } from './session.js';

for (const language of ['de', 'en']) {
  test(`OAuth consent and account revocation in ${language}`, async ({ page, context, baseURL }, info) => {
    const userId = await logIn(context, baseURL!);
    await context.addCookies([{ name: 'locale', value: language, url: baseURL! }]);
    try {
      const registration = await context.request.post('/api/v1/oauth/register', { data: {
        client_name: 'Inspector test', redirect_uris: ['http://127.0.0.1:6274/callback'], token_endpoint_auth_method: 'none',
      } });
      expect(registration.status()).toBe(201);
      const { client_id } = await registration.json();
      const verifier = randomBytes(32).toString('base64url');
      const params = new URLSearchParams({ client_id, redirect_uri: 'http://127.0.0.1:6274/callback', response_type: 'code',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
        scope: 'music:read', state: randomBytes(16).toString('hex'), resource: `${baseURL}/mcp` });
      await page.goto(`/api/v1/oauth/authorize?${params}`);
      const allow = page.getByRole('button', { name: language === 'de' ? 'Lesen erlauben' : 'Allow reading' });
      await expect(allow).toBeVisible();
      await expect(page.getByText('Inspector test', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (language === 'de') {
        const original = page.viewportSize()!;
        for (const [width, height] of [[320, 568], [844, 390], [768, 1024], [1024, 768], [430, 300]]) {
          await page.setViewportSize({ width: width!, height: height! });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await allow.scrollIntoViewIfNeeded();
          await expect(allow).toBeVisible();
          await expect(page.getByText('Inspector test', { exact: true })).toBeVisible();
        }
        await page.setViewportSize(original);
      }
      await page.screenshot({ path: info.outputPath(`mcp-consent-${language}.png`), fullPage: true });
      let code: string | null = null;
      await page.route('http://127.0.0.1:6274/callback**', async (route) => {
        const url = new URL(route.request().url());
        expect(url.searchParams.get('state')).toBe(params.get('state'));
        expect(url.searchParams.get('iss')).toBe(baseURL);
        code = url.searchParams.get('code');
        await route.fulfill({ body: 'Connected' });
      });
      await allow.click();
      await expect.poll(() => code).toBeTruthy();
      const tokens = await context.request.post('/api/v1/oauth/token', { form: {
        client_id, grant_type: 'authorization_code', redirect_uri: params.get('redirect_uri')!, code: code!, code_verifier: verifier, resource: `${baseURL}/mcp`,
      } });
      expect(tokens.status()).toBe(200);
      const { access_token } = await tokens.json();
      await page.goto('/account');
      const section = page.locator('section').filter({ has: page.getByRole('heading', { name: language === 'de' ? 'KI-Clients' : 'AI clients', exact: true }) });
      await expect(section.getByText('Inspector test', { exact: true })).toBeVisible();
      await section.screenshot({ path: info.outputPath(`mcp-settings-${language}.png`) });
      await section.getByRole('button', { name: language === 'de' ? 'Zugriff widerrufen' : 'Revoke access' }).click();
      await expect(section.getByText(language === 'de' ? 'Keine KI-Clients verbunden.' : 'No AI clients connected.')).toBeVisible();
      const revoked = await context.request.post('/mcp', { headers: { authorization: `Bearer ${access_token}` }, data: {} });
      expect(revoked.status()).toBe(401);
    } finally { removeUser(userId); }
  });
}
