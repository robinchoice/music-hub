import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The runner supplies an isolated DATABASE_URL; the env file fills in other settings.
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Own ports and the built web app, so a dev server of another project is never reused.
// Use TEST_API_PORT and TEST_WEB_PORT below Linux's ephemeral range (32768–60999).
const API_PORT = Number(process.env.TEST_API_PORT ?? 31100);
const WEB_PORT = Number(process.env.TEST_WEB_PORT ?? 31101);
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
      // One admin address per browser project, see updates.test.ts
      env: {
        PORT: String(API_PORT),
        APP_URL: WEB,
        ADMIN_EMAILS: 'e2e-admin-desktop@example.com,e2e-admin-handy@example.com',
        // Public share pages sign audio URLs; the browser tests intercept the files.
        S3_ENDPOINT: `http://127.0.0.1:${API_PORT}`,
        S3_BUCKET: 'test',
        S3_ACCESS_KEY: 'test',
        S3_SECRET_KEY: 'test',
      },
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
