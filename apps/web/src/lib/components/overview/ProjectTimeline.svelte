<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import DashCard from './DashCard.svelte';
  import PlayerDock from './PlayerDock.svelte';
  import TimelineLane from './TimelineLane.svelte';
  import { playVersion, stopListen, toggleListen } from '$lib/stores/listen.js';
  import { eventsOf, timelineRange, type OverviewIndex, type OverviewVersion, type TrackInfo } from '$lib/utils/overview.js';

  // The tracks of one project over time; every version is a clip on its upload day
  let { ix, list }: { ix: OverviewIndex; list: TrackInfo[] } = $props();

  const DAY = 86_400_000;
  const RANGES = [
    [4, '4 Wochen'],
    [8, '8 Wochen'],
    [13, '3 Monate'],
  ] as const;

  let weeks = $state(8);
  let docked = $state<OverviewVersion | null>(null);
  let scroller = $state<HTMLDivElement>();

  const now = Date.now();
  const range = $derived(timelineRange(weeks, now));
  // Running tracks always, finished ones only with something in the range
  const lanes = $derived(list.filter((i) => !i.done || eventsOf(ix, [i.track]).some((e) => Date.parse(e.at) >= range.start)));
  const hidden = $derived(list.length - lanes.length);
  // Date marks on the Mondays, none right next to "heute"
  const marks = $derived(range.ticks.filter((t) => t < now - 3 * DAY));

  // The view starts at "heute", also after switching the range
  const scrolled = { weeks: 0 };
  $effect(() => {
    if (!scroller || !lanes.length || scrolled.weeks === weeks) return;
    scrolled.weeks = weeks;
    const el = scroller;
    void tick().then(() => (el.scrollLeft = el.scrollWidth));
  });

  function play(version: OverviewVersion, from?: number) {
    if (docked?.id === version.id && from === undefined) {
      toggleListen(version);
      return;
    }
    docked = version;
    void playVersion(version, from);
  }

  function close() {
    stopListen();
    docked = null;
  }
</script>

<DashCard icon="timeline" title="Verlauf" sub="Klick auf einen Clip spielt ihn unten ab" flush>
  {#snippet actions()}
    <div class="seg" role="group" aria-label="Zeitraum">
      {#each RANGES as [w, label] (w)}
        <button type="button" class:on={weeks === w} aria-pressed={weeks === w} onclick={() => (weeks = w)}>{label}</button>
      {/each}
    </div>
  {/snippet}
  <div class="legend keys">
    <span><i class="clip-key" style="background: var(--color-accent)"></i>neueste Version</span>
    <span><i class="clip-key" style="background: color-mix(in srgb, var(--color-accent) 14%, var(--color-bg-raised)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 55%, transparent)"></i>Version</span>
    <span><Icon name="check" size={12} stroke={3} />freigegeben</span>
    <span><Icon name="x" size={12} stroke={3} />abgelehnt</span>
    <span><i class="dot-key"></i>Kommentar</span>
  </div>
  <div class="scroll" bind:this={scroller}>
    <div class="inner">
      <div class="trow head-row">
        <div class="name">Track</div>
        <div class="lane">
          {#each marks as t (t)}
            <span class="wk" style="left: {range.pct(t)}%">{new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })}</span>
          {/each}
          <span class="todaylbl" style="left: {range.pct(now)}%">heute</span>
        </div>
        <div class="stagecol">Stand</div>
      </div>
      {#each lanes as info (info.track.id)}
        <TimelineLane {ix} {info} {range} {now} dockedId={docked?.id ?? null} onplay={play} />
      {/each}
    </div>
  </div>
  {#if hidden}
    <p class="note">{hidden === 1 ? 'Ein fertiger Track' : `${hidden} fertige Tracks`} ohne Aktivität im Zeitraum ausgeblendet.</p>
  {/if}
</DashCard>

{#if docked && ix.versions.has(docked.id)}
  <PlayerDock {ix} version={docked} onclose={close} />
{/if}

<style>
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .seg button {
    height: 28px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    background: none;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }
  .keys {
    padding: 0 var(--space-5);
    margin-bottom: var(--space-3);
  }
  .legend .clip-key {
    width: 16px;
    height: 10px;
    border-radius: 3px;
  }
  .legend .dot-key {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-series-2);
  }
  .scroll {
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: #2a2735 transparent;
  }
  .inner {
    min-width: 100%;
    --tl-cols: 210px minmax(0, 1fr) 230px;
  }
  .trow {
    display: grid;
    grid-template-columns: var(--tl-cols);
    align-items: stretch;
  }
  .head-row {
    min-height: 26px;
  }
  .name {
    position: sticky;
    left: 0;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 0 12px 0 var(--space-5);
    background: var(--color-bg-raised);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-text-tertiary);
  }
  .lane {
    position: relative;
  }
  .wk {
    position: absolute;
    top: 4px;
    transform: translateX(5px);
    font-size: 11px;
    color: var(--color-text-axis);
    white-space: nowrap;
  }
  .todaylbl {
    position: absolute;
    top: 4px;
    z-index: 1;
    transform: translateX(-50%);
    padding: 0 4px;
    background: var(--color-bg-raised);
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
  }
  .stagecol {
    display: flex;
    align-items: center;
    padding: 4px var(--space-5) 4px 14px;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-text-tertiary);
  }
  .note {
    margin: 0;
    padding: 8px var(--space-5) 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  /* Phone: swipe sideways, names stay, no stage column */
  @media (max-width: 640px) {
    .inner {
      width: 760px;
      --tl-cols: 128px minmax(0, 1fr);
    }
    .name {
      padding-left: var(--space-4);
    }
    .stagecol {
      display: none;
    }
    .keys,
    .note {
      padding-left: var(--space-4);
      padding-right: var(--space-4);
    }
  }
</style>
