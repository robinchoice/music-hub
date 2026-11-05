// What a folder from Dropbox becomes in Music Hub, decided from paths, sizes and dates alone, by fixed
// rules without an LLM, so customer data stays with us. The preview shows the plan and lets people
// rename and resort before anything is imported.
//
// - A folder with a DAW session (.als, .ptx, .cpr, .flp, a .logicx package …) is one song.
// - In a song, audio under Bounces/Mixes/Masters … and next to the session are its versions,
//   audio under Stems/ its stems, and equally large files of one format are stems too: a DAW
//   exports all stems of a song from the same start to the same end.
// - Mixes outside a song folder become songs by their name: "Kreise v1" and "Kreise Mix 2" are two
//   versions of "Kreise".
// - The folder above the songs is the project; generic names like "Mixes" or "Songs" are skipped.
// - What fits nowhere is listed as unassigned and not imported unless someone picks it.

import { SUPPORTED_EXTENSIONS, MAX_FILE_SIZE } from './constants/audio.js';
import { baseName, commonName, MIX_NAME, withoutMixName } from './upload-plan.js';

export type SourceEntry = {
  // Relative to the chosen folder, with '/' between folders
  path: string;
  size: number;
  // ISO date of the last change
  modified: string;
};

export const IMPORT_KINDS = ['version', 'stem', 'file', 'skip'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export type PlannedItem = {
  // Index into the entries
  entry: number;
  kind: ImportKind;
  // Index into tracks; null for files of the project and for what fits nowhere
  track: number | null;
  // Index into projects; null for what fits nowhere
  project: number | null;
  // Label of the version or name of the stem
  name: string;
};

export type ImportPlan = {
  projects: { name: string }[];
  tracks: { name: string; project: number }[];
  // In the order they are imported: versions of a track get their numbers in this order
  items: PlannedItem[];
  // Entries left out without asking: system files and the insides of DAW projects
  ignored: number[];
};

const DAW_FILE = /\.(als|ptx|ptf|cpr|flp|rpp|song|bwproject|npr|aup3|dawproject)$/i;
const DAW_PACKAGE = /\.(logicx|band)$/i;
const LOSSLESS = /\.(wav|aiff?|aifc|flac)$/i;
const LOSSY = /\.(mp3|m4a|aac|ogg|opus)$/i;
// Folders of a song whose audio is a version
const MIX_DIR = /^(bounces?|bounced files|mix(es|downs?)?|masters?|mastering|exports?|renders?|versions?|versionen|final)$/i;
const STEM_DIR = /^(stems?|spuren|multitracks?|track ?outs?|stem exports?)$/i;
// Above the songs: these are no project names
const GENERIC_DIR = /^(songs?|tracks?|projekte?|projects?|sessions?|mix(es)?|bounces?|masters?|exports?|stems?|audio|music|musik|dropbox|produktionen|productions?)$/i;
// Insides of a DAW project that nobody imports: backups and caches
const DAW_INTERNAL = /^(backup|backups|ableton project info|session file backups|freeze files|undo|wavecache files|plugin settings|alternatives|resources)$/i;
const SYSTEM_FILE = /^(\..*|icon\r?|desktop\.ini|thumbs\.db|__macosx)$/i;
// Folders of a DAW project, besides Bounces and Stems: what is below them still belongs to the song
const IN_SONG = /^(bounces?|bounced files|mix(es|downs?)?|masters?|mastering|exports?|renders?|versions?|versionen|final|stems?|spuren|multitracks?|track ?outs?|stem exports?|audio files|audio|samples|recorded|recordings|imported|processed|media|takes|midi files|video files|clip fades|rendered files|fade files|freeze files|backup|backups|ableton project info|session file backups|undo|wavecache files|plugin settings|images|edits)$/i;
// Files besides sessions that come along with a song; caches like .asd or .reapeaks stay out
const DOCUMENT = /\.(pdf|txt|rtf|md|docx?|pages|jpe?g|png|mid|midi)$/i;

const segments = (path: string) => path.split('/').filter(Boolean);
const fileName = (path: string) => segments(path).at(-1) ?? path;
const folderOf = (path: string) => segments(path).slice(0, -1).join('/');
const extension = (path: string) => /\.[^./]+$/.exec(path)?.[0].toLowerCase() ?? '';

export const isVersionable = (path: string) => (SUPPORTED_EXTENSIONS as readonly string[]).includes(extension(path));
const isAudio = (path: string) => LOSSLESS.test(path) || LOSSY.test(path);
// Without reading the file the length is unknown; small files are sounds, not songs
// (30 s are about 5 MB as WAV and 0.5 MB as MP3).
const songSized = (path: string, size: number) => size >= (LOSSY.test(path) ? 500_000 : 5_000_000);

// A number in the name that orders versions: "v3", "Mix 2", "Version 4", "_241103" (a date)
export function versionNumber(name: string): number | null {
  const base = baseName(name);
  const match = /(?:^|[\s_\-–.(])(?:v|version\s*|mix\s*|master\s*|bounce\s*)(\d+)\)?$/i.exec(base) ?? /[_\-\s](\d{6}|\d{8})$/.exec(base);
  return match ? Number(match[1]) : null;
}

// Equally large files of one format, within a few kilobytes for differing headers
function sizeClusters(entries: SourceEntry[], indexes: number[]): number[][] {
  const sorted = [...indexes].sort((a, b) => entries[a].size - entries[b].size);
  const clusters: number[][] = [];
  for (const i of sorted) {
    const last = clusters.at(-1);
    const first = last ? entries[last[0]] : null;
    if (last && first && extension(first.path) === extension(entries[i].path) && entries[i].size - first.size <= Math.max(16_384, first.size * 0.001)) {
      last.push(i);
    } else clusters.push([i]);
  }
  return clusters.filter((c) => c.length >= 2).map((c) => c.sort((a, b) => a - b));
}

function orderVersions(entries: SourceEntry[], indexes: number[]): number[] {
  const numbers = indexes.map((i) => versionNumber(fileName(entries[i].path)));
  const byDate = (a: number, b: number) => entries[a].modified.localeCompare(entries[b].modified) || a - b;
  if (numbers.every((n) => n !== null)) {
    const numberOf = new Map(indexes.map((i, k) => [i, numbers[k]!]));
    return [...indexes].sort((a, b) => numberOf.get(a)! - numberOf.get(b)! || byDate(a, b));
  }
  return [...indexes].sort(byDate);
}

// "Kreise Project" → "Kreise", "Kreise.logicx" → "Kreise"
const songName = (folder: string) => folder.replace(DAW_PACKAGE, '').replace(/\s+project$/i, '').trim() || folder;

export function planImport(entries: SourceEntry[], rootName: string): ImportPlan {
  const plan: ImportPlan = { projects: [], tracks: [], items: [], ignored: [] };
  const projectIndex = new Map<string, number>();

  // The project of a folder: itself or the nearest folder above without a generic name, at most the chosen folder
  const projectFor = (folder: string) => {
    let parts = segments(folder);
    while (parts.length > 0 && GENERIC_DIR.test(parts.at(-1)!)) parts = parts.slice(0, -1);
    const key = parts.join('/');
    let index = projectIndex.get(key);
    if (index === undefined) {
      index = plan.projects.push({ name: parts.at(-1) ?? rootName }) - 1;
      projectIndex.set(key, index);
    }
    return index;
  };
  const addTrack = (name: string, project: number) => plan.tracks.push({ name, project }) - 1;
  const add = (entry: number, kind: ImportKind, track: number | null, project: number | null) =>
    plan.items.push({ entry, kind, track, project, name: baseName(fileName(entries[entry].path)) });

  // Folders with the session of one song are songs. Several sessions of different songs side by side (Logic's
  // default folder, an FL Studio "Projects" folder) make no song: their bounces are sorted by name below.
  const sessions = new Map<string, Set<string>>();
  const live: number[] = [];
  const addSession = (folder: string, name: string) => {
    const names = sessions.get(folder) ?? new Set<string>();
    names.add(withoutMixName(songName(name)) || songName(name).toLowerCase());
    sessions.set(folder, names);
  };
  entries.forEach((entry, i) => {
    const parts = segments(entry.path);
    if (parts.some((p) => SYSTEM_FILE.test(p))) return plan.ignored.push(i);
    const pkg = parts.findIndex((p) => DAW_PACKAGE.test(p));
    if (pkg >= 0 && pkg < parts.length - 1) {
      // The package itself is a session; what is inside stays in Dropbox
      addSession(parts.slice(0, pkg).join('/'), parts[pkg]);
      return plan.ignored.push(i);
    }
    // Backups of a session don't count
    if (DAW_FILE.test(entry.path) && !parts.slice(0, -1).some((p) => DAW_INTERNAL.test(p))) addSession(folderOf(entry.path), baseName(parts.at(-1)!));
    live.push(i);
  });
  const songFolders = new Set([...sessions].filter(([, names]) => names.size === 1).map(([folder]) => folder));

  // Each file belongs to the deepest song folder above it, if it sits right in it or below one of the song's
  // own folders (Bounces, Stems, Audio Files …). A song folder at the top does not take in unrelated folders.
  const songOf = (path: string) => {
    const parts = segments(path).slice(0, -1);
    for (let k = parts.length; k >= 0; k--) {
      const folder = parts.slice(0, k).join('/');
      if (songFolders.has(folder)) return k === parts.length || IN_SONG.test(parts[k]) ? folder : null;
    }
    return null;
  };

  const bySong = new Map<string, number[]>();
  const looseByFolder = new Map<string, number[]>();
  for (const i of live) {
    const song = songOf(entries[i].path);
    if (song !== null) {
      const below = segments(entries[i].path).slice(segments(song).length, -1);
      if (below.some((p) => DAW_INTERNAL.test(p))) {
        plan.ignored.push(i);
        continue;
      }
      bySong.set(song, [...(bySong.get(song) ?? []), i]);
    } else {
      const folder = folderOf(entries[i].path);
      looseByFolder.set(folder, [...(looseByFolder.get(folder) ?? []), i]);
    }
  }

  // One track per project and song name, so a song's mixes and its Stems folder meet
  const trackIndex = new Map<string, number>();
  const trackFor = (name: string, project: number) => {
    const key = `${project}|${name.toLowerCase()}`;
    let index = trackIndex.get(key);
    if (index === undefined) {
      index = addTrack(name, project);
      trackIndex.set(key, index);
    }
    return index;
  };
  const mixNamed = (i: number) => MIX_NAME.test(baseName(fileName(entries[i].path)).trim());

  for (const [folder, members] of [...bySong].sort(([a], [b]) => a.localeCompare(b))) {
    const parts = segments(folder);
    const project = projectFor(parts.slice(0, -1).join('/'));
    const track = trackFor(songName(parts.at(-1) ?? rootName), project);
    const placeOf = (i: number) => segments(entries[i].path).slice(parts.length, -1);
    const stems: number[] = [];
    const candidates: number[] = [];
    const rest: number[] = [];
    for (const i of members) {
      const path = entries[i].path;
      const place = placeOf(i);
      if (!isAudio(path)) rest.push(i);
      else if (place.some((p) => STEM_DIR.test(p))) stems.push(i);
      else if ((place.length === 0 || place.some((p) => MIX_DIR.test(p))) && isVersionable(path) && songSized(path, entries[i].size)) {
        candidates.push(i);
      } else rest.push(i);
    }
    // Three or more equally large files right next to the session, not named like a mix, are stems bounced there.
    // Alternate mixes in a Bounces folder (instrumental, a cappella, TV) are as long as each other and stay versions.
    const nextToSession = candidates.filter((i) => placeOf(i).length === 0 && !mixNamed(i));
    for (const cluster of sizeClusters(entries, nextToSession)) if (cluster.length >= 3) stems.push(...cluster);
    const isStem = new Set(stems);
    for (const i of orderVersions(entries, candidates.filter((i) => !isStem.has(i)))) add(i, 'version', track, project);
    for (const i of stems.sort((a, b) => entries[a].path.localeCompare(entries[b].path))) add(i, 'stem', track, project);
    for (const i of rest.filter((i) => !isStem.has(i))) {
      const path = entries[i].path;
      // Sessions and notes come along as files of the song; recordings, samples and caches of the DAW stay in Dropbox
      add(i, DAW_FILE.test(path) || DOCUMENT.test(path) ? 'file' : 'skip', track, project);
    }
  }

  for (const [folder, members] of [...looseByFolder].sort(([a], [b]) => a.localeCompare(b))) {
    const parts = segments(folder);
    // A Stems folder without a session holds the stems of the folder above: "Kreise/Stems/Kick.wav"
    if (parts.length > 0 && STEM_DIR.test(parts.at(-1)!)) {
      const above = parts.slice(0, -1);
      const songFolder = above.length > 0 && !GENERIC_DIR.test(above.at(-1)!);
      const stems = members.filter((i) => isAudio(entries[i].path));
      // Stems of several songs in one folder ("Kreise_Kick", "Sommer_Kick") are sorted by name below instead
      const names = new Set(sizeClusters(entries, stems).map((c) => commonName(c.map((i) => fileName(entries[i].path))).toLowerCase()));
      if (songFolder && stems.length > 0 && (names.size < 2 || names.has(''))) {
        const project = projectFor(above.slice(0, -1).join('/'));
        const track = trackFor(above.at(-1)!, project);
        for (const i of stems) add(i, 'stem', track, project);
        for (const i of members) if (!stems.includes(i)) add(i, 'skip', null, null);
        continue;
      }
    }
    const songs = members.filter((i) => isVersionable(entries[i].path) && songSized(entries[i].path, entries[i].size));
    const stemClusters = sizeClusters(entries, songs.filter((i) => !mixNamed(i)));
    const inCluster = new Set(stemClusters.flat());
    const groups = new Map<string, number[]>();
    for (const i of songs) {
      if (inCluster.has(i)) continue;
      const key = withoutMixName(fileName(entries[i].path)) || baseName(fileName(entries[i].path)).toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
    // Stems and mixes of one song share a name: "Kreise_Kick" and "Kreise_Bass" are stems of "Kreise", like "Kreise Mix 2"
    const songsHere = new Map<string, { name: string; stems: number[]; versions: number[] }>();
    const songFor = (name: string) => {
      const key = name.toLowerCase();
      const song = songsHere.get(key) ?? { name, stems: [], versions: [] };
      songsHere.set(key, song);
      return song;
    };
    for (const cluster of stemClusters) songFor(commonName(cluster.map((i) => fileName(entries[i].path)))).stems.push(...cluster);
    for (const group of groups.values()) {
      const first = baseName(fileName(entries[group[0]].path)).trim();
      songFor(first.replace(MIX_NAME, '').replace(/[\s_\-–—.]+$/u, '').trim() || first).versions.push(...group);
    }
    // A folder that holds one song of its own name is that song's folder: "Sommer/Sommer Rough.wav"
    const only = songsHere.size === 1 ? [...songsHere.keys()][0] : null;
    const here = parts.at(-1)?.toLowerCase() ?? '';
    const oneSong = only !== null && only !== '' && here !== '' && (here.includes(only) || only.includes(here));
    const project = projectFor(oneSong ? parts.slice(0, -1).join('/') : folder);
    for (const [, song] of [...songsHere].sort(([a], [b]) => a.localeCompare(b))) {
      const track = trackFor(oneSong ? parts.at(-1)! : song.name || parts.at(-1) || rootName, project);
      for (const i of orderVersions(entries, song.versions)) add(i, 'version', track, project);
      for (const i of song.stems) add(i, 'stem', track, project);
    }
    for (const i of members) {
      if (inCluster.has(i) || songs.includes(i)) continue;
      add(i, 'skip', null, null);
    }
  }

  // Files the bucket does not take
  for (const item of plan.items) if (entries[item.entry].size > MAX_FILE_SIZE) item.kind = 'skip';
  return plan;
}

// The files an import brings in, for the preview's totals
export const importedSize = (plan: ImportPlan, entries: SourceEntry[]) =>
  plan.items.filter((item) => item.kind !== 'skip').reduce((sum, item) => sum + entries[item.entry].size, 0);
