<script lang="ts">
  import { onMount } from 'svelte';
  import { dateLocale, t } from '$lib/i18n/index.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import FirstSteps from '$lib/components/overview/FirstSteps.svelte';
  import ActivityChart from '$lib/components/overview/ActivityChart.svelte';
  import ListensCard from '$lib/components/overview/ListensCard.svelte';
  import LoudnessCard from '$lib/components/overview/LoudnessCard.svelte';
  import NewVersionsCard from '$lib/components/overview/NewVersionsCard.svelte';
  import ProjectStagesCard from '$lib/components/overview/ProjectStagesCard.svelte';
  import StorageCard from '$lib/components/overview/StorageCard.svelte';
  import TurnCard from '$lib/components/overview/TurnCard.svelte';
  import { user } from '$lib/stores/auth.js';
  import { overviewIndex, overviewFailed, tasks, loadOverview } from '$lib/stores/overview.js';
  import {
    eventsOf,
    firstName,
    freshVersions,
    isAlone,
    listenRows,
    loudnessGroups,
    projectGroups,
    turnRows,
    weekBuckets,
    weekSummary,
  } from '$lib/utils/overview.js';

  onMount(() => {
    void loadOverview(true);
  });

  const ix = $derived($overviewIndex);
  const groups = $derived(ix ? projectGroups(ix) : []);
  const events = $derived(ix ? eventsOf(ix) : []);
  const today = $derived(new Date().toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' }));

  // Until someone else is in one of your projects, three steps lead to the first feedback
  const alone = $derived(ix ? isAlone(ix) : false);
  const welcome = $derived(alone && !ix?.data.versions.length);

  // "3 neue Versionen, 12 Kommentare und eine Freigabe"; what didn't happen stays out
  const parts = $derived.by(() => {
    const w = weekSummary(events);
    const out: string[] = [];
    if (w.versions) out.push(t().overview.dashboard.newVersions(w.versions));
    if (w.comments) out.push(t().common.comments(w.comments));
    if (w.approvals) out.push(t().overview.dashboard.approvals(w.approvals));
    return out;
  });

  // Cards only appear with something to show; a lone card in a row takes the full width
  const showFresh = $derived(ix ? freshVersions(ix, groups).length > 0 : false);
  const showTurn = $derived(ix ? turnRows(ix, groups.flatMap((g) => g.list)).length > 0 : false);
  const showActivity = $derived(weekBuckets(events, 8).some((b) => b.versions || b.comments));
  const showListens = $derived(ix ? listenRows(ix).length > 0 : false);
  const showLoudness = $derived(loudnessGroups(groups).length > 0);
</script>

<TopBar crumbs={[{ label: t().overview.dashboard.title }]}>
  {#snippet actions()}
    <!-- The steps carry the main button while they show -->
    {#if !alone}<Button href="/projects/new" size="sm">{t().overview.shared.newProject}</Button>
    {:else if ix?.data.projects.length}<Button href="/projects/new" size="sm" variant="secondary">{t().overview.shared.newProject}</Button>{/if}
  {/snippet}
</TopBar>

<div class="page">
  {#if !ix && $overviewFailed}
    <LoadFailed />
  {:else if !ix}
    <div class="loading">
      <Skeleton width="40%" height="1.2rem" />
      <Skeleton height="16rem" variant="rect" />
      <Skeleton height="10rem" variant="rect" />
    </div>
  {:else}
    <div class="head">
      <p class="date">{today}</p>
      <p class="sum">
        {#if welcome}
          {t().overview.dashboard.welcome($user ? firstName($user.name) : null)} <b>{t().overview.dashboard.welcomeBold}</b> {t().overview.dashboard.welcomeAfter}
        {:else if parts.length}
          {t().overview.dashboard.lastWeek}{#each parts as part, i (part)}{t().overview.dashboard.separator(i, parts.length)}<b>{part}</b>{/each}.
        {:else}
          {t().overview.dashboard.quiet}
        {/if}
        {#if alone && !welcome}{t().overview.dashboard.nobodyListens}{/if}
        {#if $tasks.length}
          <a href="/for-you">{t().overview.dashboard.tasksWaiting($tasks.length)}</a>
        {/if}
      </p>
    </div>
    {#if alone}<FirstSteps {ix} {groups} />{/if}
    {#if groups.length}
      <div class="grid">
        {#if showFresh}<NewVersionsCard {ix} {groups} span={showTurn ? 8 : 12} />{/if}
        {#if showTurn}<TurnCard {ix} {groups} span={showFresh ? 4 : 12} />{/if}
        <ProjectStagesCard {groups} span={showActivity ? 6 : 12} />
        {#if showActivity}<ActivityChart {events} />{/if}
        <!-- Storage only for members with uploads of their own -->
        {#if showListens || showLoudness || ix.data.storage.usedBytes > 0}
          <div class="row">
            {#if showListens}<ListensCard {ix} />{/if}
            {#if showLoudness}<LoudnessCard {groups} />{/if}
            {#if ix.data.storage.usedBytes > 0}<StorageCard storage={ix.data.storage} />{/if}
          </div>
        {/if}
      </div>
    {/if}
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
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
    margin: 0 0 6px;
  }
  /* The week in one sentence, the numbers stand out */
  .sum {
    margin: 0;
    max-width: 860px;
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 750;
    font-stretch: 78%;
    line-height: 1.08;
    letter-spacing: -0.02em;
    color: var(--color-text-secondary);
  }
  .sum b {
    color: var(--color-text-primary);
    font-weight: 800;
  }
  .sum a {
    color: var(--color-accent);
    text-decoration: none;
  }
  .sum a:hover {
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 4px;
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
      font-size: 1.5rem;
    }
  }
</style>
