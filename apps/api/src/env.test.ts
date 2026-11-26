import { expect, test } from 'bun:test';

test('regression: a restricted Stripe key lets the API start', () => {
  const result = Bun.spawnSync([process.execPath, `${import.meta.dir}/env.ts`], {
    env: {
      DATABASE_URL: 'postgres://localhost/test',
      STRIPE_SECRET_KEY: 'rk_test_music_hub',
      STRIPE_WEBHOOK_SECRET: 'whsec_music_hub',
    },
  });

  expect(result.stderr.toString()).toBe('');
  expect(result.exitCode).toBe(0);
});
