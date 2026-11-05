import { expect, test } from 'bun:test';
import fc from 'fast-check';
import { planImport, versionNumber, type ImportPlan, type SourceEntry } from '@music-hub/shared';

const MB = 1_000_000;
let day = 0;
const file = (path: string, size = 40 * MB): SourceEntry => ({ path, size, modified: new Date(Date.UTC(2026, 0, 1 + day++)).toISOString() });

// What the preview shows: project → track → kind and name of each item
function outline(plan: ImportPlan, entries: SourceEntry[]) {
  const result: Record<string, Record<string, string[]>> = {};
  for (const item of plan.items) {
    const project = item.project === null ? '(unassigned)' : plan.projects[item.project].name;
    const track = item.track === null ? '(files)' : plan.tracks[item.track].name;
    result[project] ??= {};
    result[project][track] ??= [];
    result[project][track].push(`${item.kind}: ${entries[item.entry].path.split('/').at(-1)}`);
  }
  return result;
}

test('a song folder with a session: bounces are versions in order, stems are stems, the session comes along', () => {
  day = 0;
  const entries = [
    file('Kunde Nord/Album 2026/Kreise/Kreise.als', 200_000),
    file('Kunde Nord/Album 2026/Kreise/Bounces/Kreise v2.wav'),
    file('Kunde Nord/Album 2026/Kreise/Bounces/Kreise v1.wav'),
    file('Kunde Nord/Album 2026/Kreise/Stems/Kick.wav'),
    file('Kunde Nord/Album 2026/Kreise/Stems/Bass.wav'),
    file('Kunde Nord/Album 2026/Kreise/Backup/Kreise [2026-01-02].als', 200_000),
    file('Kunde Nord/Album 2026/Kreise/Ableton Project Info/AProject.ico', 10_000),
    file('Kunde Nord/Album 2026/Kreise/Samples/Recorded/Take 1.wav', 12 * MB),
    file('Kunde Nord/Album 2026/.DS_Store', 6_000),
  ];
  const plan = planImport(entries, 'Kunde Nord');
  expect(outline(plan, entries)).toEqual({
    'Album 2026': {
      Kreise: ['version: Kreise v1.wav', 'version: Kreise v2.wav', 'stem: Bass.wav', 'stem: Kick.wav', 'file: Kreise.als', 'skip: Take 1.wav'],
    },
  });
  expect(plan.ignored.sort()).toEqual([5, 6, 8]);
});

test('a Logic package marks its folder as a song and stays in Dropbox', () => {
  const entries = [
    file('Nachtbus/Nachtbus.logicx/Alternatives/000/ProjectData', 3 * MB),
    file('Nachtbus/Nachtbus.logicx/Resources/ProjectInformation.plist', 1_000),
    file('Nachtbus/Bounces/Nachtbus Mix 1.wav'),
    file('Nachtbus/Bounces/Nachtbus Mix 2.wav'),
  ];
  const plan = planImport(entries, 'Produktionen');
  expect(outline(plan, entries)).toEqual({ Produktionen: { Nachtbus: ['version: Nachtbus Mix 1.wav', 'version: Nachtbus Mix 2.wav'] } });
  expect(plan.ignored).toEqual([0, 1]);
});

test('equally large files next to the session are stems, a mix among them stays the version', () => {
  const entries = [
    file('Ebbe/Ebbe.ptx', 500_000),
    file('Ebbe/Ebbe Master.wav', 52 * MB),
    file('Ebbe/Ebbe_Drums.wav', 52 * MB),
    file('Ebbe/Ebbe_Bass.wav', 52 * MB),
    file('Ebbe/Ebbe_Vox.wav', 52 * MB + 2_000),
  ];
  const plan = planImport(entries, 'Ebbe');
  expect(outline(plan, entries)).toEqual({
    Ebbe: { Ebbe: ['version: Ebbe Master.wav', 'stem: Ebbe_Bass.wav', 'stem: Ebbe_Drums.wav', 'stem: Ebbe_Vox.wav', 'file: Ebbe.ptx'] },
  });
});

test('loose mixes become songs by their names, the folder above generic names is the project', () => {
  day = 0;
  const entries = [
    file('Album/Mixes/Kreise v1.wav'),
    file('Album/Mixes/Kreise v2.wav'),
    file('Album/Mixes/Letzte Bahn Mix 3.mp3', 8 * MB),
    file('Album/Mixes/Letzte Bahn Mix 1.mp3', 8 * MB),
    file('Album/Mixes/Hupe.wav', 300_000),
    file('Album/Cover.jpg', 2 * MB),
  ];
  const plan = planImport(entries, 'Album');
  expect(outline(plan, entries)).toEqual({
    Album: {
      Kreise: ['version: Kreise v1.wav', 'version: Kreise v2.wav'],
      'Letzte Bahn': ['version: Letzte Bahn Mix 1.mp3', 'version: Letzte Bahn Mix 3.mp3'],
    },
    '(unassigned)': { '(files)': ['skip: Cover.jpg', 'skip: Hupe.wav'] },
  });
});

test('a folder with one song only is that song, loose stems and the mix of one song meet in one track', () => {
  const entries = [
    file('EP/Sommer/Sommer Rough.wav'),
    file('EP/Sommer/Sommer Final.wav'),
    file('EP/Winter_Kick.wav', 30 * MB),
    file('EP/Winter_Bass.wav', 30 * MB),
    file('EP/Winter Mix.wav', 31 * MB),
  ];
  const plan = planImport(entries, 'EP');
  expect(outline(plan, entries)).toEqual({
    EP: {
      Sommer: ['version: Sommer Rough.wav', 'version: Sommer Final.wav'],
      Winter: ['version: Winter Mix.wav', 'stem: Winter_Kick.wav', 'stem: Winter_Bass.wav'],
    },
  });
});

