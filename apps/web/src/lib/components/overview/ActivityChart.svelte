<script lang="ts">
  import DashCard from './DashCard.svelte';
  import { weekBuckets, type OverviewEvent, type WeekBucket } from '$lib/utils/overview.js';

  let { events }: { events: OverviewEvent[] } = $props();

  const HEIGHT = 160;
  let table = $state(false);
  const buckets = $derived(weekBuckets(events, 8));
  // Scale in steps of five, at least up to five
  const top = $derived(Math.max(5, Math.ceil(Math.max(...buckets.map((b) => b.versions + b.comments)) / 5) * 5));
  const px = (n: number) => (n / top) * HEIGHT;
  const label = (b: WeekBucket) =>
    `KW ${b.week}${b.current ? ', diese Woche' : ''}\n${b.versions} ${b.versions === 1 ? 'Version' : 'Versionen'}\n${b.comments} ${b.comments === 1 ? 'Kommentar' : 'Kommentare'}`;
</script>

<DashCard icon="activity" title="Aktivität" sub="pro Kalenderwoche" span={6}>
  {#snippet actions()}
    <button type="button" class="tbtn" onclick={() => (table = !table)}>{table ? 'Diagramm' : 'Tabelle'}</button>
  {/snippet}
  {#if table}
    <table class="mini-table">
      <thead><tr><th>Woche</th><th>Versionen</th><th>Kommentare</th></tr></thead>
      <tbody>
        {#each buckets as b (b.week)}
          <tr><td>KW {b.week}{b.current ? ' (diese)' : ''}</td><td>{b.versions}</td><td>{b.comments}</td></tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <div class="legend">
      <span><i style="background: var(--color-series-1)"></i>Versionen</span>
      <span><i style="background: var(--color-series-2)"></i>Kommentare</span>
    </div>
    <div class="plot" style="height: {HEIGHT}px">
      {#each [0, top / 2, top] as line (line)}
        <i class="grid" class:base={line === 0} style="bottom: {px(line)}px"><span>{line.toLocaleString('de-DE')}</span></i>
      {/each}
      <div class="cols">
        {#each buckets as b (b.week)}
          <button type="button" class="col" class:cur={b.current} data-tt={label(b)} aria-label={label(b).split('\n').join(', ')}>
            {#if b.current}<span class="val">{b.versions + b.comments}</span>{/if}
            {#if b.comments}<i class="seg c top" style="height: {Math.max(2, px(b.comments) - (b.versions ? 1 : 0))}px"></i>{/if}
            {#if b.comments && b.versions}<i class="gap"></i>{/if}
            {#if b.versions}<i class="seg v" class:top={!b.comments} style="height: {Math.max(2, px(b.versions) - (b.comments ? 1 : 0))}px"></i>{/if}
            <span class="x">KW {b.week}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</DashCard>

<style>
  .plot {
    position: relative;
    margin: 6px 0 22px 26px;
  }
  .grid {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: #24222e;
    font-style: normal;
  }
  .grid.base {
    background: #3a3646;
  }
  .grid span {
    position: absolute;
    right: calc(100% + 8px);
    top: -8px;
    font-size: 11px;
    color: var(--color-text-axis);
    font-variant-numeric: tabular-nums;
  }
  .cols {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: stretch;
  }
  .col {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: default;
    outline: none;
  }
  .col::before {
    content: '';
    position: absolute;
    inset: 0 4px;
    border-radius: 6px;
  }
  .col:hover::before,
  .col:focus-visible::before {
    background: rgba(255, 255, 255, 0.03);
  }
  .col:hover .seg,
  .col:focus-visible .seg {
    filter: brightness(1.2);
  }
  /* At most 24 px wide, 2 px apart */
  .seg {
    width: min(24px, 56%);
    flex-shrink: 0;
    position: relative;
  }
  .seg.v {
    background: var(--color-series-1);
  }
  .seg.c {
    background: var(--color-series-2);
  }
  .seg.top {
    border-radius: 4px 4px 0 0;
  }
  .gap {
    height: 2px;
    flex-shrink: 0;
  }
  .x {
    position: absolute;
    top: calc(100% + 6px);
    font-size: 11px;
    color: var(--color-text-axis);
    white-space: nowrap;
  }
  .cur .x {
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .val {
    font-size: 11px;
    color: var(--color-text-primary);
    font-weight: 600;
    margin-bottom: 4px;
    font-variant-numeric: tabular-nums;
  }
</style>
