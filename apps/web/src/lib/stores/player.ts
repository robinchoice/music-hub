import { writable } from 'svelte/store';

type PlayerState = {
  trackId: string | null;
  currentTime: number;
  isPlaying: boolean;
};

export const playerState = writable<PlayerState>({
  trackId: null,
  currentTime: 0,
  isPlaying: false,
});

/**
 * Snapshot the current playhead before changing version (within the same track).
 */
export function snapshotForTrack(trackId: string, currentTime: number, isPlaying: boolean) {
  playerState.set({ trackId, currentTime, isPlaying });
}

/**
 * Get a continuation snapshot if we're staying within the same track.
 * Returns the previously snapshotted time + isPlaying, or null for a fresh start.
 */
export function continuationFor(trackId: string): { initialTime: number; autoPlay: boolean } | null {
  let snap: PlayerState | null = null;
  playerState.subscribe((s) => (snap = s))();
  if (!snap || (snap as PlayerState).trackId !== trackId) return null;
  const s = snap as PlayerState;
  return { initialTime: s.currentTime, autoPlay: s.isPlaying };
}

/**
 * Reset state — call when navigating away from a track entirely.
 */
export function resetPlayer() {
  playerState.set({ trackId: null, currentTime: 0, isPlaying: false });
}
