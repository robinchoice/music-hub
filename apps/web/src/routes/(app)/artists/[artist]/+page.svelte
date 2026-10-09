<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import ProjectStagesCard from '$lib/components/overview/ProjectStagesCard.svelte';
  import { overviewIndex, overviewFailed, loadOverview } from '$lib/stores/overview.js';
  import { projectGroups } from '$lib/utils/overview.js';

  onMount(() => {
    void loadOverview(true);
  });

  const artist = $derived($page.params.artist ?? '');
  const ix = $derived($overviewIndex);
  const groups = $derived(ix ? projectGroups(ix).filter((g) => g.project.artist?.trim() === artist) : []);
  const newHref = $derived(`/projects/new?artist=${encodeURIComponent(artist)}`);
</script>

<TopBar crumbs={[{ label: 'Übersicht', href: '/dashboard' }, { label: artist }]}>
  {#snippet actions()}
    <Button href={newHref} size="sm">Neues Projekt</Button>
  {/snippet}
</TopBar>

<div class="page">
  <h1>{artist}</h1>
  {#if !ix && $overviewFailed}
    <LoadFailed />
  {:else if !ix}
    <Skeleton height="10rem" variant="rect" />
  {:else if !groups.length}
    <EmptyState title="Keine Projekte" description="Für {artist} gibt es noch kein Projekt.">
      {#snippet action()}
        <Button href={newHref}>Neues Projekt</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <ProjectStagesCard {groups} />
  {/if}
</div>

<style>
  .page {
    padding: var(--space-6);
    max-width: 960px;
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
