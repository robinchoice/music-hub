import { writable, get } from 'svelte/store';
import { api } from '$lib/api/client.js';
import { snapshotForTrack, resetPlayer } from '$lib/stores/player.js';

export type ListenState = {
  versionId: string | null;
  trackId: string | null;
  time: number;
  duration: number;
  playing: boolean;
};
type Playable = { id: string; trackId: string; duration: number | null };

const IDLE: ListenState = { versionId: null, trackId: null, time: 0, duration: 0, playing: false };

/** The single inline player behind all mini waveforms; only one version plays at a time */
export const listen = writable<ListenState>(IDLE);

// iOS only lets an element play from a user gesture, but the stream URL arrives after an await.
// Playing a few samples of silence on the same element within the click unlocks it.
const SILENCE = 'data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==';

let audio: HTMLAudioElement | null = null;
let seq = 0;

function element(): HTMLAudioElement {
  if (audio) return audio;
  const el = new Audio();
  // Events of the unlocking silence don't count
  const on = (type: string, fn: () => void) => el.addEventListener(type, () => el.src.startsWith('data:') || fn());
  on('timeupdate', () => listen.update((s) => ({ ...s, time: el.currentTime })));
  on('durationchange', () => {
    if (Number.isFinite(el.duration)) listen.update((s) => ({ ...s, duration: el.duration }));
  });
  on('play', () => listen.update((s) => ({ ...s, playing: true })));
  on('pause', () => listen.update((s) => ({ ...s, playing: false })));
  on('ended', () => listen.update((s) => ({ ...s, playing: false, time: 0 })));
  audio = el;
  return el;
}

/** Plays a version from `from` seconds, otherwise on from where it stands */
export async function playVersion(version: Playable, from?: number) {
  const el = element();
  if (get(listen).versionId === version.id && el.src && !el.src.startsWith('data:')) {
    if (from !== undefined) el.currentTime = from;
    await el.play().catch(() => {});
    return;
  }
  const mine = ++seq;
  el.src = SILENCE;
  el.play().catch(() => {});
  listen.set({ versionId: version.id, trackId: version.trackId, time: from ?? 0, duration: version.duration ?? 0, playing: true });
  try {
    const { url } = await api.get<{ url: string }>(`/versions/${version.id}/stream-url`);
    if (mine !== seq) return;
    el.src = url;
    if (from) el.addEventListener('loadedmetadata', () => (el.currentTime = from), { once: true });
    await el.play();
  } catch {
    if (mine === seq) listen.update((s) => ({ ...s, playing: false }));
  }
}

/** Play and pause button of a mini waveform */
export function toggleListen(version: Playable) {
  const s = get(listen);
  if (s.versionId === version.id && s.playing) {
    seq++;
    audio?.pause();
    listen.update((x) => ({ ...x, playing: false }));
  } else {
    void playVersion(version);
  }
}

/** A click into a waveform jumps there and plays */
export function seekListen(version: Playable, seconds: number) {
  void playVersion(version, seconds);
}

export function stopListen() {
  seq++;
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  listen.set(IDLE);
}

/** "Öffnen": the track page continues where the inline player stood; `at` opens at a comment instead */
export function handOff(trackId: string, at?: number | null) {
  const s = get(listen);
  if (at != null) snapshotForTrack(trackId, at, false);
  else if (s.trackId === trackId && s.versionId) snapshotForTrack(trackId, audio?.currentTime ?? s.time, s.playing);
  else resetPlayer();
  stopListen();
}
