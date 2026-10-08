<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import TabBar from '$lib/components/ui/TabBar.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import ProjectTimeline from '$lib/components/overview/ProjectTimeline.svelte';
  import TrackRow from '$lib/components/overview/TrackRow.svelte';
  import { overviewIndex, overviewFailed, loadOverview, markTracksSeen } from '$lib/stores/overview.js';
  import { trashDaysLeft } from '$lib/utils/format.js';
  import { projectGroups, type TrackInfo } from '$lib/utils/overview.js';

  type Track = { id: string; section: string | null };

  type Group = { name: string; list: TrackInfo[] };

  function groupBySection(list: TrackInfo[]): Group[] {
    const sectionOf = new Map(tracks.map((t) => [t.id, t.section]));
    const groups = new Map<string, TrackInfo[]>();
    for (const i of list) {
      const key = sectionOf.get(i.track.id)?.trim() || 'Mainline';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    }
    // Stable order: Mainline first, then alphabetical
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === 'Mainline') return -1;
        if (b === 'Mainline') return 1;
        return a.localeCompare(b);
      })
      .map(([name, list]) => ({ name, list }));
  }

  type Project = {
    id: string;
    name: string;
    description?: string;
    coverUrl: string | null;
  };

  let project = $state<Project | null>(null);
  // What the user could restore from the project's trash, newest first
  let trash = $state<{ deletedAt: string }[]>([]);
  let role = $state('');
  let tracks = $state<Track[]>([]);
  let doneOpen = $state(false);
  // Rows showing their open comments or rejection reason
  let expanded = $state<Record<string, boolean>>({});
  let newTrackName = $state('');
  let showNewTrack = $state(false);
  let loading = $state(true);
  let creating = $state(false);

  const projectId = $page.params.projectId;

  // Stand and turn of every track come from the overview, the sections from the track list
  const ix = $derived($overviewIndex);
  const group = $derived(ix ? projectGroups(ix).find((g) => g.project.id === projectId) : undefined);
  const sections = $derived(group ? groupBySection(group.active) : []);
  const view = $derived($page.url.searchParams.get('view') === 'timeline' ? 'timeline' : 'tracks');

  function setView(id: string) {
    void goto(id === 'timeline' ? '?view=timeline' : $page.url.pathname, { replaceState: true, noScroll: true, keepFocus: true });
  }

  // New markers count from the last visit; leaving the project ends this one
  onDestroy(() => {
    void markTracksSeen();
  });

  onMount(async () => {
    void loadOverview(true);
    try {
      const [projectRes, trackRes] = await Promise.all([
        api.get<{ project: Project; role: string }>(`/projects/${projectId}`),
        api.get<{ tracks: Track[] }>(`/tracks/project/${projectId}`),
      ]);
      project = projectRes.project;
      role = projectRes.role;
      tracks = trackRes.tracks;
    } finally {
      loading = false;
    }
    const trashRes = await api.get<{ entries: { deletedAt: string }[] }>(`/trash/project/${projectId}`, true).catch(() => null);
    trash = trashRes?.entries ?? [];
  });

  async function createTrack() {
    if (!newTrackName.trim()) return;
    creating = true;
    try {
      const res = await api.post<{ track: Track }>(`/tracks/${projectId}`, {
        name: newTrackName,
      });
      tracks = [...tracks, res.track];
      void loadOverview(true);
      newTrackName = '';
      showNewTrack = false;
      toastSuccess('Track angelegt');
    } finally {
      creating = false;
    }
  }

  const canUpload = $derived(role === 'owner' || role.includes('engineer'));
</script>

<TopBar
  crumbs={[
    { label: 'Projekte', href: '/dashboard' },
    { label: project?.name ?? '…' },
  ]}
