import { afterEach, expect, test } from 'bun:test';
import { PaymentServiceError } from './errors.js';
import { eurToSats, setPriceSource } from './rate.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  setPriceSource(null);
  globalThis.fetch = realFetch;
});

test('converts cents to sats, rounded up', async () => {
  setPriceSource(async () => 100_000);
  // 40 € at 100 000 € per bitcoin = 0.0004 BTC
  expect(await eurToSats(4000)).toBe(40_000);
  setPriceSource(async () => 60_000);
  // 1 cent = 16.67 sats
  expect(await eurToSats(1)).toBe(17);
  expect(await eurToSats(48000)).toBe(800_000);
});

test('caches the price for a minute', async () => {
  let calls = 0;
  setPriceSource(async () => {
    calls++;
    return 50_000;
  });
  await eurToSats(100);
  await eurToSats(200);
  expect(calls).toBe(1);
});

test('turns a failing or nonsense price into a payment service error', async () => {
  setPriceSource(async () => {
    throw new Error('boom');
  });
  await expect(eurToSats(100)).rejects.toBeInstanceOf(PaymentServiceError);
  setPriceSource(async () => 0);
  await expect(eurToSats(100)).rejects.toBeInstanceOf(PaymentServiceError);
  setPriceSource(async () => Number.NaN);
  await expect(eurToSats(100)).rejects.toBeInstanceOf(PaymentServiceError);
});

test('reads the EUR field from mempool.space', async () => {
  const urls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      urls.push(String(input));
      return Response.json({ time: 1, USD: 110_000, EUR: 100_000 });
    },
    { preconnect: realFetch.preconnect },
  );
  expect(await eurToSats(4000)).toBe(40_000);
  expect(urls).toEqual(['https://mempool.space/api/v1/prices']);
});

test('refuses a broken mempool.space answer', async () => {
  globalThis.fetch = Object.assign(async () => Response.json({ USD: 110_000 }), { preconnect: realFetch.preconnect });
  const err = await eurToSats(100).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PaymentServiceError);
  expect((err as PaymentServiceError).message).toContain('Bitcoin-Kurs');
  globalThis.fetch = Object.assign(async () => new Response('down', { status: 503 }), { preconnect: realFetch.preconnect });
  await expect(eurToSats(100)).rejects.toBeInstanceOf(PaymentServiceError);
});
