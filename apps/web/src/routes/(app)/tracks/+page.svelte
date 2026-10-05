<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import TrackRow from '$lib/components/overview/TrackRow.svelte';
  import { overviewIndex, overviewFailed, loadOverview, markTracksSeen } from '$lib/stores/overview.js';
  import { projectGroups, type ProjectGroup, type TrackInfo } from '$lib/utils/overview.js';

  onMount(() => {
    void loadOverview(true);
  });
  // New markers count from the last visit; leaving the page ends this one
  onDestroy(() => {
    void markTracksSeen();
  });

  type Filter = 'all' | 'mine' | 'new';
  let filter = $state<Filter>('all');
  // Rows showing their open comments or rejection reason
  let expanded = $state<Record<string, boolean>>({});
  // Projects showing their finished tracks
  let doneOpen = $state<Record<string, boolean>>({});

  const ix = $derived($overviewIndex);
  const groups = $derived(ix ? projectGroups(ix).filter((g) => g.list.length) : []);
  const all = $derived(groups.flatMap((g) => g.list));
  const counts = $derived({ mine: all.filter((i) => i.mine).length, new: all.filter((i) => i.isNew).length });
  const pass = (i: TrackInfo) => (filter === 'mine' ? i.mine : filter === 'new' ? i.isNew : true);
  const flip = (map: Record<string, boolean>, key: string) => ({ ...map, [key]: !map[key] });
  const tracksText = (n: number) => (n === 1 ? '1 Track' : `${n} Tracks`);
</script>

<TopBar crumbs={[{ label: 'Tracks' }]} />

<div class="page">
  <div class="head">
    <h1>Tracks</h1>
    <div class="filters">
      <button type="button" class="chip" class:on={filter === 'all'} onclick={() => (filter = 'all')}>Alle</button>
      <button type="button" class="chip" class:on={filter === 'mine'} onclick={() => (filter = 'mine')}>Du bist dran <b>{counts.mine}</b></button>
      <button type="button" class="chip" class:on={filter === 'new'} onclick={() => (filter = 'new')}>Neu <b>{counts.new}</b></button>
    </div>
  </div>

  {#if !ix && $overviewFailed}
    <LoadFailed />
  {:else if !ix}
    <div class="loading">
      <Skeleton height="4rem" variant="rect" />
      <Skeleton height="4rem" variant="rect" />
      <Skeleton height="4rem" variant="rect" />
    </div>
  {:else if !groups.length}
    <EmptyState title="Noch keine Tracks" description="Sobald ein Projekt Tracks hat, steht hier, wo jeder steht und wer dran ist.">
      {#snippet action()}
        <Button href="/projects/new">Neues Projekt</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="cols" aria-hidden="true"><span>Track</span><span>Neueste Version</span><span>Stand</span><span>Zuletzt</span></div>
    {#each groups as g (g.project.id)}
      {@const list = filter === 'all' ? g.active : g.list.filter(pass)}
      {#if filter === 'all' && !g.active.length}
        <!-- Projects with only finished tracks stay folded -->
        <section class="group">
          <button type="button" class="ghead" aria-expanded={!!doneOpen[g.project.id]} onclick={() => (doneOpen = flip(doneOpen, g.project.id))}>
            {@render groupHead(g)}
            <span class="gcount">
              {g.done.length === 1 ? '1 Track, fertig' : `${g.done.length} Tracks, alle fertig`}
              <Icon name={doneOpen[g.project.id] ? 'chevron-down' : 'chevron-right'} size={13} />
            </span>
          </button>
          {#if doneOpen[g.project.id]}{@render rows(g.done)}{/if}
        </section>
      {:else if list.length}
        <section class="group">
          <div class="ghead">
            {@render groupHead(g)}
            {#if filter === 'all'}<span class="gcount">{tracksText(g.list.length)}</span>{/if}
          </div>
          {@render rows(list)}
          {#if filter === 'all' && g.done.length}
            <button type="button" class="more" aria-expanded={!!doneOpen[g.project.id]} onclick={() => (doneOpen = flip(doneOpen, g.project.id))}>
              <Icon name={doneOpen[g.project.id] ? 'chevron-down' : 'chevron-right'} size={14} />
              {g.done.length === 1 ? '1 fertiger Track' : `${g.done.length} fertige Tracks`}
            </button>
            {#if doneOpen[g.project.id]}{@render rows(g.done)}{/if}
          {/if}
        </section>
      {/if}
    {/each}
    {#if filter !== 'all' && !all.some(pass)}
      <div class="none">{filter === 'mine' ? 'Gerade wartet kein Track auf dich.' : 'Nichts Neues seit deinem letzten Besuch.'}</div>
    {/if}
  {/if}
</div>

{#snippet groupHead(g: ProjectGroup)}
  <CoverImage src={g.project.coverUrl} name={g.project.name} size="xs" rounded="sm" />
  <span class="gname">{g.project.name}</span>
  {#if g.project.artist}<span class="gartist">{g.project.artist}</span>{/if}
{/snippet}

{#snippet rows(list: TrackInfo[])}
  {#each list as info, k (info.track.id)}
    {#if k}<div class="sep"></div>{/if}
    <TrackRow ix={ix!} {info} expanded={!!expanded[info.track.id]} ontoggle={() => (expanded = flip(expanded, info.track.id))} />
  {/each}
{/snippet}

<style>
  .page {
    padding: var(--space-6);
    max-width: 1080px;
    --track-cols: minmax(185px, 1.15fr) minmax(200px, 1.75fr) minmax(200px, 1.2fr) minmax(130px, 0.8fr);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-4);
    margin-bottom: var(--space-5);
  }
  h1 {
    margin: 0;
    font-size: var(--text-xl);
    line-height: 1.25;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .chip {
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    display: inline-flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .chip:hover {
    border-color: var(--color-border-hover);
    color: var(--color-text-primary);
  }
  .chip b {
    font-weight: 600;
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .chip.on {
    background: var(--color-bg-overlay);
    border-color: var(--color-border-hover);
    color: var(--color-text-primary);
  }
  .chip.on b {
    color: var(--color-accent);
  }
  .loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .cols {
    display: grid;
    grid-template-columns: var(--track-cols);
    gap: var(--space-4);
    padding: 0 var(--space-3) var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .group {
    margin-bottom: var(--space-6);
  }
  .ghead {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
  }
  button.ghead {
    width: 100%;
    text-align: left;
    background: none;
    border-top: none;
    border-left: none;
    border-right: none;
    border-bottom-color: transparent;
    border-radius: var(--radius-md);
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  button.ghead:hover {
    background: var(--color-bg-raised);
  }
  .gname {
    color: var(--color-text-primary);
    font-weight: 600;
    font-size: var(--text-base);
    white-space: nowrap;
  }
  .gartist {
    min-width: 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gcount {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
  .more {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: none;
    border: none;
    border-radius: var(--radius-md);
    font: inherit;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    cursor: pointer;
  }
  .more:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-raised);
  }
  .sep {
    height: 1px;
    background: var(--color-border);
    margin: 0 var(--space-3);
  }
  .none {
    padding: var(--space-8) var(--space-4);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-lg);
  }
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
    .cols {
      display: none;
    }
    .ghead {
      padding: var(--space-2) var(--space-1);
    }
    .sep {
      margin: 0 var(--space-1);
    }
  }
</style>
