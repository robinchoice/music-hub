import { expect, test } from 'bun:test';
import fc from 'fast-check';
import { songKey } from '@music-hub/shared';

test('working-title endings fall away, other words stay', () => {
  expect(songKey('Kreisel (neu)')).toBe('kreisel');
  expect(songKey('Kreisel – Demo 2')).toBe('kreisel');
  expect(songKey('kreisel_v3')).toBe('kreisel');
  expect(songKey('Nachtbus Mix 2 Final')).toBe('nachtbus');
  expect(songKey('Kreisel Instrumental')).toBe('kreisel instrumental');
  expect(songKey('Demo')).toBe('demo');
});

test('the key of a key is the key itself', () => {
  fc.assert(fc.property(fc.string(), (name) => songKey(songKey(name)) === songKey(name)));
});
