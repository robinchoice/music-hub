<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte';
  import PeakBars from './PeakBars.svelte';
  import { listen, toggleListen, seekListen } from '$lib/stores/listen.js';
  import { formatTime } from '$lib/utils/format.js';
  import type { Marker } from '$lib/utils/overview.js';

  let {
    version,
    markers = [],
    count = 80,
    big = false,
  }: {
    version: { id: string; trackId: string; duration: number | null };
    markers?: Marker[];
    count?: number;
    big?: boolean;
  } = $props();

  const current = $derived($listen.versionId === version.id);
  const playing = $derived(current && $listen.playing);
  const duration = $derived(current && $listen.duration ? $listen.duration : (version.duration ?? 0));
  const time = $derived(current ? $listen.time : 0);
</script>

<div class="wf" class:big class:playing>
  <button type="button" class="play" aria-label={playing ? 'Pause' : 'Abspielen'} onclick={() => toggleListen(version)}>
    <Icon name={playing ? 'pause' : 'play'} size={big ? 18 : 12} />
  </button>
  <div class="track">
    <PeakBars
      versionId={version.id}
      {duration}
      {count}
      {markers}
      progress={duration ? time / duration : 0}
      started={current}
      onseek={(seconds) => seekListen(version, seconds)}
    />
  </div>
  <span class="time" class:started={current}>{formatTime(current ? time : duration)}</span>
</div>

<style>
  .wf {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .play {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: none;
    padding: 0;
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }
  .play:hover,
  .playing .play {
    background: var(--gradient-accent);
    color: #fff;
  }
  .track {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 34px;
  }
  .time {
    font-size: 11.5px;
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    min-width: 32px;
    text-align: right;
  }
  .time.started {
    color: var(--color-text-primary);
  }
  .big {
    gap: 14px;
  }
  .big .play {
    width: 46px;
    height: 46px;
  }
  .big .track {
    height: 84px;
    --bars-top: 24px;
    --bar-gap: 2px;
    --marker: 20px;
    --marker-line: 64px;
  }
</style>
