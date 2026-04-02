<script lang="ts">
  import WaveformPlayer from './WaveformPlayer.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  let {
    versionA,
    versionB,
    streamUrlA,
    streamUrlB,
    onClose,
  }: {
    versionA: { versionNumber: number; label: string | null };
    versionB: { versionNumber: number; label: string | null };
    streamUrlA: string;
    streamUrlB: string;
    onClose: () => void;
  } = $props();

  let playerA = $state<WaveformPlayer>();
  let playerB = $state<WaveformPlayer>();
  let activePlayer = $state<'A' | 'B'>('A');
  let syncing = false;

  function handleSeekA(time: number) {
    if (syncing) return;
    syncing = true;
    playerB?.seekToTime(time);
    syncing = false;
  }

  function handleSeekB(time: number) {
    if (syncing) return;
    syncing = true;
    playerA?.seekToTime(time);
    syncing = false;
  }

  function switchTo(player: 'A' | 'B') {
    activePlayer = player;
    // Sync position, then play the active one
    if (player === 'A') {
      playerB?.pause();
      const time = playerB?.getCurrentTime() || 0;
      playerA?.seekToTime(time);
      playerA?.play();
    } else {
      playerA?.pause();
      const time = playerA?.getCurrentTime() || 0;
      playerB?.seekToTime(time);
      playerB?.play();
    }
  }

  const labelA = $derived(`V${versionA.versionNumber}${versionA.label ? ' — ' + versionA.label : ''}`);
  const labelB = $derived(`V${versionB.versionNumber}${versionB.label ? ' — ' + versionB.label : ''}`);
</script>

<div class="ab-compare">
  <div class="ab-header">
    <h2>A/B Compare</h2>
    <div class="ab-toggle">
      <button class="toggle-btn" class:active={activePlayer === 'A'} onclick={() => switchTo('A')}>A</button>
      <button class="toggle-btn" class:active={activePlayer === 'B'} onclick={() => switchTo('B')}>B</button>
    </div>
    <Button variant="ghost" size="sm" onclick={onClose}>Close</Button>
  </div>

  <div class="players">
    <div class="player-wrapper" class:active={activePlayer === 'A'}>
      <WaveformPlayer
        bind:this={playerA}
        url={streamUrlA}
        label="A — {labelA}"
        compact
        muted={activePlayer !== 'A'}
        onSeek={handleSeekA}
      />
    </div>
    <div class="player-wrapper" class:active={activePlayer === 'B'}>
      <WaveformPlayer
        bind:this={playerB}
        url={streamUrlB}
        label="B — {labelB}"
        compact
        muted={activePlayer !== 'B'}
        onSeek={handleSeekB}
      />
    </div>
  </div>
</div>

<style>
  .ab-compare {
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
  }

  .ab-header {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    flex: 1;
  }

  .ab-toggle {
    display: flex;
    background: var(--color-bg-subtle);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .toggle-btn {
    padding: var(--space-2) var(--space-4);
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    font-weight: 600;
    font-size: var(--text-sm);
    font-family: inherit;
    transition: all var(--transition-fast);
  }

  .toggle-btn.active {
    background: var(--color-accent);
    color: #fff;
  }

  .players {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .player-wrapper {
    opacity: 0.5;
    transition: opacity var(--transition-base);
  }

  .player-wrapper.active {
    opacity: 1;
  }

  @media (min-width: 1024px) {
    .players {
      flex-direction: row;
    }

    .player-wrapper {
      flex: 1;
    }
  }
</style>