>
  {#snippet actions()}
    {#if !loading && (role === 'owner' || role === 'management')}
      <Button variant="ghost" size="sm" href="/projects/{projectId}/settings">Einstellungen</Button>
    {/if}
    {#if canUpload}
      <Button size="sm" onclick={() => showNewTrack = !showNewTrack}>
        {showNewTrack ? 'Abbrechen' : 'Neuer Track'}
      </Button>
    {/if}
  {/snippet}
</TopBar>

<div class="project-page">
  <header>
    {#if loading}
      <Skeleton width="200px" height="2rem" />
    {:else if project}
      <div class="project-head">
        <CoverImage src={project.coverUrl} name={project.name} size="lg" rounded="lg" />
        <div>
          <h1>{project.name}</h1>
          {#if project.description}
            <p class="description">{project.description}</p>
          {/if}
        </div>
      </div>
    {/if}
  </header>

  {#if showNewTrack}
    <form class="new-track-form" onsubmit={(e) => { e.preventDefault(); createTrack(); }}>
      <Input bind:value={newTrackName} placeholder="Track-Name" autofocus />
      <Button type="submit" loading={creating}>Anlegen</Button>
    </form>
  {/if}

  <div class="tabs">
    <TabBar
      tabs={[
        { id: 'tracks', label: 'Tracks', count: loading ? undefined : tracks.length },
        { id: 'timeline', label: 'Timeline' },
      ]}
      active={view}
      onselect={setView}
    />
  </div>

  {#if loading || (!ix && !$overviewFailed)}
    <div class="loading">
      <Skeleton height="4rem" variant="rect" />
      <Skeleton height="4rem" variant="rect" />
    </div>
  {:else if !ix}
    <LoadFailed />
  {:else if !group?.list.length}
    <EmptyState
      title="Noch keine Tracks"
      description="Lege einen Track an und lade dein erstes Audio hoch."
    >
      {#snippet action()}
        {#if canUpload && !showNewTrack}
          <Button onclick={() => (showNewTrack = true)}>Neuer Track</Button>
        {/if}
      {/snippet}
    </EmptyState>
  {:else if view === 'timeline'}
    <ProjectTimeline {ix} list={group.list} />
  {:else}
    <div class="cols" aria-hidden="true"><span>Track</span><span>Neueste Version</span><span>Stand</span><span>Zuletzt</span></div>
    {#each sections as section (section.name)}
      <section class="section">
        {#if sections.length > 1}
          <h2 class="section-title">
            {section.name}
            <span class="section-count">{section.list.length}</span>
          </h2>
        {/if}
        {@render rows(section.list)}
      </section>
    {/each}
    {#if group.done.length}
      <section class="section">
        <button type="button" class="more" aria-expanded={doneOpen} onclick={() => (doneOpen = !doneOpen)}>
          <Icon name={doneOpen ? 'chevron-down' : 'chevron-right'} size={14} />
          {group.done.length === 1 ? '1 fertiger Track' : `${group.done.length} fertige Tracks`}
        </button>
        {#if doneOpen}{@render rows(group.done)}{/if}
      </section>
    {/if}
  {/if}

  {#if trash.length > 0}
    {@const daysLeft = trashDaysLeft(trash[trash.length - 1].deletedAt)}
    <a href="/projects/{projectId}/trash" class="trash-link">
      <span class="trash-icon"><Icon name="trash" size={16} /></span>
      <span class="trash-text">
        <b>Papierkorb</b>
        <small>
          {trash.length === 1 ? '1 Eintrag · noch' : `${trash.length} Einträge · der älteste noch`}
          {daysLeft} {daysLeft === 1 ? 'Tag' : 'Tage'}
        </small>
      </span>
      <Icon name="chevron-right" size={16} />
    </a>
  {/if}
</div>

{#snippet rows(list: TrackInfo[])}
  {#each list as info, k (info.track.id)}
    {#if k}<div class="sep"></div>{/if}
    <TrackRow ix={ix!} {info} expanded={!!expanded[info.track.id]} ontoggle={() => (expanded = { ...expanded, [info.track.id]: !expanded[info.track.id] })} />
  {/each}
{/snippet}

<style>
  .project-page {
    padding: var(--space-6) var(--space-6) var(--space-12);
    max-width: 1100px;
    --track-cols: minmax(185px, 1.15fr) minmax(200px, 1.75fr) minmax(200px, 1.2fr) minmax(130px, 0.8fr);
  }
  @media (max-width: 640px) {
    .project-page {
      padding: var(--space-4) var(--space-4) var(--space-12);
    }
  }

  header {
    margin-bottom: var(--space-5);
  }
  .project-head {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    flex-wrap: wrap;
  }
  .project-head > div {
    min-width: 0;
    flex: 1 1 240px;
  }
  @media (max-width: 540px) {
    .project-head {
      gap: var(--space-3);
    }
    h1 {
      font-size: var(--text-xl);
    }
  }

  h1 {
    margin: 0;
    font-size: var(--text-2xl);
  }

  .description {
    color: var(--color-text-secondary);
    margin: var(--space-1) 0 0;
  }

  .section {
    margin-bottom: var(--space-6);
  }
  .section-title {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-tertiary);
    font-weight: 600;
    margin: 0 0 var(--space-2);
    padding: 0 var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .section-count {
    background: var(--color-bg-subtle);
    color: var(--color-text-tertiary);
    padding: 1px 7px;
    border-radius: var(--radius-full);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0;
  }

  .new-track-form {
    display: flex;
    gap: var(--space-3);
    margin-bottom: var(--space-6);
    align-items: flex-start;
  }

  .new-track-form :global(.input-group) {
    flex: 1;
  }








  .tabs {
    margin-bottom: var(--space-5);
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
  .sep {
    height: 1px;
    background: var(--color-border);
    margin: 0 var(--space-3);
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
  @media (max-width: 640px) {
    .cols {
      display: none;
    }
    .sep {
      margin: 0 var(--space-1);
    }
  }

  .trash-link {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px dashed var(--color-border-hover);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    text-decoration: none;
  }
  .trash-link:hover {
    border-color: var(--color-text-tertiary);
    color: var(--color-text-primary);
  }
  .trash-icon {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
  }
  .trash-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .trash-text b {
    color: var(--color-text-primary);
    font-weight: 500;
    font-size: var(--text-sm);
  }
  .trash-text small {
    font-size: var(--text-xs);
  }

</style>
