<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { user, logout } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';

  type ProjectMembership = {
    project: { id: string; name: string; description?: string; createdAt: string };
    role: string;
  };

  let projects = $state<ProjectMembership[]>([]);
  let loading = $state(true);

  $effect(() => {
    if (!$user) goto('/');
  });

  onMount(async () => {
    try {
      const res = await api.get<{ projects: ProjectMembership[] }>('/projects');
      projects = res.projects;
    } finally {
      loading = false;
    }
  });

  async function handleLogout() {
    await logout();
    goto('/');
  }
</script>

<div class="dashboard">
  <header>
    <h1>Music Hub</h1>
    <div class="header-right">
      {#if $user}
        <Avatar name={$user.name} src={$user.avatarUrl ?? null} size="sm" />
        <span class="user-name">{$user.name}</span>
      {/if}
      <Button variant="ghost" size="sm" onclick={handleLogout}>Logout</Button>
    </div>
  </header>

  <main>
    <div class="section-header">
      <h2>Projects</h2>
      <Button href="/projects/new">New Project</Button>
    </div>

    {#if loading}
      <div class="project-grid">
        {#each [1, 2, 3] as _}
          <div class="project-card skeleton-card">
            <Skeleton width="60%" height="1.2rem" />
            <Skeleton width="80%" height="0.9rem" />
            <Skeleton width="5rem" height="1.2rem" />
          </div>
        {/each}
      </div>
    {:else if projects.length === 0}
      <EmptyState
        icon="🎵"
        title="No projects yet"
        description="Create your first project to start collaborating."
      >
        {#snippet action()}
          <Button href="/projects/new">Create Project</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="project-grid">
        {#each projects as { project, role }}
          <a href="/projects/{project.id}" class="project-card">
            <h3>{project.name}</h3>
            {#if project.description}
              <p class="description">{project.description}</p>
            {/if}
            <Badge>{role.replaceAll('_', ' ')}</Badge>
          </a>
        {/each}
      </div>
    {/if}
  </main>
</div>

<style>
  .dashboard {
    max-width: 1000px;
    margin: 0 auto;
    padding: var(--space-4);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-4) 0;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: var(--space-8);
  }

  header h1 {
    font-size: var(--text-xl);
    margin: 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .user-name {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-6);
  }

  h2 {
    margin: 0;
  }

  .project-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-4);
  }

  .project-card {
    background: var(--color-bg-overlay);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    text-decoration: none;
    color: inherit;
    border: 1px solid var(--color-border);
    transition: border-color var(--transition-base), box-shadow var(--transition-base);
  }

  .project-card:hover {
    border-color: var(--color-accent);
    box-shadow: var(--shadow-sm);
  }

  .project-card h3 {
    margin: 0 0 var(--space-2);
  }

  .description {
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
  }

  .skeleton-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  @media (max-width: 640px) {
    .project-grid {
      grid-template-columns: 1fr;
    }

    .user-name {
      display: none;
    }
  }
</style>
