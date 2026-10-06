<script module lang="ts">
  import { api } from '$lib/api/client.js';

  // About 800 peaks per version, computed by the API; the service worker keeps them for offline versions
  const cache = new Map<string, Promise<number[]>>();

  function loadPeaks(versionId: string): Promise<number[]> {
    let peaks = cache.get(versionId);
    if (!peaks) {
      peaks = api.get<number[]>(`/versions/${versionId}/waveform-data`, true).catch(() => []);
      cache.set(versionId, peaks);
    }
    return peaks;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { downsample, type Marker } from '$lib/utils/overview.js';
  import { formatTime } from '$lib/utils/format.js';

  let {
    versionId,
    duration,
    count = 80,
    progress = 0,
    started = false,
    markers = [],
    onseek,
    onmarker,
  }: {
    versionId: string;
    duration: number;
    count?: number;
    /** Played share from 0 to 1 */
    progress?: number;
    /** Shows the playhead */
    started?: boolean;
    markers?: Marker[];
    onseek: (seconds: number) => void;
    onmarker?: (marker: Marker) => void;
  } = $props();

  let el = $state<HTMLDivElement>();
  let width = $state(0);
  let visible = $state(false);
  let peaks = $state<number[]>([]);
  // A bar needs 1 px plus its gap; narrow screens get fewer bars instead of overflowing
  const fit = $derived(Math.min(count, Math.floor(width / 3) || count));
  const bars = $derived(downsample(peaks, fit).map((h) => Math.max(8, Math.round(h * 100))));
  const shown = $derived(duration > 0 ? markers.filter((m) => m.seconds <= duration) : []);

  // Peaks load once the waveform comes close to the viewport
  onMount(() => {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        visible = true;
        io.disconnect();
      },
      { rootMargin: '200px' },
    );
    io.observe(el!);
    return () => io.disconnect();
  });

  $effect(() => {
    if (!visible) return;
    let current = true;
    loadPeaks(versionId).then((p) => {
      if (current) peaks = p;
    });
    return () => {
      current = false;
    };
  });

  function seekTo(e: MouseEvent) {
    if (!duration || !el) return;
    const r = el.getBoundingClientRect();
    onseek(Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width)) * duration);
  }

  function step(e: KeyboardEvent) {
    const delta = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
    if (!delta || !duration) return;
    e.preventDefault();
    onseek(Math.min(duration - 0.1, Math.max(0, progress * duration + delta)));
  }

  function pick(e: MouseEvent, marker: Marker) {
    e.stopPropagation();
    if (onmarker) onmarker(marker);
    else onseek(marker.seconds);
  }
</script>

<div
  bind:this={el}
  bind:clientWidth={width}
  class="peaks"
  style="--p: {Math.min(1, progress)}"
  role="slider"
  tabindex="0"
  aria-label="Position"
  aria-valuemin={0}
  aria-valuemax={Math.round(duration)}
  aria-valuenow={Math.round(progress * duration)}
  aria-valuetext={formatTime(progress * duration)}
  onclick={seekTo}
  onkeydown={step}
>
  <div class="bars">
    {#each bars as h}<i style="height: {h}%"></i>{/each}
  </div>
  <!-- Every played bar shows its slice of one gradient across the whole width -->
  <div class="bars played" style="--n: {bars.length}">
    {#each bars as h, i}<i style="height: {h}%; background-position: {bars.length > 1 ? (i / (bars.length - 1)) * 100 : 0}% 0"></i>{/each}
  </div>
  {#if started}<div class="head"></div>{/if}
  {#each shown as m (m.id)}
    <button
      type="button"
      class="marker"
      class:done={m.done}
      style="left: {(m.seconds / duration) * 100}%"
      data-tt={m.tip}
      aria-label={m.tip}
      onclick={(e) => pick(e, m)}
    >{m.initials ?? ''}</button>
  {/each}
</div>

<style>
  .peaks {
    position: relative;
    height: 100%;
    min-width: 0;
    cursor: pointer;
    outline: none;
  }
  .peaks:focus-visible {
    box-shadow: 0 0 0 2px var(--color-accent);
    border-radius: 4px;
  }
  .bars {
    position: absolute;
    left: 0;
    right: 0;
    top: var(--bars-top, 9px);
    bottom: 0;
    display: flex;
    align-items: center;
    gap: var(--bar-gap, 1.5px);
    pointer-events: none;
  }
  .bars i {
    flex: 1 1 0;
    min-width: 1px;
    border-radius: 1px;
    background: var(--color-wave-idle);
  }
  .played {
    clip-path: inset(0 calc(100% - var(--p) * 100%) 0 0);
  }
  .played i {
    background-image: var(--gradient-accent);
    background-size: calc(var(--n) * 100%) 100%;
  }
  .head {
    position: absolute;
    top: calc(var(--bars-top, 9px) - 2px);
    bottom: -2px;
    left: calc(var(--p) * 100%);
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--color-text-primary);
    pointer-events: none;
  }
  .marker {
    position: absolute;
    top: 0;
    width: var(--marker, 10px);
    height: var(--marker, 10px);
    margin-left: calc(var(--marker, 10px) / -2);
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--color-text-primary);
    box-shadow: 0 0 0 2px var(--color-bg-base);
    z-index: 2;
    display: grid;
    place-items: center;
    color: var(--color-bg-base);
    font: 700 8px/1 var(--font-sans);
    cursor: pointer;
  }
  .marker::after {
    content: '';
    position: absolute;
    left: 50%;
    top: calc(var(--marker, 10px) - 1px);
    width: 1px;
    height: var(--marker-line, 25px);
    background: var(--color-text-primary);
    opacity: 0.3;
    pointer-events: none;
  }
  .marker:hover {
    box-shadow: 0 0 0 2px var(--color-bg-base), 0 0 0 4px var(--color-border-hover);
  }
  /* Resolved: only outlined */
  .marker.done {
    background: var(--color-bg-base);
    box-shadow: inset 0 0 0 1.5px var(--color-text-tertiary), 0 0 0 2px var(--color-bg-base);
    color: var(--color-text-tertiary);
  }
  .marker.done::after {
    background: var(--color-text-tertiary);
  }
</style>
