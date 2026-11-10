<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/index.js';
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import FolderList from '$lib/components/workspace/FolderList.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import { overviewIndex, overviewFailed, loadOverview } from '$lib/stores/overview.js';
  import { projectGroups } from '$lib/utils/overview.js';
  import { artistOf, musicCrumbs, projectFolder } from '$lib/utils/music.js';

  onMount(() => {
    void loadOverview(true);
  });

  const artist = $derived($page.params.artist ?? '');
  const ix = $derived($overviewIndex);
  const folders = $derived(
    ix ? projectGroups(ix).filter((g) => artistOf(g.project) === artist).map(projectFolder).sort((a, b) => a.name.localeCompare(b.name)) : [],
  );
  const newHref = $derived(`/projects/new?artist=${encodeURIComponent(artist)}`);
  const crumbs = $derived(musicCrumbs(artist));
</script>

<TopBar {crumbs}>
  {#snippet actions()}
    <Button href={newHref} size="sm">{t().workspace.sidebar.newProject}</Button>
  {/snippet}
</TopBar>

<div class="page">
  <h1>{artist}</h1>
  {#if !ix && $overviewFailed}
    <LoadFailed />
  {:else if !ix}
    <Skeleton height="10rem" variant="rect" />
  {:else if !folders.length}
    <EmptyState title={t().workspace.artistPage.emptyTitle} description={t().workspace.artistPage.emptyText(artist)}>
      {#snippet action()}
        <Button href={newHref}>{t().workspace.sidebar.newProject}</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <FolderList {folders} />
  {/if}
</div>

<style>
  .page {
    padding: var(--space-6);
    max-width: 1100px;
  }
  h1 {
    margin: 0 0 var(--space-5);
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 800;
    font-stretch: 78%;
    letter-spacing: -0.02em;
  }
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
  }
</style>
