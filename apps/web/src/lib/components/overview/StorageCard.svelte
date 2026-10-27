<script lang="ts">
  import { t } from '$lib/i18n/index.js';
  import DashCard from './DashCard.svelte';
  import { formatGb, formatGbSplit } from '$lib/utils/format.js';
  import type { OverviewStorage } from '$lib/utils/overview.js';

  let { storage }: { storage: OverviewStorage } = $props();

  const pct = (bytes: number) => (bytes / storage.limitBytes) * 100;
  const [versions, stems] = $derived(formatGbSplit(storage.usedBytes, storage.versionBytes));
  const limit = $derived(`${Math.round(storage.limitBytes / 1024 ** 3)} GB`);
  const tip = $derived(
    t().overview.storage.tip(formatGb(storage.usedBytes), limit, Math.round(pct(storage.usedBytes)), versions, stems),
  );
</script>

<DashCard icon="drive" title={t().overview.storage.title} sub={t().overview.storage.sub}>
  <div class="num">{formatGb(storage.usedBytes)} <span>{t().overview.storage.of(limit)}</span></div>
  <div class="meter" data-tt={tip}>
    {#if storage.versionBytes}<i style="width: {pct(storage.versionBytes)}%; background: var(--color-series-1)"></i>{/if}
    {#if storage.stemBytes}<i style="width: {pct(storage.stemBytes)}%; background: var(--color-series-2)"></i>{/if}
  </div>
  <div class="legend">
    <span><i style="background: var(--color-series-1)"></i>{t().overview.storage.versions(versions)}</span>
    <span><i style="background: var(--color-series-2)"></i>{t().overview.storage.stems(stems)}</span>
  </div>
  {#if storage.topTracks.length}
    <ul class="top">
      {#each storage.topTracks as top (top.trackId)}
        <li><span>{top.name}</span><b>{formatGb(top.bytes)}</b></li>
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
