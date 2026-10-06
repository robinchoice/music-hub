<script lang="ts">
  import DashCard from './DashCard.svelte';
  import { formatGb } from '$lib/utils/format.js';
  import type { OverviewStorage } from '$lib/utils/overview.js';

  let { storage }: { storage: OverviewStorage } = $props();

  const pct = (bytes: number) => (bytes / storage.limitBytes) * 100;
  const limit = $derived(`${Math.round(storage.limitBytes / 1024 ** 3)} GB`);
  const tip = $derived(
    `${formatGb(storage.usedBytes)} von ${limit} belegt (${Math.round(pct(storage.usedBytes))} %)\nVersionen ${formatGb(storage.versionBytes)}, Spuren ${formatGb(storage.stemBytes)}`,
  );
</script>

<DashCard icon="drive" title="Speicher" sub="deine Uploads">
  <div class="num">{formatGb(storage.usedBytes)} <span>von {limit}</span></div>
  <div class="meter" data-tt={tip}>
    {#if storage.versionBytes}<i style="width: {pct(storage.versionBytes)}%; background: var(--color-series-1)"></i>{/if}
    {#if storage.stemBytes}<i style="width: {pct(storage.stemBytes)}%; background: var(--color-series-2)"></i>{/if}
  </div>
  <div class="legend">
    <span><i style="background: var(--color-series-1)"></i>Versionen {formatGb(storage.versionBytes)}</span>
    <span><i style="background: var(--color-series-2)"></i>Spuren {formatGb(storage.stemBytes)}</span>
  </div>
  {#if storage.topTracks.length}
    <ul class="top">
      {#each storage.topTracks as t (t.trackId)}
        <li><span>{t.name}</span><b>{formatGb(t.bytes)}</b></li>
      {/each}
    </ul>
  {/if}
</DashCard>

<style>
  .num {
    font-family: var(--font-display);
    font-size: 44px;
    font-weight: 800;
    font-stretch: 78%;
    color: var(--color-text-primary);
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .num span {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    font-family: var(--font-sans);
    font-weight: 500;
    letter-spacing: 0;
  }
  .meter {
    display: flex;
    gap: 2px;
    height: 10px;
    border-radius: 5px;
    overflow: hidden;
    background: var(--color-bg-subtle);
    margin: 12px 0 10px;
  }
  .meter i {
    display: block;
    height: 100%;
  }
  .top {
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }
  .top li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 0;
    border-top: 1px solid var(--color-border);
    color: var(--color-text-secondary);
  }
  .top b {
    color: var(--color-text-primary);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
</style>
