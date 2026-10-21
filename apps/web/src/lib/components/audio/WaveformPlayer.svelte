<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';
  import { APP_BAND, GLOW, bandColor } from '@music-hub/shared';
  import { formatTime, initials } from '$lib/utils/format.js';
  import Icon from '$lib/components/ui/Icon.svelte';
  import type { CommentMarker } from '$lib/utils/track.js';

  let {
    url,
    peaks,
    audioDuration,
    markers = [],
    muted = false,
    compact = false,
    label = '',
    initialTime = 0,
    autoPlay = false,
    onTimeClick,
    onReady,
    onSeek,
    onPlay,
    onPause,
    onFinish,
  }: {
    url: string;
    peaks?: number[];
    audioDuration?: number | null;
    markers?: CommentMarker[];
    muted?: boolean;
    compact?: boolean;
    label?: string;
    initialTime?: number;
    autoPlay?: boolean;
    onTimeClick?: (time: number) => void;
    onReady?: (duration: number) => void;
    onSeek?: (time: number) => void;
    onPlay?: () => void;
    onPause?: () => void;
    onFinish?: () => void;
  } = $props();

  let container: HTMLDivElement;
  let ws: WaveSurfer | null = null;
  let isPlaying = $state(false);
  let isReady = $state(false);
  let currentTime = $state(0);
  let duration = $state(0);
  let volume = $state(0.8);
  let showVolume = $state(false);
  let width = $state(0);

  // Open comments pop up while playback passes them; the choice stays on this device
  let showBubbles = $state(true);
  let bubble = $state<{ left: number; items: CommentMarker[]; pinned: boolean } | null>(null);
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTime = 0;

  // Markers closer than one marker width merge into a bundle with a count
  const MARKER_SIZE = 22;
  const groups = $derived.by(() => {
    if (!duration || !width) return [];
    const result: { x: number; items: CommentMarker[] }[] = [];
    for (const m of [...markers].sort((a, b) => a.timestampSeconds - b.timestampSeconds)) {
      const x = (m.timestampSeconds / duration) * width;
      const last = result.at(-1);
      if (last && x - last.x < MARKER_SIZE) last.items.push(m);
      else result.push({ x, items: [m] });
    }
    return result;
  });

  function showBubble(left: number, items: CommentMarker[], pinned: boolean) {
    clearTimeout(bubbleTimer);
    bubble = { left, items, pinned };
    if (!pinned) bubbleTimer = setTimeout(() => (bubble = null), 4000);
  }

  function closeBubble() {
    clearTimeout(bubbleTimer);
    bubble = null;
  }

  function toggleBubbles() {
    showBubbles = !showBubbles;
    localStorage.setItem('waveform-bubbles', showBubbles ? '1' : '0');
    if (!showBubbles && !bubble?.pinned) closeBubble();
  }

  function openGroup(group: { x: number; items: CommentMarker[] }) {
    seekToTime(group.items[0].timestampSeconds);
    if (group.items.length > 1) showBubble(group.x, group.items, true);
    else closeBubble();
  }

  $effect(() => {
    if (ws) ws.setVolume(muted ? 0 : volume);
  });

  const height = $derived(compact ? 56 : 96);

  // The played part shows the product gradient. It spans the whole waveform from bottom left to top
  // right like CSS linear-gradient(45deg), so the colour marks the position in the song.
  function progressGradient(): CanvasGradient | string {
    const stops = [APP_BAND.from, (APP_BAND.from + APP_BAND.to) / 2, APP_BAND.to].map((p) => bandColor(p, GLOW));
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const w = container.clientWidth * ratio;
    const h = height * ratio;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx || !w) return stops[1];
    const d = (w + h) / 4;
    const gradient = ctx.createLinearGradient(w / 2 - d, h / 2 + d, w / 2 + d, h / 2 - d);
    stops.forEach((color, i) => gradient.addColorStop(i / 2, color));
    return gradient;
  }

  onMount(() => {
    showBubbles = localStorage.getItem('waveform-bubbles') !== '0';
    // Resolve CSS variables to real colors so wavesurfer renders correctly.
    const styles = getComputedStyle(container);
    const waveColor = styles.getPropertyValue('--color-wave-idle').trim() || '#47444b';
    const cursorColor = styles.getPropertyValue('--color-text-primary').trim() || '#f2f0ea';

    ws = WaveSurfer.create({
      container,
      waveColor,
      progressColor: progressGradient(),
      cursorColor,
      cursorWidth: 2,
      barWidth: 2,
      barGap: 2,
      barRadius: 3,
      height,
      normalize: true,
      url,
      // With peaks wavesurfer streams the audio, without them it downloads and decodes
      // the whole file before it can play. No peaks yet (empty list) draws a flat line.
      peaks: peaks && [peaks.length ? peaks : [0]],
      duration: audioDuration || undefined,
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
      // Only the normal run counts, a jump past a comment shows nothing
      if (showBubbles && isPlaying && !bubble?.pinned && time > lastTime && time - lastTime < 1) {
        const passed = markers.filter((m) => !m.resolved && m.timestampSeconds > lastTime && m.timestampSeconds <= time);
        if (passed.length) showBubble((passed[0].timestampSeconds / duration) * width, passed, false);
      }
      lastTime = time;
      currentTime = time;
      onSeek?.(time);
    });

    ws.on('play', () => { isPlaying = true; onPlay?.(); });
    ws.on('pause', () => { isPlaying = false; onPause?.(); });
    ws.on('finish', () => { isPlaying = false; onFinish?.(); });

    ws.on('click', (relativeX) => {
      if (onTimeClick) {
        const clickedTime = relativeX * (ws?.getDuration() || 0);
        onTimeClick(clickedTime);
      }
    });

    // The gradient is drawn in canvas pixels, so it has to follow the width
    width = container.clientWidth;
    resizeObserver = new ResizeObserver(() => {
      if (container.clientWidth === width) return;
      width = container.clientWidth;
      closeBubble();
      ws?.setOptions({ progressColor: progressGradient() });
    });
    resizeObserver.observe(container);
  });

  let resizeObserver: ResizeObserver | undefined;

  onDestroy(() => {
    clearTimeout(bubbleTimer);
    resizeObserver?.disconnect();
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

        {#if groups.length > 0}
          <div class="markers">
            {#each groups as group (group.items[0].id)}
              {@const single = group.items.length === 1}
              <button
                class="marker"
                class:done={group.items.every((m) => m.resolved)}
                style="left: {group.x}px"
                title={group.items.map((m) => `${m.userName}: ${m.body}`).join('\n')}
                aria-label={single ? `Kommentar von ${group.items[0].userName} bei ${formatTime(group.items[0].timestampSeconds)}` : `${group.items.length} Kommentare ab ${formatTime(group.items[0].timestampSeconds)}`}
                onclick={() => openGroup(group)}
              >
                <span class="marker-dot" class:count={!single}>{single ? initials(group.items[0].userName) : group.items.length}</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if bubble}
          <div
            class="bubble"
            class:start={bubble.left < width * 0.25}
            class:end={bubble.left > width * 0.75}
            style="left: {bubble.left}px"
          >
            {#each bubble.items as m (m.id)}
              <button class="bubble-item" class:done={m.resolved} onclick={() => seekToTime(m.timestampSeconds)}>
                <span class="bubble-dot">{initials(m.userName)}</span>
                <span class="bubble-text">
                  <b>{m.userName}</b> <span class="bubble-time">{formatTime(m.timestampSeconds)}</span>
                  <span class="bubble-body">{m.body.split('\n')[0]}</span>
                  {#if m.replies > 0}<span class="bubble-replies">{m.replies} {m.replies === 1 ? 'Antwort' : 'Antworten'}</span>{/if}
                </span>
              </button>
            {/each}
            {#if bubble.pinned}
              <button class="bubble-close" onclick={closeBubble} aria-label="Schließen"><Icon name="x" size={12} /></button>
            {/if}
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
            {#if markers.length > 0}
              <button
                class="ctl"
                class:off={!showBubbles}
                onclick={toggleBubbles}
                aria-pressed={showBubbles}
                aria-label="Kommentare beim Abspielen einblenden"
                title={showBubbles ? 'Kommentare beim Abspielen ausblenden' : 'Kommentare beim Abspielen einblenden'}
              >
                <Icon name="comment" size={14} />
              </button>
            {/if}
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
    /* Neutral, the waveform carries the gradient */
    background: var(--color-text-primary);
    color: var(--color-bg-base);
    cursor: pointer;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform var(--transition-fast);
    padding-left: 4px; /* visual centering for play triangle */
  }
  .play-btn:hover:not(:disabled) {
    transform: scale(1.05);
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
    background: var(--color-text-primary);
    opacity: 0.3;
    pointer-events: none;
  }
  .marker-dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--color-text-primary);
    color: var(--color-bg-base);
    font-size: 9px;
    font-weight: 700;
    border: 2px solid var(--color-bg-raised);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    transition: transform var(--transition-fast);
  }
  .marker:hover .marker-dot {
    transform: scale(1.15);
  }
  .marker.done {
    opacity: 0.35;
  }
  .marker-dot.count {
    background: var(--color-accent);
    font-size: 10px;
  }

  .bubble {
    position: absolute;
    top: 22px;
    transform: translateX(-50%);
    z-index: 3;
    width: max-content;
    max-width: min(280px, 100%);
    max-height: 160px;
    overflow-y: auto;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
  }
  .bubble.start {
    transform: translateX(-11px);
  }
  .bubble.end {
    transform: translateX(calc(-100% + 11px));
  }
  .bubble-item {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    padding: var(--space-1) var(--space-2);
    padding-right: var(--space-5);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-xs);
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }
  .bubble-item:hover {
    background: var(--color-bg-subtle);
  }
  .bubble-item.done {
    opacity: 0.5;
  }
  .bubble-dot {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--color-text-primary);
    color: var(--color-bg-base);
    font-size: 9px;
    font-weight: 700;
  }
  .bubble-text {
    min-width: 0;
    line-height: 1.35;
  }
  .bubble-time,
  .bubble-replies {
    color: var(--color-text-tertiary);
  }
  .bubble-body {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
  }
  .bubble-close {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .bubble-close:hover {
    color: var(--color-text-primary);
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
  .ctl[aria-pressed='true'] {
    color: var(--color-text-secondary);
  }
  .ctl.off {
    opacity: 0.5;
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
