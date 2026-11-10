<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n/index.js';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import FolderList from '$lib/components/workspace/FolderList.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import { overviewIndex, overviewFailed, loadOverview } from '$lib/stores/overview.js';
  import { projectGroups } from '$lib/utils/overview.js';
  import { artistOf, projectFolder, type Folder } from '$lib/utils/music.js';

  onMount(() => {
    void loadOverview(true);
  });

  const ix = $derived($overviewIndex);
  // Projects you were invited to: you are in them, but not as their owner
  const groups = $derived(ix ? projectGroups(ix).filter((g) => !g.project.myRoles.includes('owner')) : []);
  const folders = $derived(groups.map(projectFolder));

  function note(folder: Folder) {
    const project = ix?.projects.get(folder.key);
    if (!project) return '';
    const owner = project.members.find((m) => m.role === 'owner');
    const name = owner ? ix?.users.get(owner.userId)?.name : null;
    const artist = artistOf(project);
    return [artist, name && name !== artist ? t().workspace.music.ownedBy(name) : ''].filter(Boolean).join(' · ');
  }
</script>

<TopBar crumbs={[{ label: t().workspace.nav.shared }]} />

<div class="page">
  {#if !ix && $overviewFailed}
    <LoadFailed />
  {:else if !ix}
    <Skeleton height="10rem" variant="rect" />
  {:else if !folders.length}
    <EmptyState title={t().workspace.music.sharedEmptyTitle} description={t().workspace.music.sharedEmptyText} />
  {:else}
    <p class="intro">{t().workspace.music.sharedText}</p>
    <FolderList {folders} {note} />
  {/if}
</div>

<style>
  .page {
    padding: var(--space-6);
    max-width: 1100px;
  }
  .intro {
    margin: 0 0 var(--space-4);
    color: var(--color-text-secondary);
  }
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
  }
</style>
