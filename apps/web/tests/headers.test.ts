import { expect, test } from '@playwright/test';

// The web server answers every page with the security headers of the starter and a CSP that
// allows scripts only from its own origin
test('pages carry the security headers and the CSP', async ({ page }) => {
  const response = await page.goto('/login');
  const headers = response!.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['strict-transport-security']).toBe('max-age=31536000');
  expect(headers['content-security-policy']).toContain("script-src 'self' 'nonce-");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'self'");
  // Forwarded API answers get them too
  const api = await page.request.get('/api/v1/health');
  expect(api.headers()['x-content-type-options']).toBe('nosniff');
});
