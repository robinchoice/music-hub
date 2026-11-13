<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { t } from '$lib/i18n/index.js';
  import TrackTidy from '$lib/components/workspace/TrackTidy.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { api } from '$lib/api/client.js';
  import Button from '$lib/components/ui/Button.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TrackStatusPill from '$lib/components/ui/TrackStatusPill.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import FolderList from '$lib/components/workspace/FolderList.svelte';
  import MusicViews from '$lib/components/workspace/MusicViews.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import { overviewIndex, overviewFailed, loadOverview } from '$lib/stores/overview.js';
  import { projectGroups, trackHref } from '$lib/utils/overview.js';
  import { artistOf, musicFolders, recentTracks } from '$lib/utils/music.js';
  import { formatWhen } from '$lib/utils/format.js';

  onMount(() => {
    void loadOverview(true);
  });

  const ix = $derived($overviewIndex);
  const groups = $derived(ix ? projectGroups(ix) : []);
  const folders = $derived(musicFolders(groups));
  const recent = $derived(recentTracks(groups, 6));
  let tidy = $state<TrackTidy>();
  const reloadSidebar = getContext<(() => void) | undefined>('reloadSidebar');
  async function actions(id: string, at: { x: number; y: number }) {
    const { track } = await api.get<{ track: { id: string; name: string; projectId: string; section: string | null } }>(`/tracks/${id}`);
    tidy?.menu([track], at);
  }
  async function refresh() {
    reloadSidebar?.();
    await loadOverview(true);
  }
</script>

<TopBar crumbs={[{ label: t().workspace.nav.music }]}>
  {#snippet actions()}
    <Button href="/projects/new" size="sm">{t().workspace.sidebar.newProject}</Button>
  {/snippet}
</TopBar>

<div class="page">
  <MusicViews active="folders" />
  {#if !ix && $overviewFailed}
    <LoadFailed />
  {:else if !ix}
    <Skeleton height="12rem" variant="rect" />
  {:else if !folders.length}
    <EmptyState title={t().workspace.music.emptyTitle} description={t().workspace.music.emptyText}>
      {#snippet action()}
        <Button href="/projects/new">{t().workspace.sidebar.newProject}</Button>
      {/snippet}
    </EmptyState>
  {:else}
    {#if recent.length}
      <h2>{t().workspace.music.recent}</h2>
      <ul class="recent">
        {#each recent as info (info.track.id)}
          {@const artist = artistOf(info.project)}
          <li oncontextmenu={(e) => { if (info.project.myRights?.canUpload) { e.preventDefault(); void actions(info.track.id, { x: e.clientX, y: e.clientY }); } }}>
            <a href={trackHref(info.project.id, info.track.id)}>
              <CoverImage src={info.track.coverUrl ?? info.project.coverUrl} name={info.track.name} size="md" rounded="md" />
              <span class="text">
                <b>{info.track.name}</b>
                <small>{artist ? `${artist} · ` : ''}{info.project.name}</small>
                <span class="when"><TrackStatusPill status={info.track.status} /> {formatWhen(info.last.at)}</span>
              </span>
            </a>
            {#if info.project.myRights?.canUpload}
              <button type="button" class="dots" aria-label={t().tidy.actions(info.track.name)} onclick={(e) => { const r = e.currentTarget.getBoundingClientRect(); void actions(info.track.id, { x: r.right - 240, y: r.bottom }); }}><Icon name="more" size={16} /></button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <h2>{t().workspace.music.folders}</h2>
    <FolderList {folders} />
  {/if}
</div>

<TrackTidy bind:this={tidy} onchange={refresh} />

<style>
  .recent li { position: relative; }
  .dots { position: absolute; right: 4px; top: 4px; border: none; background: var(--color-bg-raised); color: var(--color-text-secondary); border-radius: var(--radius-sm); width: 32px; height: 32px; display: grid; place-items: center; cursor: pointer; }
  .recent li:has(.dots) .text { padding-right: 24px; }
  .page {
    padding: var(--space-6);
    max-width: 1100px;
  }
  h2 {
    margin: var(--space-6) 0 var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 600;
    font-stretch: normal;
    letter-spacing: 0;
  }
  .recent {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: var(--space-2);
  }
  .recent a {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-raised);
    color: var(--color-text-secondary);
    text-decoration: none;
    min-width: 0;
    transition: border-color var(--transition-fast);
  }
  .recent a:hover {
    border-color: var(--color-border-hover);
    color: var(--color-text-secondary);
  }
  .text {
    min-width: 0;
    display: grid;
  }
  .recent b {
    color: var(--color-text-primary);
    font-weight: 600;
    font-size: var(--text-sm);
  }
  .recent b,
  .recent small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent small {
    font-size: var(--text-xs);
  }
  .when {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: 2px;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
    /* Phones swipe through the recent tracks instead of stacking them */
    .recent {
      display: flex;
      overflow-x: auto;
      margin: 0 calc(-1 * var(--space-4));
      padding: 0 var(--space-4) var(--space-1);
      scroll-snap-type: x mandatory;
      scroll-padding-inline: var(--space-4);
    }
    .recent li {
      flex: 0 0 240px;
      scroll-snap-align: start;
    }
  }
</style>
