<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import TrackStatusPill from '$lib/components/ui/TrackStatusPill.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import { timeAgo } from '$lib/utils/format.js';
  import type { TrackStatus } from '@music-hub/shared';

  type Track = {
    id: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    versionCount: number;
    branchCount: number;
    coverUrl: string | null;
    status: TrackStatus;
    section: string | null;
  };

  type Group = { name: string; tracks: Track[] };

  function groupBySection(list: Track[]): Group[] {
    const groups = new Map<string, Track[]>();
    for (const t of list) {
      const key = t.section?.trim() || 'Mainline';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    // Stable order: Mainline first, then alphabetical
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === 'Mainline') return -1;
        if (b === 'Mainline') return 1;
        return a.localeCompare(b);
      })
      .map(([name, tracks]) => ({ name, tracks }));
  }

  type Project = {
    id: string;
    name: string;
    description?: string;
    coverUrl: string | null;
  };

  let project = $state<Project | null>(null);
  let role = $state('');
  let tracks = $state<Track[]>([]);
  const grouped = $derived(groupBySection(tracks));
  let newTrackName = $state('');
  let showNewTrack = $state(false);
  let loading = $state(true);
  let creating = $state(false);

  const projectId = $page.params.projectId;

  onMount(async () => {
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
  });

  async function createTrack() {
    if (!newTrackName.trim()) return;
    creating = true;
    try {
      const res = await api.post<{ track: Track }>(`/tracks/${projectId}`, {
        name: newTrackName,
      });
      tracks = [...tracks, res.track];
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

  {#if loading}
    <div class="track-list">
      {#each [1, 2] as _}
        <div class="track-item-skeleton">
          <Skeleton width="40%" height="1rem" />
        </div>
      {/each}
    </div>
  {:else if tracks.length === 0}
    <EmptyState
      title="Noch keine Tracks"
      description="Lege einen Track an und lade dein erstes Audio hoch."
    />
  {:else}
    {#each grouped as group}
      <section class="section">
        <h2 class="section-title">
          {group.name}
          <span class="section-count">{group.tracks.length}</span>
        </h2>
        <div class="track-list">
          {#each group.tracks as track}
            <a href="/projects/{projectId}/tracks/{track.id}" class="track-item">
              <CoverImage src={track.coverUrl} name={track.name} size="sm" rounded="sm" />
              <span class="track-name">{track.name}</span>
              <TrackStatusPill status={track.status} />
              <span class="track-meta">
                {track.versionCount} {track.versionCount === 1 ? 'Version' : 'Versionen'}
                {#if track.branchCount > 0}
                  <span class="branch-pill"><Icon name="git-branch" size={11} /> {track.branchCount} {track.branchCount === 1 ? 'Variante' : 'Varianten'}</span>
                {/if}
              </span>
              <span class="track-time">{timeAgo(track.updatedAt)}</span>
            </a>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
</div>

<style>
  .project-page {
    padding: var(--space-6) var(--space-6) var(--space-12);
    max-width: 1100px;
  }
  @media (max-width: 640px) {
    .project-page {
      padding: var(--space-4) var(--space-4) var(--space-12);
    }
  }

  header {
    margin-bottom: var(--space-8);
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
    margin-bottom: var(--space-8);
  }
  .section-title {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-tertiary);
    font-weight: 600;
    margin: 0 0 var(--space-3);
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

  .track-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .track-item {
    display: grid;
    grid-template-columns: auto 1fr auto auto auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-overlay);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    border: 1px solid var(--color-border);
    transition: all var(--transition-base);
  }

  .track-meta {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  @media (max-width: 720px) {
    .track-item {
      grid-template-columns: auto 1fr auto;
      grid-template-areas:
        'cover name status'
        'cover meta time';
      row-gap: 4px;
    }
    .track-item :global(.cover) { grid-area: cover; }
    .track-item .track-name { grid-area: name; }
    .track-item :global(.pill) { grid-area: status; justify-self: end; }
    .track-item .track-meta { grid-area: meta; margin-left: 0; }
    .track-item .track-time { grid-area: time; min-width: auto; }
  }

  .branch-pill {
    background: var(--color-accent-subtle);
    border: 1px solid rgba(244, 63, 94, 0.4);
    color: #fb923c;
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  .track-time {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    min-width: 80px;
    text-align: right;
  }

  .track-item:hover {
    border-color: var(--color-border-hover);
    background: var(--color-bg-overlay);
    transform: translateX(2px);
  }

  .track-name {
    color: var(--color-text-primary);
    font-weight: 500;
  }

  .track-item-skeleton {
    padding: var(--space-4) var(--space-5);
    background: var(--color-bg-overlay);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
  }
</style>
