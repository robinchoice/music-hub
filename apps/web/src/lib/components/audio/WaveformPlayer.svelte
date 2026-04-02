<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';
  import { formatTime } from '$lib/utils/format.js';

  type CommentMarker = {
    id: string;
    timestampSeconds: number;
    body: string;
    userName: string;
  };

  let {
    url,
    markers = [],
    muted = false,
    compact = false,
    label = '',
    onTimeClick,
    onReady,
    onSeek,
  }: {
    url: string;
    markers?: CommentMarker[];
    muted?: boolean;
    compact?: boolean;
    label?: string;
    onTimeClick?: (time: number) => void;
    onReady?: (duration: number) => void;
    onSeek?: (time: number) => void;
  } = $props();

  let container: HTMLDivElement;
  let ws: WaveSurfer | null = null;
  let isPlaying = $state(false);
  let currentTime = $state(0);
  let duration = $state(0);
  let volume = $state(0.8);

  $effect(() => {
    if (ws) ws.setVolume(muted ? 0 : volume);
  });

  onMount(() => {
    ws = WaveSurfer.create({
      container,
      waveColor: 'var(--color-bg-subtle, #4a4a5a)',
      progressColor: 'var(--color-accent, #6366f1)',
      cursorColor: '#818cf8',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: compact ? 48 : 80,
      normalize: true,
      url,
    });

    ws.on('ready', () => {
      duration = ws!.getDuration();
      ws!.setVolume(muted ? 0 : volume);
      onReady?.(duration);
    });

    ws.on('timeupdate', (time) => {
      currentTime = time;
      onSeek?.(time);
    });

    ws.on('play', () => (isPlaying = true));
    ws.on('pause', () => (isPlaying = false));

    ws.on('click', (relativeX) => {
      if (onTimeClick) {
        const clickedTime = relativeX * (ws?.getDuration() || 0);
        onTimeClick(clickedTime);
      }
    });
  });

  onDestroy(() => {
    ws?.destroy();
  });

  function togglePlay() {
    ws?.playPause();
  }

  function play() { ws?.play(); }
  function pause() { ws?.pause(); }

  function skip(seconds: number) {
    if (!ws) return;
    ws.setTime(Math.max(0, Math.min(ws.getDuration(), ws.getCurrentTime() + seconds)));
  }

  function setVol(v: number) {
    volume = v;
    if (!muted) ws?.setVolume(v);
  }

  function seekToTime(time: number) {
    ws?.setTime(time);
  }

  function getCurrentTime(): number {
    return ws?.getCurrentTime() || 0;
  }

  export { seekToTime, play, pause, getCurrentTime };
</script>

<div class="waveform-player" class:compact>
  {#if label}
    <span class="player-label">{label}</span>
  {/if}

  <div class="waveform-container">
    <div bind:this={container} class="waveform"></div>

    {#if duration > 0 && markers.length > 0}
      <div class="markers">
        {#each markers as marker}
          <button
            class="marker"
            style="left: {(marker.timestampSeconds / duration) * 100}%"
            title="{marker.userName}: {marker.body}"
            onclick={() => seekToTime(marker.timestampSeconds)}
          ></button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="controls">
    <div class="controls-left">
      {#if !compact}
        <button class="control-btn" onclick={() => skip(-10)} title="Back 10s">⏪</button>
      {/if}
      <button class="control-btn play-btn" onclick={togglePlay}>
        {isPlaying ? '⏸' : '▶'}
      </button>
      {#if !compact}
        <button class="control-btn" onclick={() => skip(10)} title="Forward 10s">⏩</button>
      {/if}
    </div>

    <div class="time">
      {formatTime(currentTime)} / {formatTime(duration)}
    </div>

    {#if !compact}
      <div class="controls-right">
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          oninput={(e) => setVol(Number((e.target as HTMLInputElement).value))}
          class="volume-slider"
          title="Volume"
        />
      </div>
    {/if}
  </div>
</div>

<style>
  .waveform-player {
    background: var(--color-bg-overlay);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    border: 1px solid var(--color-border);
  }

  .waveform-player.compact {
    padding: var(--space-3);
  }

  .player-label {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--space-2);
  }

  .waveform-container {
    position: relative;
    margin-bottom: var(--space-3);
  }

  .waveform {
    cursor: pointer;
  }

  .markers {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .marker {
    position: absolute;
    top: 0;
    width: 8px;
    height: 100%;
    transform: translateX(-50%);
    background: rgba(251, 191, 36, 0.2);
    border: none;
    border-left: 2px solid var(--color-warning);
    cursor: pointer;
    pointer-events: auto;
    padding: 0;
    transition: background var(--transition-fast);
  }

  .marker:hover {
    background: rgba(251, 191, 36, 0.4);
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .controls-left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .control-btn {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    font-size: 1.1rem;
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
  }

  .control-btn:hover {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }

  .play-btn {
    font-size: 1.3rem;
    padding: var(--space-1) var(--space-3);
    background: var(--color-accent);
    color: #fff;
    border-radius: var(--radius-md);
  }

  .play-btn:hover {
    background: var(--color-accent-hover);
  }

  .time {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .controls-right {
    display: flex;
    align-items: center;
  }

  .volume-slider {
    width: 80px;
    accent-color: var(--color-accent);
  }
</style>
