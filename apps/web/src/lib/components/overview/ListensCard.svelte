<script lang="ts">
  import { t } from '$lib/i18n/index.js';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import DashCard from './DashCard.svelte';
  import { formatTime, formatWhen } from '$lib/utils/format.js';
  import { listenRows, type OverviewIndex } from '$lib/utils/overview.js';

  let { ix }: { ix: OverviewIndex } = $props();

  // Only shown once someone listened
  const rows = $derived(listenRows(ix));
  const share = (seconds: number, duration: number | null) => (duration ? Math.min(1, seconds / duration) : 0);
</script>

<DashCard icon="headphones" title={t().overview.listens.title} sub={t().overview.listens.sub}>
  {#each rows as r (`${r.versionId}:${r.listenerName}`)}
    <div class="row">
      <Avatar name={r.name} size="sm" />
      <div class="main">
        <div><b>{r.name}</b> · {r.track.name} <span class="vchip">V{r.version.versionNumber}</span></div>
        <div class="meta">
          {t().overview.listens.played(r.plays, r.fullPlays, formatTime(r.maxSeconds))}
        </div>
        <div
          class="bar"
          data-tt={t().overview.listens.tip(r.name, r.track.name, r.version.versionNumber, formatTime(r.maxSeconds), r.version.duration ? formatTime(r.version.duration) : null)}
        >
          <i style="width: {Math.round(share(r.maxSeconds, r.version.duration) * 100)}%"></i>
        </div>
      </div>
      <span class="when">{formatWhen(r.lastAt)}</span>
    </div>
  {/each}
</DashCard>

<style>
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: start;
    padding: 10px 0;
    border-top: 1px solid var(--color-border);
  }
  .row:first-of-type {
    border-top: 0;
    padding-top: 2px;
  }
  .main {
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .main b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .meta {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    margin-top: 1px;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--color-accent-subtle);
    margin-top: 7px;
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--color-series-1);
    border-radius: 3px;
  }
  .when {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
</style>
