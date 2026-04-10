<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';
  import { formatTime } from '$lib/utils/format.js';
  import Icon from '$lib/components/ui/Icon.svelte';

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
    initialTime = 0,
    autoPlay = false,
    onTimeClick,
    onReady,
    onSeek,
  }: {
    url: string;
    markers?: CommentMarker[];
    muted?: boolean;
    compact?: boolean;
    label?: string;
    initialTime?: number;
    autoPlay?: boolean;
    onTimeClick?: (time: number) => void;
    onReady?: (duration: number) => void;
    onSeek?: (time: number) => void;
  } = $props();

  let container: HTMLDivElement;
  let ws: WaveSurfer | null = null;
  let isPlaying = $state(false);
  let isReady = $state(false);
  let currentTime = $state(0);
  let duration = $state(0);
  let volume = $state(0.8);
  let showVolume = $state(false);

  $effect(() => {
    if (ws) ws.setVolume(muted ? 0 : volume);
  });

  onMount(() => {
    // Resolve CSS variables to real colors so wavesurfer renders correctly.
    const styles = getComputedStyle(document.documentElement);
    const waveColor = styles.getPropertyValue('--color-bg-subtle').trim() || '#262430';
    const progressColor = styles.getPropertyValue('--color-accent').trim() || '#f43f5e';

    ws = WaveSurfer.create({
      container,
      waveColor,
      progressColor,
      cursorColor: progressColor,
      cursorWidth: 2,
      barWidth: 2,
      barGap: 2,
      barRadius: 3,
      height: compact ? 56 : 96,
      normalize: true,
      url,
    });

    ws.on('ready', () => {
      duration = ws!.getDuration();
      isReady = true;
      ws!.setVolume(muted ? 0 : volume);
      if (initialTime > 0 && initialTime < duration) {
        ws!.setTime(initialTime);
      }
      if (autoPlay) {
        ws!.play().catch(() => {});
      }
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

  function getIsPlaying(): boolean {
    return isPlaying;
  }

  export { seekToTime, play, pause, togglePlay, getCurrentTime, getIsPlaying };

  function initials(name: string) {
    return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  }
</script>

<div class="player" class:compact>
  {#if label}
    <span class="player-label">{label}</span>
  {/if}

  <div class="player-row">
    <button
      class="play-btn"
      class:compact-btn={compact}
      onclick={togglePlay}
      disabled={!isReady}
      aria-label={isPlaying ? 'Pause' : 'Abspielen'}
    >
      <Icon name={isPlaying ? 'pause' : 'play'} size={compact ? 18 : 24} />
    </button>

    <div class="waveform-block">
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
              >
                <span class="marker-dot">{initials(marker.userName)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if !compact}
        <div class="meta-row">
          <span class="time">{formatTime(currentTime)}</span>
          <div class="meta-controls">
            <button class="ctl" onclick={() => skip(-10)} aria-label="10 Sekunden zurück">
              <Icon name="skip-back" size={14} />
            </button>
            <button class="ctl" onclick={() => skip(10)} aria-label="10 Sekunden vor">
              <Icon name="skip-forward" size={14} />
            </button>
            <div class="volume" onmouseenter={() => (showVolume = true)} onmouseleave={() => (showVolume = false)} role="group">
              <button class="ctl" aria-label="Lautstärke">
                <Icon name={volume === 0 ? 'volume-off' : 'volume'} size={14} />
              </button>
              {#if showVolume}
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  oninput={(e) => setVol(Number((e.target as HTMLInputElement).value))}
                  class="volume-slider"
                  aria-label="Lautstärke einstellen"
                />
              {/if}
            </div>
          </div>
          <span class="time muted">{formatTime(duration)}</span>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .player {
    width: 100%;
  }

  .player-label {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: var(--space-3);
  }

  .player-row {
    display: flex;
    gap: var(--space-5);
    align-items: center;
  }

  .play-btn {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    border: none;
    background: var(--gradient-accent);
    color: #fff;
    cursor: pointer;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.2) inset,
      0 8px 24px rgba(244, 63, 94, 0.32);
    transition:
      transform var(--transition-fast),
      box-shadow var(--transition-fast);
    padding-left: 4px; /* visual centering for play triangle */
  }
  .play-btn:hover:not(:disabled) {
    transform: scale(1.05);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.25) inset,
      0 12px 36px rgba(244, 63, 94, 0.45);
  }
  .play-btn:active:not(:disabled) {
    transform: scale(0.96);
  }
  .play-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .play-btn.compact-btn {
    width: 44px;
    height: 44px;
  }

  .waveform-block {
    flex: 1;
    min-width: 0;
  }

  .waveform-container {
    position: relative;
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
    top: -6px;
    transform: translateX(-50%);
    width: 22px;
    height: 22px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    pointer-events: auto;
    z-index: 2;
  }
  .marker::after {
    content: '';
    position: absolute;
    top: 22px;
    left: 50%;
    transform: translateX(-50%);
    width: 1px;
    height: calc(100% - 22px + 6px);
    background: var(--color-accent);
    opacity: 0.35;
    pointer-events: none;
  }
  .marker-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--gradient-accent);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    border: 2px solid var(--color-bg-raised);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    transition: transform var(--transition-fast);
  }
  .marker:hover .marker-dot {
    transform: scale(1.15);
  }

  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .time {
    color: var(--color-text-primary);
    font-weight: 500;
    min-width: 38px;
  }
  .time.muted {
    color: var(--color-text-tertiary);
    font-weight: 400;
    text-align: right;
  }

  .meta-controls {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .ctl {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-fast);
  }
  .ctl:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-subtle);
  }

  .volume {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .volume-slider {
    width: 80px;
    margin-left: var(--space-2);
    accent-color: var(--color-accent);
    cursor: pointer;
  }

  .compact .play-btn {
    width: 44px;
    height: 44px;
  }

  @media (max-width: 540px) {
    .player-row {
      gap: var(--space-3);
    }
    .play-btn {
      width: 52px;
      height: 52px;
    }
    .meta-controls {
      gap: 0;
    }
    .ctl {
      width: 24px;
      height: 24px;
    }
    .volume-slider {
      width: 60px;
    }
  }
</style>
