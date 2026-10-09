import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The API writes to DATABASE_URL like the API tests. The CI sets it directly.
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Own ports and the built web app, so a dev server of another project is never reused
const API_PORT = 53100;
const WEB_PORT = 54100;
const WEB = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: WEB,
    locale: 'de-DE',
    // Rate limits live in the database, so each run counts against its own address
    extraHTTPHeaders: { 'x-forwarded-for': crypto.randomUUID() },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'handy', use: devices['Pixel 7'] },
  ],
  webServer: [
    {
      command: 'bun src/index.ts',
      cwd: '../api',
      env: { PORT: String(API_PORT), APP_URL: WEB },
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
    },
    {
      command: 'bun --bun run build && bun build/index.js',
      env: { PORT: String(WEB_PORT), ORIGIN: WEB, API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}` },
      url: WEB,
      timeout: 300_000,
      reuseExistingServer: false,
    },
  ],
});
