import { expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import fc from 'fast-check';
import { liveSetFile, liveSetXml, probeAudio, type LiveSetClip } from './lib/ableton.js';

type Node = { tag: string; attrs: Record<string, string>; kids: Node[] };

// Enough of an XML parser for the checks: fails on unbalanced tags
function parse(xml: string): Node {
  const root: Node = { tag: '#root', attrs: {}, kids: [] };
  const stack = [root];
  for (const [, close, tag, rest, selfClosing] of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([\w.]+)([^>]*?)(\/?)>/g)) {
    if (close) {
      const open = stack.pop();
      if (open?.tag !== tag) throw new Error(`</${tag}> closes <${open?.tag}>`);
      continue;
    }
    const node: Node = { tag: tag!, attrs: Object.fromEntries([...rest!.matchAll(/([\w.]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])), kids: [] };
    stack.at(-1)!.kids.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`<${stack.at(-1)!.tag}> is never closed`);
  return root.kids[0]!;
}

const walk = (node: Node): Node[] => [node, ...node.kids.flatMap(walk)];
const find = (node: Node, path: string): Node | undefined =>
  path.split('/').reduce<Node | undefined>((at, tag) => at?.kids.find((k) => k.tag === tag), node);

// What Live checks before it opens a set (the gates of als-generator's check_als.py)
function expectLoadable(xml: string) {
  const root = parse(xml);
  const nodes = walk(root);
  const pointee = (tag: string) => tag === 'Pointee' || tag === 'AutomationTarget' || tag.endsWith('ModulationTarget');
  const ids = nodes.filter((n) => pointee(n.tag) && n.attrs.Id !== undefined).map((n) => Number(n.attrs.Id));
  expect(new Set(ids).size).toBe(ids.length);

  const highest = Math.max(
    ...nodes.flatMap((n) => [n.attrs.Id, n.tag === 'PointeeId' ? n.attrs.Value : undefined]).filter((v) => v !== undefined).map(Number),
  );
  expect(Number(find(root, 'LiveSet/NextPointeeId')!.attrs.Value)).toBeGreaterThan(highest);

  const lists = ['Devices', 'Tracks', 'Envelopes', 'Events', 'ClipSlotList', 'Scenes', 'WarpMarkers', 'TimeSignatures', 'Sends', 'SendsPre'];
  for (const n of nodes) {
    const members = n.kids.filter((k) => k.tag !== n.tag);
    if (lists.includes(n.tag) || (n.tag === 'Locators' && members[0]?.tag === 'Locator')) {
      for (const k of members) expect(k.attrs.Id, `<${k.tag}> in <${n.tag}>`).toBeDefined();
    }
  }
  const pointeeIds = new Set(ids.map(String));
  for (const ref of nodes.filter((n) => n.tag === 'PointeeId')) expect(pointeeIds.has(ref.attrs.Value!)).toBe(true);
  const scenes = find(root, 'LiveSet/Scenes')!.kids.length;
  for (const track of find(root, 'LiveSet/Tracks')!.kids) {
    expect(find(track, 'DeviceChain/MainSequencer/ClipSlotList')!.kids.length).toBe(scenes);
  }
  return root;
}

const clip = (name: string, frames: number, sampleRate = 48000): LiveSetClip => ({
  name,
  path: `Samples/Imported/${name}.wav`,
  size: frames * 6 + 44,
  crc: 0x1234abcd,
  info: { frames, sampleRate },
});

function wav(frames: number, sampleRate: number, channels: number, bits: number, extra = 0) {
  const blockAlign = (channels * bits) / 8;
  const head = new Uint8Array(12 + 24 + (extra ? 8 + extra : 0) + 8);
  const view = new DataView(head.buffer);
  head.set(new TextEncoder().encode('RIFF'), 0);
  head.set(new TextEncoder().encode('WAVE'), 8);
  head.set(new TextEncoder().encode('fmt '), 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  let pos = 36;
  if (extra) {
    head.set(new TextEncoder().encode('bext'), pos);
    view.setUint32(pos + 4, extra, true);
    pos += 8 + extra;
  }
  head.set(new TextEncoder().encode('data'), pos);
  view.setUint32(pos + 4, frames * blockAlign, true);
  return { head, size: head.length + frames * blockAlign };
}

test('a set with stems, tempo and locators passes the checks Live makes on opening', () => {
  const xml = liveSetXml({
    tempo: 92.5,
    clips: [clip('Bass', 480000), clip('Drums & "Perc" <1>', 480000), clip('Vox', 441000, 44100)],
    locators: [
      { seconds: 12, name: 'Lea: Kick lauter' },
      { seconds: 30.5, name: 'Kai: <Break>' },
    ],
  });
  const root = expectLoadable(xml);
  const tracks = find(root, 'LiveSet/Tracks')!.kids;
  expect(tracks.map((t) => find(t, 'Name/EffectiveName')!.attrs.Value)).toEqual(['Bass', 'Drums &amp; &quot;Perc&quot; &lt;1&gt;', 'Vox']);
  expect(find(root, 'LiveSet/MainTrack/DeviceChain/Mixer/Tempo/Manual')!.attrs.Value).toBe('92.5');

  // 10 s at 92.5 BPM are 15.4166… beats in the arrangement, the clip itself counts in seconds
  const bass = find(tracks[0]!, 'DeviceChain/MainSequencer/Sample/ArrangerAutomation/Events/AudioClip')!;
  expect(Number(find(bass, 'CurrentEnd')!.attrs.Value)).toBeCloseTo((10 * 92.5) / 60, 9);
  expect(find(bass, 'Loop/LoopEnd')!.attrs.Value).toBe('10');
  expect(find(bass, 'IsWarped')!.attrs.Value).toBe('false');
  expect(find(bass, 'SampleRef/FileRef/RelativePath')!.attrs.Value).toBe('Samples/Imported/Bass.wav');
  expect(find(bass, 'SampleRef/FileRef/OriginalCrc')!.attrs.Value).toBe(String(0xabcd));
  expect(find(bass, 'SampleRef/DefaultDuration')!.attrs.Value).toBe('480000');

  const locators = find(root, 'LiveSet/Locators/Locators')!.kids;
  expect(locators.map((l) => [find(l, 'Time')!.attrs.Value, find(l, 'Name')!.attrs.Value])).toEqual([
    [String((12 * 92.5) / 60), 'Lea: Kick lauter'],
    [String(Number(((30.5 * 92.5) / 60).toPrecision(12))), 'Kai: &lt;Break&gt;'],
  ]);
});

test('a set without locators and with many stems still has unique ids', () => {
  const clips = Array.from({ length: 40 }, (_, i) => clip(`Spur ${i}`, 1000 + i));
  const root = expectLoadable(liveSetXml({ tempo: 120, clips, locators: [] }));
  expect(find(root, 'LiveSet/Locators/Locators')!.kids).toEqual([]);
});

test('the file is the gzipped set', () => {
  const file = liveSetFile({ tempo: 120, clips: [clip('Bass', 1000)], locators: [] });
  expect(new TextDecoder().decode(gunzipSync(file))).toStartWith('<?xml version="1.0" encoding="UTF-8"?><Ableton ');
});

test('WAV length comes from the data chunk, also behind other chunks', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 50_000_000 }),
      fc.constantFrom(44100, 48000, 88200, 96000, 192000),
      fc.integer({ min: 1, max: 8 }),
      fc.constantFrom(16, 24, 32),
      fc.integer({ min: 0, max: 4000 }).map((n) => n * 2),
      (frames, sampleRate, channels, bits, extra) => {
        const { head, size } = wav(frames, sampleRate, channels, bits, extra);
        expect(probeAudio(head, size)).toEqual({ frames, sampleRate });
      },
    ),
  );
});

