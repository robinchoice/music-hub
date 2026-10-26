import { expect, test } from 'bun:test';
import { epcPayload, maskIban, normalizeIban, validIban } from './girocode.js';

test('normalizes and checks IBANs with mod 97', () => {
  expect(normalizeIban(' de89 3704 0044 0532 0130 00 ')).toBe('DE89370400440532013000');
  expect(validIban('DE89 3704 0044 0532 0130 00')).toBe(true);
  expect(validIban('GB82WEST12345698765432')).toBe(true);
  expect(validIban('AT611904300234573201')).toBe(true);
  // one digit off, swapped digits, wrong check digits
  expect(validIban('DE89370400440532013001')).toBe(false);
  expect(validIban('DE89370400440532010300')).toBe(false);
  expect(validIban('DE88370400440532013000')).toBe(false);
  expect(validIban('')).toBe(false);
  expect(validIban('DE89')).toBe(false);
  expect(validIban('1E89370400440532013000')).toBe(false);
  expect(validIban('DE89-3704-0044-0532-0130-00')).toBe(false);
});

test('masks all but the last four characters', () => {
  expect(maskIban('DE89 3704 0044 0532 0130 00')).toBe('•••• •••• •••• •••• 3000');
});

test('builds the EPC069-12 payload in order', () => {
  const payload = epcPayload({
    name: 'Studio Klanglabor',
    iban: 'de89 3704 0044 0532 0130 00',
    bic: 'cobadeffxxx',
    amountCents: 48000,
    remittance: 'MH-1a2b3c4d',
  });
  expect(payload.split('\n')).toEqual([
    'BCD',
    '002',
    '1',
    'SCT',
    'COBADEFFXXX',
    'Studio Klanglabor',
    'DE89370400440532013000',
    'EUR480.00',
    '',
    '',
    'MH-1a2b3c4d',
  ]);
  expect(epcPayload({ name: 'A', iban: 'DE89370400440532013000', bic: null, amountCents: 123456, remittance: 'x' }).split('\n')[4]).toBe('');
});

test('formats amounts with two decimals', () => {
  const amount = (amountCents: number) =>
    epcPayload({ name: 'A', iban: 'DE89370400440532013000', bic: null, amountCents, remittance: 'x' }).split('\n')[7];
  expect(amount(1)).toBe('EUR0.01');
  expect(amount(4005)).toBe('EUR40.05');
  expect(amount(123456)).toBe('EUR1234.56');
  expect(amount(99_999_999_999)).toBe('EUR999999999.99');
  expect(() => amount(0)).toThrow();
  expect(() => amount(12.5)).toThrow();
});

test('caps name and remittance and keeps line breaks out', () => {
  const lines = epcPayload({
    name: `Studio\n${'ä'.repeat(100)}`,
    iban: 'DE89370400440532013000',
    bic: null,
    amountCents: 100,
    remittance: `Album\r\n${'ü'.repeat(200)}`,
  }).split('\n');
  expect(lines).toHaveLength(11);
  expect(Array.from(lines[5]!)).toHaveLength(70);
  expect(lines[5]!.startsWith('Studio ä')).toBe(true);
  expect(Array.from(lines[10]!)).toHaveLength(140);
  expect(lines[10]!.startsWith('Album ü')).toBe(true);
});
