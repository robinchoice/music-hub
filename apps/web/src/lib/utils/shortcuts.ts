/**
 * Lightweight global keyboard shortcut helper.
 *
 * Usage in a Svelte component:
 *   import { onKey } from '$lib/utils/shortcuts.js';
 *   onKey({
 *     ' ': () => playerRef?.play(),
 *     j: () => skip(-10),
 *   });
 *
 * Triggers are skipped when the user is typing in an <input>, <textarea>
 * or contenteditable element — except for keys explicitly listed in `always`.
 */
import { onMount } from 'svelte';

type Handler = (e: KeyboardEvent) => void;
type Map = Record<string, Handler>;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function onKey(map: Map, options: { always?: string[] } = {}) {
  const always = new Set(options.always ?? []);
  function handler(e: KeyboardEvent) {
    // Modifier keys: ignore for now (we don't have any cmd-shortcuts)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key;
    const fn = map[key];
    if (!fn) return;

    if (isTyping(e.target) && !always.has(key)) return;

    e.preventDefault();
    fn(e);
  }

  onMount(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
}
