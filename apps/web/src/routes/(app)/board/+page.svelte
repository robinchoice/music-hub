<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/index.js';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import TrackBoard from '$lib/components/overview/TrackBoard.svelte';
  import { overviewIndex, overviewFailed, loadOverview } from '$lib/stores/overview.js';
  import { projectGroups } from '$lib/utils/overview.js';

  onMount(() => {
    void loadOverview(true);
  });

  const ix = $derived($overviewIndex);
  // Most recently active projects first, as on the overview
  const groups = $derived(ix ? projectGroups(ix) : []);
  // Filters live in the URL, so a reload or a shared link keeps them
  const projectId = $derived($page.url.searchParams.get('p'));
  const mine = $derived($page.url.searchParams.get('dran') === '1');
  const chosen = $derived(groups.find((g) => g.project.id === projectId));
  const infos = $derived((chosen ? [chosen] : groups).flatMap((g) => g.list).filter((i) => !mine || i.mine));

  function setFilter(p: string | null, dran: boolean) {
    const params = new URLSearchParams();
    if (p) params.set('p', p);
    if (dran) params.set('dran', '1');
    const query = params.toString();
    void goto(query ? `?${query}` : $page.url.pathname, { replaceState: true, noScroll: true, keepFocus: true });
  }
</script>

<TopBar crumbs={[{ label: t().overview.board.title }]} />

<div class="page">
  {#if !ix && $overviewFailed}
    <LoadFailed />
  {:else if !ix}
    <Skeleton height="20rem" variant="rect" />
  {:else if !ix.data.tracks.length}
    <EmptyState title={t().workspace.projectPage.emptyTitle} description={t().workspace.projectPage.emptyDescription} />
  {:else}
    <div class="filters" role="group" aria-label={t().overview.board.filters}>
      <button type="button" class="chip" aria-pressed={!chosen} onclick={() => setFilter(null, mine)}>{t().overview.board.all}</button>
      {#each groups as g (g.project.id)}
        <button type="button" class="chip" aria-pressed={chosen === g} onclick={() => setFilter(g.project.id, mine)}>{g.project.name}</button>
      {/each}
      <span class="sep" aria-hidden="true"></span>
      <button type="button" class="chip" aria-pressed={mine} onclick={() => setFilter(chosen?.project.id ?? null, !mine)}>
        <span class="turn-dot" aria-hidden="true"></span>{t().overview.board.mine}
      </button>
    </div>
    {#if mine && !infos.length}
      <p class="none">{t().overview.board.emptyMine}</p>
    {:else}
      <TrackBoard {ix} {infos} showProject={!chosen && groups.length > 1} />
    {/if}
  {/if}
</div>

<style>
  .page {
    padding: var(--space-6);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: var(--space-4);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .chip:hover {
    color: var(--color-text-primary);
  }
  .chip[aria-pressed='true'] {
    background: var(--color-text-primary);
    border-color: var(--color-text-primary);
    color: var(--color-bg-base);
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--color-border-hover);
  }
  .turn-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-warning);
  }
  .none {
    color: var(--color-text-secondary);
  }
  @media (max-width: 720px) {
    .page {
      padding: var(--space-4);
    }
    .sep {
      display: none;
    }
  }
</style>
