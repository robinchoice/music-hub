<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import ActivityItem from '$lib/components/dashboard/ActivityItem.svelte';
  import WelcomeModal from '$lib/components/dashboard/WelcomeModal.svelte';
  import { timeAgo } from '$lib/utils/format.js';

  type ProjectMembership = {
    project: { id: string; name: string; description?: string; updatedAt: string; coverUrl: string | null };
    role: string;
    trackCount: number;
  };

  type Event = {
    type: 'comment' | 'version' | 'approval';
    id: string;
    createdAt: string;
    user: { id: string | null; name: string; avatarUrl: string | null } | null;
    guestName: string | null;
    project: { id: string; name: string };
    track: { id: string; name: string };
    version?: { id: string; versionNumber: number; label: string | null };
    body?: string;
    status?: string;
    timestampSeconds?: number | null;
  };

  let projects = $state<ProjectMembership[]>([]);
  let events = $state<Event[]>([]);
  let loading = $state(true);
  let welcomeOpen = $state(false);

  onMount(async () => {
    try {
      const [pRes, aRes] = await Promise.all([
        api.get<{ projects: ProjectMembership[] }>('/projects'),
        api.get<{ events: Event[] }>('/activity?limit=40'),
      ]);
      projects = pRes.projects;
      events = aRes.events;

      if (projects.length === 0) {
        const dismissed = typeof localStorage !== 'undefined' && localStorage.getItem('welcome-dismissed') === '1';
        if (!dismissed) welcomeOpen = true;
      }
    } finally {
      loading = false;
    }
  });

  $effect(() => {
    if (!welcomeOpen && typeof localStorage !== 'undefined' && projects.length === 0) {
      // Don't dismiss permanently if user hasn't acted — leave it for next visit if zero projects
    }
  });

  // Group events by day bucket
  const groupedEvents = $derived.by(() => {
    const now = Date.now();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 7);

    const buckets: { name: string; events: Event[] }[] = [
      { name: 'Heute', events: [] },
      { name: 'Gestern', events: [] },
      { name: 'Diese Woche', events: [] },
      { name: 'Älter', events: [] },
    ];

    for (const e of events) {
      const t = new Date(e.createdAt).getTime();
      if (t >= startOfToday.getTime()) buckets[0].events.push(e);
      else if (t >= startOfYesterday.getTime()) buckets[1].events.push(e);
      else if (t >= startOfWeek.getTime()) buckets[2].events.push(e);
      else buckets[3].events.push(e);
    }
    return buckets.filter((b) => b.events.length > 0);
  });
</script>

<TopBar crumbs={[{ label: 'Übersicht' }]}>
  {#snippet actions()}
    <Button href="/projects/new" size="sm">Neues Projekt</Button>
  {/snippet}
</TopBar>

<div class="content">
  <div class="header">
    <h1>Übersicht</h1>
    <p class="sub">Was zuletzt in deinen Projekten passiert ist.</p>
  </div>

  {#if loading}
    <div class="loading">
      <Skeleton width="40%" height="1rem" />
      <Skeleton width="80%" height="3rem" variant="rect" />
      <Skeleton width="80%" height="3rem" variant="rect" />
      <Skeleton width="80%" height="3rem" variant="rect" />
    </div>
  {:else if events.length === 0 && projects.length === 0}
    <div class="empty">
      <h2>Noch nichts hier.</h2>
      <p>Lade dir ein Demo-Projekt oder leg gleich los.</p>
      <div class="empty-cta">
        <Button onclick={() => (welcomeOpen = true)}>Demo laden</Button>
        <Button variant="ghost" href="/projects/new">Eigenes Projekt</Button>
      </div>
    </div>
  {:else}
    {#if events.length > 0}
      <section class="activity">
        {#each groupedEvents as bucket}
          <div class="bucket">
            <h2 class="bucket-title">{bucket.name}</h2>
            <div class="events">
              {#each bucket.events as event (event.id + event.type)}
                <ActivityItem {event} />
              {/each}
            </div>
          </div>
        {/each}
      </section>
    {/if}

    {#if projects.length > 0}
      <section class="projects-block">
        <h2 class="bucket-title">Deine Projekte</h2>
        <div class="grid">
          {#each projects as { project, trackCount }}
            <a href="/projects/{project.id}" class="card">
              <CoverImage src={project.coverUrl} name={project.name} size="md" rounded="md" />
              <div class="card-body">
                <div class="card-name">{project.name}</div>
                <div class="card-meta">
                  {trackCount} {trackCount === 1 ? 'Track' : 'Tracks'} · {timeAgo(project.updatedAt)}
                </div>
              </div>
            </a>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<WelcomeModal bind:open={welcomeOpen} />

<style>
  .content {
    padding: var(--space-6);
    max-width: 920px;
    width: 100%;
  }
  @media (max-width: 640px) {
    .content {
      padding: var(--space-4);
    }
    .header {
      margin-bottom: var(--space-5);
    }
    h1 {
      font-size: var(--text-xl);
    }
  }
  .header {
    margin-bottom: var(--space-8);
  }
  h1 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-2xl);
  }
  .sub {
    color: var(--color-text-tertiary);
    margin: 0;
    font-size: var(--text-sm);
  }

  .loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .empty {
    text-align: center;
    padding: var(--space-12) var(--space-4);
  }
  .empty h2 {
    font-size: var(--text-xl);
    margin: 0 0 var(--space-2);
  }
  .empty p {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-5);
  }
  .empty-cta {
    display: flex;
    justify-content: center;
    gap: var(--space-3);
  }

  .activity {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin-bottom: var(--space-12);
  }
  .bucket-title {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-tertiary);
    font-weight: 600;
    margin: 0 0 var(--space-3);
  }
  .events {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .projects-block {
    margin-top: var(--space-8);
    padding-top: var(--space-8);
    border-top: 1px solid var(--color-border);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  .card {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    transition: all var(--transition-fast);
  }
  .card:hover {
    border-color: var(--color-border-hover);
    transform: translateY(-1px);
  }
  .card-body {
    flex: 1;
    min-width: 0;
  }
  .card-name {
    color: var(--color-text-primary);
    font-weight: 500;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-meta {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    margin-top: 2px;
  }

  @media (max-width: 640px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
