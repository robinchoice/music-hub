<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import DashCard from './DashCard.svelte';
  import { formatTime, formatWhen } from '$lib/utils/format.js';
  import type { OverviewIndex } from '$lib/utils/overview.js';

  let { ix }: { ix: OverviewIndex } = $props();

  // Per listener and shared version, the latest four
  const rows = $derived(
    ix.data.listens
      .flatMap((l) => {
        const version = ix.versions.get(l.versionId);
        const track = version ? ix.tracks.get(version.trackId) : undefined;
        return version && track ? [{ ...l, version, track, name: l.listenerName ?? 'Gast' }] : [];
      })
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
      .slice(0, 4),
  );
  const share = (seconds: number, duration: number | null) => (duration ? Math.min(1, seconds / duration) : 0);
</script>

<DashCard icon="headphones" title="Per Link gehört" sub={rows.length ? 'geteilte Versionen' : ''}>
  {#each rows as r (`${r.versionId}:${r.listenerName}`)}
    <div class="row">
      <Avatar name={r.name} size="sm" />
      <div class="main">
        <div><b>{r.name}</b> · {r.track.name} <span class="vchip">V{r.version.versionNumber}</span></div>
        <div class="meta">
          {r.fullPlays ? `${r.plays}× gehört, ${r.fullPlays}× ganz` : `${r.plays}× gehört, bis ${formatTime(r.maxSeconds)}`}
        </div>
        <div
          class="bar"
          data-tt="{r.name} hat {r.track.name} V{r.version.versionNumber} bis {formatTime(r.maxSeconds)}{r.version.duration ? ` von ${formatTime(r.version.duration)}` : ''} gehört"
        >
          <i style="width: {Math.round(share(r.maxSeconds, r.version.duration) * 100)}%"></i>
        </div>
      </div>
      <span class="when">{formatWhen(r.lastAt)}</span>
    </div>
  {:else}
    <p class="empty">Noch hat niemand über einen geteilten Link reingehört.</p>
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
