import { expect, test } from 'bun:test';
import fc from 'fast-check';
import { commonName, planDrop, SHORTEST_SONG, STEM_LENGTH_TOLERANCE, type DroppedFile } from '@music-hub/shared';

const wav = (name: string, duration: number | null): DroppedFile => ({ name, duration, audio: true, versionable: true });
const other = (name: string): DroppedFile => ({ name, duration: null, audio: false, versionable: false });

test('stems of equal length become one song, sounds and other files become files', () => {
  const plan = planDrop([
    wav('Kreise_Kick.wav', 221.3),
    wav('Kreise_Bass.wav', 221.3),
    wav('Kreise_Vox.wav', 221.32),
    other('Kreise.als'),
    wav('Vespa_Hupe.wav', 1.4),
    wav('Vespa_Leerlauf.wav', 6.4),
  ]);
  expect(plan).toEqual({ groups: [{ stems: [0, 1, 2], mix: null, name: 'Kreise' }], mixes: [], files: [3, 4, 5] });
});

test('a lone mix stays a mix, a bounce among its stems becomes the version', () => {
  expect(planDrop([wav('Letzte Bahn – Mix 3.wav', 200)])).toEqual({ groups: [], mixes: [0], files: [] });
  expect(planDrop([wav('Idee.wav', null)])).toEqual({ groups: [], mixes: [0], files: [] });
  const plan = planDrop([wav('Nachtbus Drums.wav', 180), wav('Nachtbus Mix.wav', 180), wav('Nachtbus Bass.wav', 180)]);
  expect(plan.groups).toEqual([{ stems: [0, 2], mix: 1, name: 'Nachtbus' }]);
  // Two bounces of the same arrangement are as long as each other and stay two versions
  expect(planDrop([wav('Letzte Bahn – Mix 2.wav', 200), wav('Letzte Bahn – Mix 3.wav', 200)])).toEqual({ groups: [], mixes: [0, 1], files: [] });
  expect(planDrop([wav('Kick.wav', 90), wav('Bass.wav', 90), wav('A Mix.wav', 90), wav('A v2.wav', 90)])).toEqual({
    groups: [{ stems: [0, 1], mix: null, name: '' }],
    mixes: [2, 3],
    files: [],
  });
});

test('loops of a sample pack and stems with a take number are no mixes', () => {
  expect(planDrop([wav('Loop A.wav', 8), wav('Loop B.wav', 8), wav('Loop C.wav', 8)])).toEqual({ groups: [], mixes: [], files: [0, 1, 2] });
  expect(planDrop([wav('Spot Kick.wav', 30), wav('Spot Voice.wav', 30)]).groups).toEqual([{ stems: [0, 1], mix: null, name: 'Spot' }]);
  expect(planDrop([wav('Song - Kick v2.wav', 200), wav('Song - Snare v2.wav', 200)])).toEqual({
    groups: [{ stems: [0, 1], mix: null, name: 'Song' }],
    mixes: [],
    files: [],
  });
});

test('the common name stops at a word', () => {
  expect(commonName(['Audio 1.wav', 'Audio 12.wav'])).toBe('Audio');
  expect(commonName(['Kreise_Kick.wav', 'Kreise_Bass.wav'])).toBe('Kreise');
  expect(commonName(['Kick.wav', 'Bass.wav'])).toBe('');
});

const file = fc.record({
  name: fc.string({ minLength: 1, maxLength: 12 }).map((s) => `${s}.wav`),
  duration: fc.option(fc.double({ min: 0, max: 600, noNaN: true }), { nil: null }),
  audio: fc.boolean(),
  versionable: fc.boolean(),
}).map((f) => ({ ...f, versionable: f.audio && f.versionable }));

test('every file lands in exactly one place, and stems of a group share their length', () => {
  fc.assert(
    fc.property(fc.array(file, { maxLength: 20 }), (files) => {
      const plan = planDrop(files);
      const placed = [...plan.groups.flatMap((g) => [...g.stems, ...(g.mix === null ? [] : [g.mix])]), ...plan.mixes, ...plan.files];
      expect([...placed].sort((a, b) => a - b)).toEqual(files.map((_, i) => i));
      for (const g of plan.groups) {
        const members = [...g.stems, ...(g.mix === null ? [] : [g.mix])];
        expect(members.length).toBeGreaterThanOrEqual(2);
        const lengths = members.map((i) => files[i].duration!);
        expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(STEM_LENGTH_TOLERANCE);
        expect(members.every((i) => files[i].audio)).toBe(true);
      }
      for (const i of plan.mixes) {
        expect(files[i].versionable).toBe(true);
        expect(files[i].duration === null || files[i].duration! >= SHORTEST_SONG).toBe(true);
      }
    }),
  );
});
