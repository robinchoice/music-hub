<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';

  type Track = {
    id: string;
    name: string;
    description?: string;
    createdAt: string;
  };

  type Project = {
    id: string;
    name: string;
    description?: string;
  };

  let project = $state<Project | null>(null);
  let role = $state('');
  let tracks = $state<Track[]>([]);
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
      toastSuccess('Track created');
    } finally {
      creating = false;
    }
  }

  const canUpload = $derived(role === 'owner' || role.includes('engineer'));
</script>

<div class="project-page">
  <header>
    <a href="/dashboard" class="back">&larr; Projects</a>
    {#if loading}
      <Skeleton width="200px" height="2rem" />
    {:else if project}
      <div class="project-header">
        <h1>{project.name}</h1>
        {#if role === 'owner' || role === 'management'}
          <Button variant="ghost" size="sm" href="/projects/{projectId}/settings">Settings</Button>
        {/if}
      </div>
      {#if project.description}
        <p class="description">{project.description}</p>
      {/if}
    {/if}
  </header>

  <div class="section-header">
    <h2>Tracks</h2>
    {#if canUpload}
      <Button variant="secondary" onclick={() => showNewTrack = !showNewTrack}>
        {showNewTrack ? 'Cancel' : 'New Track'}
      </Button>
    {/if}
  </div>

  {#if showNewTrack}
    <form class="new-track-form" onsubmit={(e) => { e.preventDefault(); createTrack(); }}>
      <Input bind:value={newTrackName} placeholder="Track name" autofocus />
      <Button type="submit" loading={creating}>Create</Button>
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
      icon="🎶"
      title="No tracks yet"
      description="Create a track and upload your first audio file."
    />
  {:else}
    <div class="track-list">
      {#each tracks as track}
        <a href="/projects/{projectId}/tracks/{track.id}" class="track-item">
          <span class="track-name">{track.name}</span>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .project-page {
    max-width: 800px;
    margin: 0 auto;
    padding: var(--space-4);
  }

  header {
    margin-bottom: var(--space-8);
  }

  .back {
    color: var(--color-text-tertiary);
    text-decoration: none;
    font-size: var(--text-sm);
  }

  .back:hover {
    color: var(--color-text-primary);
  }

  .project-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  h1 {
    margin: 0;
  }

  .description {
    color: var(--color-text-secondary);
    margin: var(--space-1) 0 0;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-4);
  }

  h2 {
    margin: 0;
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
    display: flex;
    align-items: center;
    padding: var(--space-4) var(--space-5);
    background: var(--color-bg-overlay);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    border: 1px solid var(--color-border);
    transition: border-color var(--transition-base);
  }

  .track-item:hover {
    border-color: var(--color-accent);
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
