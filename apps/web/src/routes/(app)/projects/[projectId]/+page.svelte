<script lang="ts">
  import { onMount, onDestroy, getContext } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/index.js';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import CoverUpload from '$lib/components/ui/CoverUpload.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import TabBar from '$lib/components/ui/TabBar.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import ProjectTimeline from '$lib/components/overview/ProjectTimeline.svelte';
  import TrackRow from '$lib/components/overview/TrackRow.svelte';
  import TrackBoard from '$lib/components/overview/TrackBoard.svelte';
  import ProjectDrop from '$lib/components/audio/ProjectDrop.svelte';
  import UploadLinkModal from '$lib/components/workspace/UploadLinkModal.svelte';
  import ProjectShareModal from '$lib/components/workspace/ProjectShareModal.svelte';
  import DeliveryPanel from '$lib/components/delivery/DeliveryPanel.svelte';
  import { overviewIndex, overviewFailed, loadOverview, markTracksSeen } from '$lib/stores/overview.js';
  import { trashDaysLeft } from '$lib/utils/format.js';
  import { UPLOAD_ROLES, projectGroups, type TrackInfo } from '$lib/utils/overview.js';

  type Track = { id: string; name: string; section: string | null };

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
    isArchived: boolean;
  };

  let project = $state<Project | null>(null);
  // What the user could restore from the project's trash, newest first
  let trash = $state<{ deletedAt: string }[]>([]);
  let role = $state('');
  let roles = $state<string[]>([]);
  // Contact requests that led here, so their message stays in view
  type Request = { id: string; message: string; answeredAt: string; from: { name: string; handle: string | null }; track: { id: string; name: string } | null };
  let requests = $state<Request[]>([]);
  let tracks = $state<Track[]>([]);
  let doneOpen = $state(false);
  // Rows showing their open comments or rejection reason
  let expanded = $state<Record<string, boolean>>({});
  let newTrackName = $state('');
  let showNewTrack = $state(false);
  const newTrackLabel = $derived(showNewTrack ? t().common.cancel : t().workspace.projectPage.newTrack);
  let loading = $state(true);
  let creating = $state(false);
  let coverEditOpen = $state(false);
  let restoring = $state(false);
  let uploadLinkOpen = $state(false);
  let shareOpen = $state(false);
  let drop = $state<ProjectDrop>();

  const projectId = $page.params.projectId;
  const reloadSidebar = getContext<(() => void) | undefined>('reloadSidebar');

  // Stand and turn of every track come from the overview, the sections from the track list
  const ix = $derived($overviewIndex);
  const group = $derived(ix ? projectGroups(ix).find((g) => g.project.id === projectId) : undefined);
  const sections = $derived(group ? groupBySection(group.active) : []);
  const wanted = $derived($page.url.searchParams.get('view'));
  // The delivery (Auftrag) is the owner's business
  const view = $derived(
    wanted === 'timeline' || wanted === 'board' ? wanted : wanted === 'auftrag' && roles.includes('owner') ? 'auftrag' : 'tracks',
  );

  function setView(id: string) {
    void goto(id === 'tracks' ? $page.url.pathname : `?view=${id}`, { replaceState: true, noScroll: true, keepFocus: true });
  }

  // New markers count from the last visit; leaving the project ends this one
  onDestroy(() => {
    void markTracksSeen();
  });

  onMount(async () => {
    void loadOverview(true);
    try {
      const [projectRes, trackRes] = await Promise.all([
        api.get<{ project: Project; role: string; roles: string[]; requests?: Request[] }>(`/projects/${projectId}`),
        api.get<{ tracks: Track[] }>(`/tracks/project/${projectId}`),
      ]);
      project = projectRes.project;
      role = projectRes.role;
      roles = projectRes.roles;
      requests = projectRes.requests ?? [];
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
      reloadSidebar?.();
      void loadOverview(true);
      newTrackName = '';
      showNewTrack = false;
      toastSuccess(t().workspace.projectPage.trackCreated);
    } catch {
      // The API client already showed the error
    } finally {
      creating = false;
    }
  }

  async function saveCover(key: string | null) {
    const res = await api.patch<{ project: Project }>(`/projects/${projectId}`, { coverImageUrl: key });
    project = res.project;
    coverEditOpen = false;
    toastSuccess(key ? t().workspace.projectPage.coverSaved : t().workspace.projectPage.coverRemoved);
    reloadSidebar?.();
    void loadOverview(true);
  }

  async function restore() {
    restoring = true;
    try {
      await api.post(`/projects/${projectId}/restore`);
      project = { ...project!, isArchived: false };
      reloadSidebar?.();
      void loadOverview(true);
      toastSuccess(t().workspace.projectPage.restored);
    } catch {
      // The API client already showed the error
    } finally {
      restoring = false;
    }
  }

  const canUpload = $derived(!project?.isArchived && roles.some((r) => UPLOAD_ROLES.includes(r)));
  const empty = $derived(!loading && tracks.length === 0);

  async function afterDrop() {
    tracks = (await api.get<{ tracks: Track[] }>(`/tracks/project/${projectId}`)).tracks;
    reloadSidebar?.();
    void loadOverview(true);
  }

  // Files dropped anywhere on the page become tracks too
  function dropOnPage(e: DragEvent) {
    if (!canUpload || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    void drop?.add(Array.from(e.dataTransfer.files));
  }
</script>

<TopBar
  crumbs={[
    { label: t().workspace.nav.projects, href: '/dashboard' },
    { label: project?.name ?? '…' },
  ]}
>
  {#snippet actions()}
    {#if !loading && (roles.includes('owner') || roles.includes('management'))}
      <Button variant="ghost" size="sm" href="/projects/{projectId}/settings" title={t().workspace.projectPage.settings}>
        <Icon name="settings" size={14} /> <span class="btn-label">{t().workspace.projectPage.settings}</span>
      </Button>
    {/if}
    {#if canUpload}
      <Button variant="ghost" size="sm" title={t().workspace.projectPage.uploadLink} onclick={() => (uploadLinkOpen = true)}>
        <Icon name="link" size={14} /> <span class="btn-label">{t().workspace.projectPage.uploadLink}</span>
      </Button>
      <Button variant="ghost" size="sm" title={newTrackLabel} onclick={() => showNewTrack = !showNewTrack}>
        <Icon name={showNewTrack ? 'x' : 'plus'} size={14} /> <span class="btn-label">{newTrackLabel}</span>
      </Button>
      {#if !empty}
        <Button variant="secondary" size="sm" onclick={() => drop?.pick()}><Icon name="upload" size={14} /> {t().workspace.projectPage.uploadMix}</Button>
      {/if}
    {/if}
    {#if !loading && !empty}
      <Button size="sm" title={t().workspace.projectPage.share} onclick={() => (shareOpen = true)}><Icon name="share" size={14} /> <span class="btn-label">{t().workspace.projectPage.share}</span></Button>
    {/if}
  {/snippet}
</TopBar>

<div
  class="project-page"
  role="presentation"
  ondragover={(e) => canUpload && e.dataTransfer?.types.includes('Files') && e.preventDefault()}
  ondrop={dropOnPage}
>
  <header>
    {#if loading}
      <Skeleton width="200px" height="2rem" />
    {:else if project}
      <div class="project-head">
        <button class="cover-btn" onclick={() => (coverEditOpen = true)} disabled={role !== 'owner'} aria-label={t().workspace.projectPage.changeCover}>
          <CoverImage src={project.coverUrl} name={project.name} size="lg" rounded="lg" />
        </button>
        <div>
          <h1>{project.name}</h1>
          {#if project.description}
            <p class="description">{project.description}</p>
          {/if}
        </div>
      </div>
    {/if}
  </header>

  {#if project?.isArchived}
    <div class="archived" role="status">
      <span class="archived-icon"><Icon name="archive" size={16} /></span>
      <span class="archived-text">
        <b>{t().workspace.projectPage.archived}</b>
        <small>
          {role === 'owner' ? t().workspace.projectPage.archivedOwner : t().workspace.projectPage.archivedOther}
        </small>
      </span>
      {#if role === 'owner'}
        <Button variant="secondary" size="sm" loading={restoring} onclick={restore}>
          <Icon name="restore" size={13} /> {t().workspace.projectPage.restore}
        </Button>
      {/if}
    </div>
  {/if}

  {#each requests as r (r.id)}
    <aside class="request">
      <p class="request-head">
        {t().workspace.projectPage.requestFrom} {#if r.from.handle}<a href="/@{r.from.handle}">{r.from.name}</a>{:else}<b>{r.from.name}</b>{/if}{#if r.track}{t().workspace.projectPage.requestOn}<a href="/offen/{r.track.id}">{t().workspace.quoted(r.track.name)}</a>{/if}
      </p>
      <blockquote>{r.message}</blockquote>
    </aside>
  {/each}

  {#if showNewTrack}
    <form class="new-track-form" onsubmit={(e) => { e.preventDefault(); createTrack(); }}>
      <Input bind:value={newTrackName} placeholder={t().workspace.projectPage.trackName} autofocus />
      <Button type="submit" loading={creating} disabled={!newTrackName.trim()}>{t().workspace.projectPage.create}</Button>
    </form>
  {/if}

  {#if canUpload}
    <ProjectDrop
      bind:this={drop}
      projectId={projectId!}
      {tracks}
      big={empty}
      onDone={afterDrop}
      onEmptyTrack={showNewTrack ? undefined : () => (showNewTrack = true)}
    />
  {/if}

  <div class="tabs">
    <TabBar
      tabs={[
        { id: 'tracks', label: t().workspace.projectPage.tabTracks, count: loading ? undefined : tracks.length },
        { id: 'board', label: t().workspace.projectPage.tabBoard },
        { id: 'timeline', label: t().workspace.projectPage.tabTimeline },
        ...(roles.includes('owner') ? [{ id: 'auftrag', label: t().workspace.projectPage.tabOrder }] : []),
      ]}
      active={view}
      onselect={setView}
    />
  </div>

  {#if view === 'auftrag' && projectId && !loading}
    <DeliveryPanel {projectId} {tracks} />
  {:else if loading || (!ix && !$overviewFailed)}
    <div class="loading">
      <Skeleton height="4rem" variant="rect" />
      <Skeleton height="4rem" variant="rect" />
    </div>
  {:else if !ix}
    <LoadFailed />
  {:else if !group?.list.length}
    {#if !canUpload}
      <EmptyState title={t().workspace.projectPage.emptyTitle} description={t().workspace.projectPage.emptyDescription} />
    {/if}
  {:else if view === 'timeline'}
    <ProjectTimeline {ix} list={group.list} />
  {:else if view === 'board'}
    <TrackBoard {ix} infos={group.list} />
  {:else}
    <div class="cols" aria-hidden="true"><span>{t().workspace.projectPage.colTrack}</span><span>{t().workspace.projectPage.colLatest}</span><span>{t().workspace.projectPage.colStage}</span><span>{t().workspace.projectPage.colLast}</span></div>
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
          {t().workspace.projectPage.doneTracks(group.done.length)}
        </button>
        {#if doneOpen}{@render rows(group.done)}{/if}
      </section>
    {/if}
  {/if}

  {#if trash.length > 0}
    {@const daysLeft = trashDaysLeft(trash[trash.length - 1].deletedAt)}
    <a href="/trash?project={projectId}" class="trash-link">
      <span class="trash-icon"><Icon name="trash" size={16} /></span>
      <span class="trash-text">
        <b>{t().workspace.projectPage.trashLinkTitle}</b>
        <small>
          {t().workspace.projectPage.trashLinkText(trash.length, daysLeft)}
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

{#if canUpload && projectId}
  <UploadLinkModal bind:open={uploadLinkOpen} {projectId} />
{/if}

{#if project && projectId}
  <ProjectShareModal
    bind:open={shareOpen}
    {projectId}
    projectName={project.name}
    {roles}
    archived={project.isArchived}
    {tracks}
  />
{/if}

{#if project}
  <Modal bind:open={coverEditOpen} title={t().workspace.projectPage.coverModalTitle}>
    <div class="cover-modal">
      <CoverUpload currentUrl={project.coverUrl} name={project.name} onChange={saveCover} />
    </div>
    {#snippet actions()}
      <Button onclick={() => (coverEditOpen = false)}>{t().common.close}</Button>
    {/snippet}
  </Modal>
{/if}

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
  .cover-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    border-radius: var(--radius-lg);
    transition: transform var(--transition-fast);
  }
  .cover-btn:not(:disabled):hover {
    transform: scale(1.04);
  }
  .cover-btn:disabled {
    cursor: default;
  }
  .cover-modal {
    display: flex;
    justify-content: center;
    padding: var(--space-3) 0;
  }
  .project-head > div {
    min-width: 0;
    flex: 1 1 240px;
  }
  /* On phones the header actions show only their icons, so the bar fits the screen; the label stays for screen readers */
  @media (max-width: 540px) {
    .btn-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
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
    color: var(--color-text-secondary);
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
    align-items: stretch;
  }

  .new-track-form :global(.input-group) {
    flex: 1;
  }

  .new-track-form :global(.btn) {
    height: auto;
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
  .request {
    margin-bottom: var(--space-5);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-left: 2px solid var(--color-accent);
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    background: var(--color-bg-raised);
  }
  .request-head {
    margin: 0 0 var(--space-1);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .request-head a,
  .request-head b {
    color: var(--color-text-secondary);
    font-weight: 600;
  }
  .request blockquote {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .archived {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-overlay);
    color: var(--color-text-tertiary);
  }
  .archived-icon {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
  }
  .archived-text {
    flex: 1;
    min-width: 12rem;
    display: flex;
    flex-direction: column;
  }
  .archived-text b {
    color: var(--color-text-primary);
    font-weight: 500;
    font-size: var(--text-sm);
  }
  .archived-text small {
    font-size: var(--text-xs);
  }

</style>
