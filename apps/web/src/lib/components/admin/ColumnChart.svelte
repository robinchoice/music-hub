<script lang="ts">
  import type { Column } from '$lib/utils/admin.js';

  // One series as columns with gridlines and a tooltip per column. The last column of a
  // running period is drawn paler, so its smaller value doesn't read as a drop.
  let {
    columns,
    height = 150,
    running = false,
    table = false,
    labelHead,
    valueHead,
  }: {
    columns: Column[];
    height?: number;
    running?: boolean;
    table?: boolean;
    labelHead: string;
    valueHead: string;
  } = $props();

  const max = $derived(Math.max(0, ...columns.map((c) => c.value)));
  // Even, so the middle gridline is a whole number
  const top = $derived(Math.max(4, Math.ceil(max / 2) * 2));
  // Only a peak that stands alone gets a label
  const peak = $derived(columns.filter((c) => c.value === max).length === 1 ? columns.findIndex((c) => c.value === max) : -1);
  const px = (n: number) => (n / top) * height;
  const last = $derived(columns.length - 1);
</script>

{#if table}
  <table class="mini-table">
    <thead><tr><th>{labelHead}</th><th>{valueHead}</th></tr></thead>
    <tbody>
      {#each columns as c, i (i)}
        <tr><td>{c.label}{running && i === last ? ' (läuft)' : ''}</td><td>{c.value}</td></tr>
      {/each}
    </tbody>
  </table>
{:else}
  <div class="plot" style="height: {height}px">
    {#each [0, top / 2, top] as line (line)}
      <i class="grid" class:base={line === 0} style="bottom: {px(line)}px"><span>{line}</span></i>
    {/each}
    <div class="cols">
      {#each columns as c, i (i)}
        <button type="button" class="col" class:cur={running && i === last} data-tt={c.tip} aria-label={c.tip.split('\n').join(', ')}>
          {#if i === peak && max > 0}<span class="val">{c.value}</span>{/if}
          {#if c.value}<i class="bar" style="height: {px(c.value)}px"></i>{/if}
          {#if c.tick}<span class="x">{c.label}</span>{/if}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .mini-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  .mini-table th {
    font-weight: 500;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    text-align: right;
    padding: 4px 6px;
    border-bottom: 1px solid var(--color-border);
  }
  .mini-table td {
    padding: 5px 6px;
    text-align: right;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    border-bottom: 1px solid rgba(36, 34, 46, 0.6);
  }
  .mini-table :is(th, td):first-child {
    text-align: left;
  }
  /* Room above for the label of the peak, below for the axis */
  .plot {
    position: relative;
    margin: 18px 0 22px 26px;
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
    min-width: 0;
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
    inset: 0 1px;
    border-radius: 6px;
  }
  .col:hover::before,
  .col:focus-visible::before {
    background: rgba(255, 255, 255, 0.03);
  }
  .col:hover .bar,
  .col:focus-visible .bar {
    filter: brightness(1.2);
  }
  /* At most 24 px wide, at least 2 px apart */
  .bar {
    display: block;
    width: min(24px, calc(100% - 2px));
    flex-shrink: 0;
    background: var(--color-series-1);
    border-radius: 4px 4px 0 0;
  }
  .cur .bar {
    opacity: 0.45;
  }
  .x {
    position: absolute;
    top: calc(100% + 6px);
    font-size: 11px;
    color: var(--color-text-axis);
    white-space: nowrap;
  }
  .val {
    font-size: 11px;
    color: var(--color-text-primary);
    font-weight: 600;
    margin-bottom: 4px;
    font-variant-numeric: tabular-nums;
  }
</style>
