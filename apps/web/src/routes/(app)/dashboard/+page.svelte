<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import ActivityChart from '$lib/components/overview/ActivityChart.svelte';
  import ListensCard from '$lib/components/overview/ListensCard.svelte';
  import LoudnessCard from '$lib/components/overview/LoudnessCard.svelte';
  import NewVersionsCard from '$lib/components/overview/NewVersionsCard.svelte';
  import ProjectStagesCard from '$lib/components/overview/ProjectStagesCard.svelte';
  import StorageCard from '$lib/components/overview/StorageCard.svelte';
  import TurnCard from '$lib/components/overview/TurnCard.svelte';
  import { overviewIndex, tasks, loadOverview } from '$lib/stores/overview.js';
  import { eventsOf, projectGroups, weekSummary } from '$lib/utils/overview.js';

  onMount(() => {
    void loadOverview(true);
  });

  const ix = $derived($overviewIndex);
  const groups = $derived(ix ? projectGroups(ix) : []);
  const events = $derived(ix ? eventsOf(ix) : []);
  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  // "3 neue Versionen, 12 Kommentare und eine Freigabe"
  const parts = $derived.by(() => {
    const w = weekSummary(events);
    const out = [
      w.versions === 1 ? '1 neue Version' : `${w.versions} neue Versionen`,
      w.comments === 1 ? '1 Kommentar' : `${w.comments} Kommentare`,
    ];
    if (w.approvals) out.push(w.approvals === 1 ? 'eine Freigabe' : `${w.approvals} Freigaben`);
    return out;
  });
</script>

<TopBar crumbs={[{ label: 'Übersicht' }]}>
  {#snippet actions()}
    <Button href="/projects/new" size="sm">Neues Projekt</Button>
  {/snippet}
</TopBar>

<div class="page">
  {#if !ix}
    <div class="loading">
      <Skeleton width="40%" height="1.2rem" />
      <Skeleton height="16rem" variant="rect" />
      <Skeleton height="10rem" variant="rect" />
    </div>
  {:else if !ix.data.projects.length}
    <EmptyState
      title="Noch keine Projekte"
      description="Leg ein Projekt an und lade die anderen ein. Sobald es Versionen gibt, siehst du hier, wie es um alles steht."
    >
      {#snippet action()}
        <Button href="/projects/new">Neues Projekt</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="head">
      <p class="date">{today}</p>
      <p class="sum">
        In den letzten sieben Tagen:{#each parts as part, i (part)}{i === 0 ? ' ' : i === parts.length - 1 ? ' und ' : ', '}<b>{part}</b>{/each}.
        {#if $tasks.length}
          <a href="/for-you">{$tasks.length === 1 ? 'Eine Aufgabe wartet' : `${$tasks.length} Aufgaben warten`} auf dich.</a>
        {/if}
      </p>
    </div>
    <div class="grid">
      <NewVersionsCard {ix} {groups} />
      <TurnCard {ix} {groups} />
      <ProjectStagesCard {groups} />
      <ActivityChart {events} />
      <div class="row">
        <ListensCard {ix} />
        <LoudnessCard {groups} />
        <!-- Only for members with uploads of their own -->
        {#if ix.data.storage.usedBytes > 0}<StorageCard storage={ix.data.storage} />{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    padding: var(--space-6);
  }
  .loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .head {
    margin-bottom: var(--space-5);
  }
  .date {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    margin: 0 0 4px;
  }
  .sum {
    margin: 0;
    max-width: 820px;
    font-size: var(--text-lg);
    line-height: 1.45;
    letter-spacing: -0.01em;
    color: var(--color-text-secondary);
  }
  .sum b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .sum a {
    color: var(--color-text-primary);
    text-decoration: underline;
    text-decoration-color: rgba(244, 63, 94, 0.6);
    text-underline-offset: 3px;
    text-decoration-thickness: 2px;
  }
  .sum a:hover {
    text-decoration-color: var(--color-accent);
  }
  /* 12 columns across the full width; one column on narrow screens */
  .grid {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--space-4);
    align-items: stretch;
  }
  .row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
    gap: var(--space-4);
    align-items: start;
  }
  @media (max-width: 880px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
    .sum {
      font-size: var(--text-base);
    }
  }
</style>
