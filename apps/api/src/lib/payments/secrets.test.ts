import { afterEach, beforeEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, paymentsConfigured } from './secrets.js';

const previous = process.env.PAYMENT_SECRETS_KEY;
const url = `nostr+walletconnect://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.example&secret=${'b'.repeat(64)}`;

beforeEach(() => {
  process.env.PAYMENT_SECRETS_KEY = randomBytes(32).toString('base64');
});

afterEach(() => {
  if (previous === undefined) delete process.env.PAYMENT_SECRETS_KEY;
  else process.env.PAYMENT_SECRETS_KEY = previous;
});

test('round-trips with a fresh IV each time and hides the plain text', () => {
  const a = encryptSecret(url);
  const b = encryptSecret(url);
  expect(a).not.toBe(b);
  expect(a).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
  expect(a).not.toContain('b'.repeat(16));
  expect(decryptSecret(a)).toBe(url);
  expect(decryptSecret(b)).toBe(url);
});

test('refuses a tampered text, another key and unknown formats', () => {
  const encrypted = encryptSecret(url);
  const [version, iv, body] = encrypted.split('.') as [string, string, string];
  const flipped = Buffer.from(body, 'base64url');
  flipped[0] = flipped[0]! ^ 1;
  expect(() => decryptSecret(`${version}.${iv}.${flipped.toString('base64url')}`)).toThrow();
  expect(() => decryptSecret(`v2.${iv}.${body}`)).toThrow();
  expect(() => decryptSecret(`${version}.${iv}`)).toThrow();
  expect(() => decryptSecret(`${version}.${iv}.${body}.x`)).toThrow();
  expect(() => decryptSecret(`${version}.${iv}.AAAA`)).toThrow();

  process.env.PAYMENT_SECRETS_KEY = randomBytes(32).toString('base64');
  expect(() => decryptSecret(encrypted)).toThrow();
});

test('needs the key', () => {
  delete process.env.PAYMENT_SECRETS_KEY;
  expect(paymentsConfigured()).toBe(false);
  expect(() => encryptSecret(url)).toThrow('PAYMENT_SECRETS_KEY is not set');
});