test('versions without numbers go by date, with numbers by number, dates in names count as numbers', () => {
  expect(versionNumber('Kreise v12.wav')).toBe(12);
  expect(versionNumber('Kreise (Mix 3).wav')).toBe(3);
  expect(versionNumber('Kreise_241103.wav')).toBe(241103);
  expect(versionNumber('Kreise Final.wav')).toBeNull();
});

test('files the bucket does not take are left out', () => {
  const plan = planImport([file('Song/Song.als', 1_000), file('Song/Bounces/Song.wav', 600 * MB)], 'Song');
  expect(plan.items.find((item) => item.entry === 1)?.kind).toBe('skip');
});

test('every entry is either planned once or ignored, and every index points somewhere', () => {
  const name = fc.constantFrom('Kreise', 'Stems', 'Bounces', 'Mixes', 'Songs', 'Backup', 'Kick', 'Mix 2', 'v3', 'Song.logicx', '.git');
  const ext = fc.constantFrom('.wav', '.mp3', '.als', '.pdf', '.aif', '');
  const entry = fc.record({
    path: fc.tuple(fc.array(name, { minLength: 0, maxLength: 4 }), name, ext).map(([dirs, base, e]) => [...dirs, base + e].join('/')),
    size: fc.integer({ min: 0, max: 700 * MB }),
    modified: fc.date({ min: new Date(2020, 0, 1), max: new Date(2030, 0, 1), noInvalidDate: true }).map((d) => d.toISOString()),
  });
  fc.assert(
    fc.property(fc.uniqueArray(entry, { selector: (e) => e.path, maxLength: 40 }), (entries) => {
      const plan = planImport(entries, 'Root');
      const seen = [...plan.items.map((item) => item.entry), ...plan.ignored].sort((a, b) => a - b);
      expect(seen).toEqual(entries.map((_, i) => i));
      for (const item of plan.items) {
        if (item.track !== null) expect(plan.tracks[item.track].project).toBe(item.project!);
        if (item.project !== null) expect(plan.projects[item.project]).toBeDefined();
        if (item.kind === 'version' || item.kind === 'stem') expect(item.track).not.toBeNull();
      }
    }),
  );
});

test('several sessions side by side make no song, their bounces are sorted by name', () => {
  const entries = [
    file('Logic/Kreise.logicx/Alternatives/000/ProjectData', 3 * MB),
    file('Logic/Sommer.logicx/Alternatives/000/ProjectData', 3 * MB),
    file('Logic/Bounces/Kreise v1.wav'),
    file('Logic/Bounces/Sommer v1.wav', 41 * MB),
  ];
  expect(outline(planImport(entries, 'Musik'), entries)).toEqual({
    Logic: { Kreise: ['version: Kreise v1.wav'], Sommer: ['version: Sommer v1.wav'] },
  });
});

test('a stray session at the top does not swallow the folders below it', () => {
  const entries = [file('alt.als', 100_000), file('Demos/Kreise v1.wav'), file('Demos/Kreise v2.wav', 41 * MB)];
  const plan = outline(planImport(entries, 'Studio'), entries);
  expect(plan.Demos).toEqual({ Kreise: ['version: Kreise v1.wav', 'version: Kreise v2.wav'] });
});

test('alternate mixes in Bounced Files stay versions, samples and caches stay in Dropbox', () => {
  const entries = [
    file('Kreise/Kreise.ptx', 500_000),
    file('Kreise/Bounced Files/Kreise.wav', 50 * MB),
    file('Kreise/Bounced Files/Kreise Instrumental.wav', 50 * MB),
    file('Kreise/Bounced Files/Kreise Acapella.wav', 50 * MB),
    file('Kreise/Audio Files/Vox_01.wav', 50 * MB),
    file('Kreise/Audio Files/Vox_02.wav', 50 * MB),
    file('Kreise/Audio Files/Vox_03.wav', 50 * MB),
    file('Kreise/Samples/Imported/Kick 1.wav', 80_000),
    file('Kreise/Samples/Imported/Kick 1.wav.asd', 4_000),
    file('Kreise/WaveCache.wfm', 90_000),
    file('Kreise/Lyrics.pdf', 30_000),
  ];
  const plan = outline(planImport(entries, 'Kreise'), entries);
  expect(plan.Kreise.Kreise.filter((line) => !line.startsWith('skip'))).toEqual([
    'version: Kreise.wav', 'version: Kreise Instrumental.wav', 'version: Kreise Acapella.wav', 'file: Kreise.ptx', 'file: Lyrics.pdf',
  ]);
});

test('a Stems folder is the stems of the folder above, unless it holds several songs', () => {
  const one = [file('EP/Kreise/Kreise Mix.wav'), file('EP/Kreise/Stems/Kick.wav'), file('EP/Kreise/Stems/Bass.wav')];
  expect(outline(planImport(one, 'EP'), one)).toEqual({ EP: { Kreise: ['version: Kreise Mix.wav', 'stem: Kick.wav', 'stem: Bass.wav'] } });
  const two = [
    file('Album/Stems/Kreise_Kick.wav', 40 * MB), file('Album/Stems/Kreise_Bass.wav', 40 * MB),
    file('Album/Stems/Sommer_Kick.wav', 30 * MB), file('Album/Stems/Sommer_Bass.wav', 30 * MB),
  ];
  expect(Object.keys(outline(planImport(two, 'Album'), two).Album)).toEqual(['Kreise', 'Sommer']);
});