test('a WAV with an open data size runs to the end of the file', () => {
  const { head, size } = wav(1000, 48000, 2, 24);
  new DataView(head.buffer).setUint32(head.length - 4, 0xffffffff, true);
  expect(probeAudio(head, size)).toEqual({ frames: 1000, sampleRate: 48000 });
});

test('AIFF, FLAC and MP3 tell their length too', () => {
  const aiff = new Uint8Array(12 + 8 + 18);
  const a = new DataView(aiff.buffer);
  aiff.set(new TextEncoder().encode('FORM'), 0);
  aiff.set(new TextEncoder().encode('AIFF'), 8);
  aiff.set(new TextEncoder().encode('COMM'), 12);
  a.setUint32(16, 18);
  a.setUint16(20, 2);
  a.setUint32(22, 123456);
  a.setUint16(26, 24);
  // 44100 as 80-bit extended: exponent 16383 + 15, mantissa 44100 << 48
  a.setUint16(28, 16383 + 15);
  a.setUint32(30, 44100 * 2 ** 16);
  expect(probeAudio(aiff, 1_000_000)).toEqual({ frames: 123456, sampleRate: 44100 });

  const flac = new Uint8Array(4 + 4 + 34);
  flac.set(new TextEncoder().encode('fLaC'), 0);
  flac[4] = 0x80;
  // 48000 Hz (20 bits), stereo, 24 bit, 5,000,000,000 samples (36 bits)
  const total = 5_000_000_000;
  flac[18] = (48000 >> 12) & 0xff;
  flac[19] = (48000 >> 4) & 0xff;
  flac[20] = ((48000 & 0x0f) << 4) | (1 << 1) | 0;
  flac[21] = (23 << 4) | Math.floor(total / 2 ** 32);
  new DataView(flac.buffer).setUint32(22, total % 2 ** 32);
  expect(probeAudio(flac, 1_000_000)).toEqual({ frames: total, sampleRate: 48000 });

  // MPEG-1 layer III, 128 kbit/s, 44.1 kHz, stereo, behind a 100-byte ID3 tag, with a Xing header of 500 frames
  const mp3 = new Uint8Array(10 + 100 + 4 + 32 + 12);
  mp3.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 100], 0);
  mp3.set([0xff, 0xfb, 0x90, 0x00], 110);
  mp3.set(new TextEncoder().encode('Xing'), 146);
  new DataView(mp3.buffer).setUint32(150, 1);
  new DataView(mp3.buffer).setUint32(154, 500);
  expect(probeAudio(mp3, 1_000_000)).toEqual({ frames: 500 * 1152, sampleRate: 44100 });
  // Without the header the bitrate gives the length: 160,000 bytes at 128 kbit/s are 10 s
  mp3.fill(0, 146);
  expect(probeAudio(mp3, 110 + 160_000)).toEqual({ frames: 441000, sampleRate: 44100 });

  expect(probeAudio(new TextEncoder().encode('not audio at all'), 16)).toBeNull();
});
