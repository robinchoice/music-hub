<script lang="ts">
  import { onMount, getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/index.js';
  import { api } from '$lib/api/client.js';
  import { toast } from '$lib/stores/toast.js';
  import { loadOverview } from '$lib/stores/overview.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import { timeAgo } from '$lib/utils/format.js';

  type Membership = {
    project: { id: string; name: string; artist: string | null; coverUrl: string | null; updatedAt: string };
    role: string;
    trackCount: number;
  };

  const reloadSidebar = getContext<(() => void) | undefined>('reloadSidebar');

  let memberships = $state<Membership[]>([]);
  let loading = $state(true);
  let restoring = $state<string | null>(null);

  onMount(async () => {
    try {
      const res = await api.get<{ projects: Membership[] }>('/projects?archived=1');
      // Newest first, archiving sets updatedAt
      memberships = res.projects.sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt));
    } finally {
      loading = false;
    }
  });

  async function restore(m: Membership) {
    restoring = m.project.id;
    try {
      await api.post(`/projects/${m.project.id}/restore`);
      memberships = memberships.filter((x) => x.project.id !== m.project.id);
      reloadSidebar?.();
      void loadOverview();
      toast(t().workspace.archivePage.restored(m.project.name), 'success', 6000, { label: t().common.open, run: () => goto(`/projects/${m.project.id}`) });
    } catch {
      // The API client already showed the error
    } finally {
      restoring = null;
    }
  }
</script>

<TopBar crumbs={[{ label: t().workspace.nav.archive }]} />

<div class="archive-page">
  <header class="head">
    <span class="head-icon"><Icon name="archive" size={24} /></span>
    <div>
      <h1>{t().workspace.nav.archive}</h1>
      <p>{t().workspace.archivePage.intro}</p>
      <p>{t().workspace.archivePage.storage}</p>
    </div>
  </header>

  {#if loading}
    <div class="list">
      {#each [1, 2] as _}
        <div class="row"><Skeleton width="50%" height="1rem" /></div>
      {/each}
    </div>
  {:else if memberships.length === 0}
    <div class="empty">
      <Icon name="archive" size={28} />
      <b>{t().workspace.archivePage.emptyTitle}</b>
      <p>{t().workspace.archivePage.emptyText}</p>
    </div>
  {:else}
    <div class="list">
      {#each memberships as m (m.project.id)}
        <div class="row">
          <CoverImage src={m.project.coverUrl} name={m.project.name} size="sm" rounded="sm" />
          <div class="main">
            <div class="title">{m.project.name}</div>
            <div class="sub">
              {#if m.project.artist}<span class="artist">{m.project.artist}</span> · {/if}
              {t().workspace.archivePage.meta(m.trackCount, timeAgo(m.project.updatedAt))}
            </div>
          </div>
          {#if m.role === 'owner'}
            <Button variant="secondary" size="sm" loading={restoring === m.project.id} onclick={() => restore(m)}>
              <Icon name="restore" size={13} /> <span class="btn-label">{t().workspace.archivePage.restore}</span>
            </Button>
          {:else}
            <span class="note">{t().workspace.archivePage.ownerOnly}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .archive-page {
    padding: var(--space-6) var(--space-6) var(--space-12);
    max-width: 1000px;
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }

  .head-icon {
    width: 56px;
    height: 56px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-raised);
    color: var(--color-text-secondary);
  }

  h1 {
    margin: 0;
    font-size: var(--text-2xl);
  }

  .head p {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .main {
    min-width: 0;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-primary);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .sub {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }

  .artist {
    color: var(--color-text-secondary);
    font-weight: 500;
  }

  .note {
    max-width: 18rem;
    text-align: right;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }

  .empty {
    padding: var(--space-12) var(--space-4);
    text-align: center;
    border: 1px dashed var(--color-border-hover);
    border-radius: var(--radius-lg);
  }

  .empty b {
    display: block;
    margin: var(--space-3) 0 var(--space-1);
    color: var(--color-text-primary);
    font-weight: 600;
  }

  .empty p {
    margin: 0;
    font-size: var(--text-sm);
  }

  @media (max-width: 640px) {
    .archive-page {
      padding: var(--space-4) var(--space-4) var(--space-12);
    }
  }

  @media (max-width: 540px) {
    .head-icon {
      display: none;
    }

    h1 {
      font-size: var(--text-xl);
    }

    .row {
      gap: var(--space-3);
    }
  }

  @media (max-width: 480px) {
    /* Hidden from sight only, the button keeps its name for screen readers */
    .btn-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .note {
      max-width: 8rem;
    }
  }
</style>
