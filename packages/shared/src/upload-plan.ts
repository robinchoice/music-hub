// What a batch of dropped files becomes, decided from their lengths, so nobody has to sort them by hand.
// A DAW exports all stems of a song with the same length: two or more audio files of equal length are
// the stems of one song. Anything else that is long enough is a mix of its own, short sounds and
// everything that is no audio become files of the project.

import { SUPPORTED_EXTENSIONS } from './constants/audio.js';

// Only real audio can become a stem: an audio type, or a file name a version accepts. application/octet-stream,
// which browsers send for DAW sessions and archives, is not enough.
export const isAudioFile = (fileName: string, mimeType: string) =>
  /^audio\//.test(mimeType) || SUPPORTED_EXTENSIONS.some((ext) => fileName.toLowerCase().endsWith(ext));

export type DroppedFile = {
  name: string;
  // Seconds, null when the browser could not read it
  duration: number | null;
  // The browser plays it, so it can be a stem
  audio: boolean;
  // A format a version accepts (WAV, MP3, FLAC, AIFF)
  versionable: boolean;
};

export type StemGroup = {
  // Indexes into the dropped files
  stems: number[];
  // A finished mix that came along with the stems ("… Mix.wav", "… Master.wav", the song's own name); it becomes the version
  mix: number | null;
  // Common start of the file names, the song they belong to
  name: string;
};

export type DropPlan = { groups: StemGroup[]; mixes: number[]; files: number[] };

// Equal length within this many seconds; MP3 padding and AIFF headers differ by a few milliseconds
export const STEM_LENGTH_TOLERANCE = 0.1;
// Shorter single files are sounds, not songs
export const SHORTEST_SONG = 60;
// Equally long files below this are loops or one-shots of a sample pack, not stems; a jingle's stems still count
export const SHORTEST_STEMS = 20;

// Names of finished mixes and versions: "Mix 3", "Master", "Bounce", "v2", "Version 4"
export const MIX_NAME = /(^|[\s_\-–.])((mix|mixdown|master|final|bounce|demo|rough|full)(\s*\d+)?|v\d+|version\s*\d+)$/i;

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
// "Letzte Bahn – Mix 3" → "letzte bahn"; what is left of a name without its mix or version ending
export const withoutMixName = (name: string) => baseName(name).trim().replace(MIX_NAME, '').replace(/[\s_\-–—.]+$/u, '').trim().toLowerCase();

// "Kreise_Kick", "Kreise_Bass" → "Kreise"; separators at the end go
export function commonName(names: string[]) {
  const bases = names.map(baseName);
  let prefix = bases[0] ?? '';
  for (const b of bases.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < b.length && prefix[i].toLowerCase() === b[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
  }
  // Cut back to a word boundary, so "Audio 1" and "Audio 12" don't leave "Audio 1"
  if (bases.some((b) => b.length > prefix.length && /[\p{L}\p{N}]/u.test(b[prefix.length] ?? '') && /[\p{L}\p{N}]$/u.test(prefix))) {
    prefix = prefix.replace(/[\p{L}\p{N}]+$/u, '');
  }
  return prefix.replace(/[\s_\-–—.]+$/u, '').trim();
}

export function planDrop(files: DroppedFile[]): DropPlan {
  const timed = files
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.audio && f.duration !== null && f.duration >= SHORTEST_STEMS)
    .sort((a, b) => a.f.duration! - b.f.duration!);

  const clusters: number[][] = [];
  for (const { f, i } of timed) {
    const last = clusters.at(-1);
    if (last && f.duration! - files[last[0]].duration! <= STEM_LENGTH_TOLERANCE) last.push(i);
    else clusters.push([i]);
  }

  const groups: StemGroup[] = [];
  const grouped = new Set<number>();
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    let members = [...cluster].sort((a, b) => a - b);
    const mixLike = (names: number[], name: string) => names.filter((i) => {
      const base = baseName(files[i].name).trim();
      return files[i].versionable && (MIX_NAME.test(base) || (name !== '' && base.toLowerCase() === name.toLowerCase()));
    });
    // Two bounces of the same arrangement are often equally long: several mixes of one song stay versions of their own.
    // "Kick v2" and "Snare v2" end the same way but name different things, so they stay stems.
    const several = mixLike(members, commonName(members.map((i) => files[i].name)));
    const oneSong = new Set(several.map((i) => withoutMixName(files[i].name))).size === 1;
    if (several.length >= 2 && oneSong) members = members.filter((i) => !several.includes(i));
    if (members.length < 2) continue;
    const name = commonName(members.map((i) => files[i].name));
    const candidates = mixLike(members, name);
    const mix = candidates.length === 1 ? candidates[0] : null;
    groups.push({ stems: members.filter((i) => i !== mix), mix, name });
    members.forEach((i) => grouped.add(i));
  }

  const mixes: number[] = [];
  const rest: number[] = [];
  files.forEach((f, i) => {
    if (grouped.has(i)) return;
    if (f.versionable && (f.duration === null || f.duration >= SHORTEST_SONG)) mixes.push(i);
    else rest.push(i);
  });
  return { groups, mixes, files: rest };
}
