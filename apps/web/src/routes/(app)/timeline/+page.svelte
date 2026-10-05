<script lang="ts">
  import { onMount, tick } from 'svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import DashCard from '$lib/components/overview/DashCard.svelte';
  import PlayerDock from '$lib/components/overview/PlayerDock.svelte';
  import TimelineLane from '$lib/components/overview/TimelineLane.svelte';
  import { overviewIndex, overviewFailed, loadOverview } from '$lib/stores/overview.js';
  import { playVersion, stopListen, toggleListen } from '$lib/stores/listen.js';
  import { eventsOf, projectGroups, timelineRange, type OverviewVersion } from '$lib/utils/overview.js';

  const DAY = 86_400_000;
  const RANGES = [
    [4, '4 Wochen'],
    [8, '8 Wochen'],
    [13, '3 Monate'],
  ] as const;

  onMount(() => {
    void loadOverview(true);
  });

  let weeks = $state(8);
  let docked = $state<OverviewVersion | null>(null);
  let scroller = $state<HTMLDivElement>();

  const now = Date.now();
  const ix = $derived($overviewIndex);
  const range = $derived(timelineRange(weeks, now));
  // Running tracks always, finished ones only with something in the range
  const groups = $derived.by(() => {
    if (!ix) return [];
    return projectGroups(ix).map((g) => ({
      ...g,
      lanes: g.list.filter((i) => !i.done || eventsOf(ix, [i.track]).some((e) => Date.parse(e.at) >= range.start)),
    }));
  });
  const visible = $derived(groups.filter((g) => g.lanes.length));
  const hidden = $derived(groups.length - visible.length);
  // Date marks on the Mondays, none right next to "heute"
  const marks = $derived(range.ticks.filter((t) => t < now - 3 * DAY));

  // The view starts at "heute", also after switching the range
  const scrolled = { weeks: 0 };
  $effect(() => {
    if (!scroller || !visible.length || scrolled.weeks === weeks) return;
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

<TopBar crumbs={[{ label: 'Timeline' }]} />

<div class="page">
  <div class="head">
    <div>
      <h1>Timeline</h1>
      <span class="sub">Alle Tracks über die Zeit. Jede Version ist ein Clip an ihrem Upload-Tag.</span>
    </div>
    <div class="seg" role="group" aria-label="Zeitraum">
      {#each RANGES as [w, label] (w)}
        <button type="button" class:on={weeks === w} aria-pressed={weeks === w} onclick={() => (weeks = w)}>{label}</button>
      {/each}
    </div>
  </div>

  {#if !ix && $overviewFailed}
    <LoadFailed />
  {:else if !ix}
    <Skeleton height="20rem" variant="rect" />
  {:else if !groups.length}
    <EmptyState title="Noch keine Projekte" description="Sobald es Tracks gibt, zeigt die Timeline, wie die Produktion verläuft." />
  {:else}
    <DashCard icon="timeline" title="Verlauf" sub="Klick auf einen Clip spielt ihn unten ab" flush>
      <div class="legend keys">
        <span><i class="clip-key" style="background: var(--color-accent)"></i>neueste Version</span>
        <span><i class="clip-key" style="background: #2e1420; box-shadow: inset 0 0 0 1px rgba(244, 63, 94, 0.55)"></i>Version</span>
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
          {#each visible as g (g.project.id)}
            <div class="trow grp">
              <div class="name">
                <CoverImage src={g.project.coverUrl} name={g.project.name} size="xs" rounded="sm" />
                <b>{g.project.name}</b>
                {#if g.project.artist}<span>{g.project.artist}</span>{/if}
              </div>
              <div class="lane">
                {#each range.ticks as t (t)}<i class="gl" style="left: {range.pct(t)}%"></i>{/each}
                <i class="today" style="left: {range.pct(now)}%"></i>
              </div>
              <div class="stagecol"></div>
            </div>
            {#each g.lanes as info (info.track.id)}
              <TimelineLane {ix} {info} {range} {now} dockedId={docked?.id ?? null} onplay={play} />
            {/each}
          {/each}
        </div>
      </div>
      {#if hidden}
        <p class="note">{hidden === 1 ? 'Ein Projekt ohne Aktivität' : `${hidden} Projekte ohne Aktivität`} im Zeitraum ausgeblendet.</p>
      {/if}
    </DashCard>
  {/if}
</div>

{#if ix && docked && ix.versions.has(docked.id)}
  <PlayerDock {ix} version={docked} onclose={close} />
{/if}

<style>
  .page {
    padding: var(--space-6);
  }
  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px 16px;
    margin-bottom: var(--space-5);
  }
  h1 {
    margin: 0;
    font-size: var(--text-xl);
    line-height: 1.25;
  }
  .sub {
    display: block;
    margin-top: 2px;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
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
  .grp {
    min-height: 34px;
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
  .grp .name {
    padding-top: 8px;
    font-weight: 600;
    white-space: nowrap;
    overflow: visible;
    background: transparent;
  }
  .grp .name b {
    color: var(--color-text-secondary);
  }
  .lane {
    position: relative;
  }
  .gl {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: #1e1c27;
  }
  .today {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: rgba(244, 63, 94, 0.5);
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
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
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
