// Lock screen, headphone and car buttons drive the player through the Media Session API.
// Unreleased titles may stay off the lock screen: the choice is kept on this device.

const HIDE_KEY = 'media-session-hide';

export type SessionInfo = {
  title: string;
  artist: string;
  artwork?: string | null;
  /** Open tracks are public anyway and always show their title */
  public?: boolean;
  previous?: () => void;
  next?: () => void;
};

export type SessionControls = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  skip: (seconds: number) => void;
};

export const titleHidden = () => localStorage.getItem(HIDE_KEY) === '1';

export function setTitleHidden(hidden: boolean) {
  localStorage.setItem(HIDE_KEY, hidden ? '1' : '0');
}

let owner: object | null = null;

/** Takes over the session for one player; the last one to start playing wins */
export function claimSession(player: object, info: SessionInfo, controls: SessionControls) {
  if (!('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  owner = player;
  const hidden = !info.public && titleHidden();
  session.metadata = new MediaMetadata(
    hidden
      ? { title: 'Music Hub' }
      : { title: info.title, artist: info.artist, artwork: info.artwork ? [{ src: info.artwork }] : [] },
  );
  const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
    ['play', () => controls.play()],
    ['pause', () => controls.pause()],
    ['seekbackward', (d) => controls.skip(-(d.seekOffset ?? 10))],
    ['seekforward', (d) => controls.skip(d.seekOffset ?? 10)],
    ['seekto', (d) => d.seekTime !== undefined && controls.seekTo(d.seekTime)],
    ['previoustrack', info.previous ? () => info.previous!() : null],
    ['nexttrack', info.next ? () => info.next!() : null],
  ];
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Older browsers don't know every action
    }
  }
}

export function sessionPosition(player: object, duration: number, position: number) {
  if (owner !== player || !('mediaSession' in navigator) || !duration) return;
  try {
    navigator.mediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: 1 });
  } catch {
    // Not supported everywhere
  }
}

export function sessionPlaying(player: object, playing: boolean) {
  if (owner !== player || !('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

export function releaseSession(player: object) {
  if (owner !== player || !('mediaSession' in navigator)) return;
  owner = null;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = 'none';
  for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as const) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      // Older browsers don't know every action
    }
  }
}
