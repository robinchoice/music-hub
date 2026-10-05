<script lang="ts">
  import DashCard from './DashCard.svelte';
  import { formatLufs } from '$lib/utils/format.js';
  import { loudnessGroups, versionName, type ProjectGroup, type TrackInfo } from '$lib/utils/overview.js';

  let { groups }: { groups: ProjectGroup[] } = $props();

  // Scale from −20 to −6 LUFS with the streaming reference at −14
  const LOW = -20;
  const HIGH = -6;
  const REF = -14;
  let table = $state(false);
  const rows = $derived(loudnessGroups(groups));
  const x = (lufs: number) => Math.min(100, Math.max(0, ((lufs - LOW) / (HIGH - LOW)) * 100));
  const lufsOf = (info: TrackInfo) => info.latest!.integratedLufs!;
  const tip = (info: TrackInfo) => {
    const v = info.latest!;
    return `${info.track.name} V${v.versionNumber}${versionName(v) ? ` · ${versionName(v)}` : ''}\n${formatLufs(lufsOf(info))} LUFS integriert`;
  };
</script>

<DashCard icon="gauge" title="Lautheit" sub="neueste Version, LUFS">
  {#snippet actions()}
    {#if rows.length}
      <button type="button" class="tbtn" onclick={() => (table = !table)}>{table ? 'Diagramm' : 'Tabelle'}</button>
    {/if}
  {/snippet}
  {#if !rows.length}
    <p class="empty">Noch keine gemessene Version.</p>
  {:else if table}
    <table class="mini-table">
      <thead><tr><th>Track</th><th>Version</th><th>LUFS</th></tr></thead>
      <tbody>
        {#each rows.flatMap((g) => g.rows) as info (info.track.id)}
          <tr>
            <td>{info.track.name}</td>
            <td>V{info.latest!.versionNumber}{versionName(info.latest!) ? ` · ${versionName(info.latest!)}` : ''}</td>
            <td>{formatLufs(lufsOf(info))}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <div class="row">
      <span></span>
      <div class="plot ref-head"><span class="reflbl" style="left: {x(REF)}%">−14 Streaming</span></div>
      <span></span>
    </div>
    {#each rows as g (g.project.id)}
      <p class="grp">{g.project.name}</p>
      {#each g.rows as info (info.track.id)}
        <div class="row">
          <span class="name">{info.track.name}</span>
          <div class="plot">
            <i class="axis"></i>
            <i class="ref" style="left: {x(REF)}%"></i>
            <button type="button" class="dot" style="left: {x(lufsOf(info))}%" data-tt={tip(info)} aria-label={tip(info).split('\n').join(', ')}></button>
          </div>
          <span class="val">{formatLufs(lufsOf(info))}</span>
        </div>
      {/each}
    {/each}
    <div class="row scale">
      <span></span>
      <div class="ticks">
        {#each [LOW, REF, HIGH] as t (t)}<span style="left: {x(t)}%">{formatLufs(t).replace(',0', '')}</span>{/each}
      </div>
      <span></span>
    </div>
  {/if}
</DashCard>

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(80px, 130px) minmax(0, 1fr) 46px;
    gap: 10px;
    align-items: center;
    height: 28px;
  }
  .name {
    font-size: 13px;
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .plot {
    position: relative;
    height: 100%;
  }
  .ref-head {
    height: 18px;
  }
  .axis {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: #24222e;
  }
  .ref {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: #6b6680;
  }
  .reflbl {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-size: 11px;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .dot {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--color-series-1);
    box-shadow: 0 0 0 2px var(--color-bg-raised);
    transform: translate(-50%, -50%);
    cursor: default;
  }
  .dot::after {
    content: '';
    position: absolute;
    inset: -8px;
  }
  .val {
    font-size: 12px;
    color: var(--color-text-primary);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .grp {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    margin: 10px 0 0;
    font-weight: 500;
  }
  .scale {
    height: 20px;
  }
  .ticks {
    position: relative;
    height: 18px;
    font-size: 11px;
    color: var(--color-text-axis);
    font-variant-numeric: tabular-nums;
  }
  .ticks span {
    position: absolute;
    top: 2px;
    transform: translateX(-50%);
    white-space: nowrap;
  }
</style>
