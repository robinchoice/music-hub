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
  import Sheet from '$lib/components/ui/Sheet.svelte';
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
  import ProjectFiles, { type ProjectFile } from '$lib/components/workspace/ProjectFiles.svelte';
  import { pendingDrop } from '$lib/stores/pending-drop.js';
  import { overviewIndex, overviewFailed, loadOverview, markProjectSeen } from '$lib/stores/overview.js';
  import { trashDaysLeft } from '$lib/utils/format.js';
  import { projectGroups, type TrackInfo } from '$lib/utils/overview.js';
  import { capabilities } from '$lib/utils/track.js';
  import type { MemberRights } from '@music-hub/shared';
  import { artistOf, musicCrumbs, trackFolder } from '$lib/utils/music.js';
  import FolderList from '$lib/components/workspace/FolderList.svelte';
  import TrackTidy, { type TidyTrack } from '$lib/components/workspace/TrackTidy.svelte';

  type Track = { id: string; name: string; section: string | null; coverUrl?: string | null };

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
  let rights = $state<MemberRights | null>(null);
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
  // Phones: the rarer actions wait behind "⋯"
  let moreOpen = $state(false);
  let drop = $state<ProjectDrop>();
  let files = $state<ProjectFile[]>([]);
  let canDownloadFiles = $state(false);

  const projectId = $page.params.projectId;
  const reloadSidebar = getContext<(() => void) | undefined>('reloadSidebar');

  // Stand and turn of every track come from the overview, the sections from the track list
  const ix = $derived($overviewIndex);
  const group = $derived(ix ? projectGroups(ix).find((g) => g.project.id === projectId) : undefined);
  const artist = $derived(group ? artistOf(group.project) : '');
  const sections = $derived(group ? groupBySection(group.active) : []);
  const trackFolders = $derived.by(() => {
    const infoOf = new Map((group?.list ?? []).map((i) => [i.track.id, i]));
    return tracks.map((tr) => trackFolder(projectId!, tr, infoOf.get(tr.id), files.filter((f) => f.trackId === tr.id).length));
  });
  const looseFiles = $derived(files.filter((f) => !f.trackId || !tracks.some((tr) => tr.id === f.trackId)));
  const wanted = $derived($page.url.searchParams.get('view'));
  // The delivery (Auftrag) is the owner's business
  const view = $derived(
    wanted === 'timeline' || wanted === 'board' || wanted === 'dateien' ? wanted : wanted === 'auftrag' && roles.includes('owner') ? 'auftrag' : 'tracks',
  );

  function setView(id: string) {
    void goto(id === 'tracks' ? $page.url.pathname : `?view=${id}`, { replaceState: true, noScroll: true, keepFocus: true });
  }

  // New markers count from the last visit; leaving the project ends this one
  onDestroy(() => {
    if (projectId) void markProjectSeen(projectId);
  });

  onMount(async () => {
    void loadOverview(true);
    try {
      const [projectRes, trackRes] = await Promise.all([
        api.get<{ project: Project; role: string; roles: string[]; rights: MemberRights; requests?: Request[] }>(`/projects/${projectId}`),
        api.get<{ tracks: Track[] }>(`/tracks/project/${projectId}`),
      ]);
      project = projectRes.project;
      role = projectRes.role;
      roles = projectRes.roles;
      rights = projectRes.rights;
      requests = projectRes.requests ?? [];
      tracks = trackRes.tracks;
    } finally {
      loading = false;
    }
    void loadFiles();
    const trashRes = await api.get<{ entries: { deletedAt: string }[] }>(`/trash/project/${projectId}`, true).catch(() => null);
    trash = trashRes?.entries ?? [];
  });

  async function loadFiles() {
    const res = await api.get<{ files: ProjectFile[]; canDownload: boolean }>(`/files/project/${projectId}`, true).catch(() => null);
    files = res?.files ?? [];
    canDownloadFiles = res?.canDownload ?? false;
  }

  async function filesChanged(opts: { tracks?: boolean } = {}) {
    await loadFiles();
    if (opts.tracks) await afterDrop({ files: 0, tracks: 1 });
  }

  // Files dropped elsewhere in the app for this project
  $effect(() => {
    const pending = $pendingDrop;
    if (!pending || pending.projectId !== projectId || !drop || !canUpload) return;
    pendingDrop.set(null);
    void drop.add(pending.files, pending.trackId);
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
      // In the archive uploading, commenting and approving rested; the API answers with them again
      rights = (await api.get<{ rights: MemberRights }>(`/projects/${projectId}`)).rights;
      reloadSidebar?.();
      void loadOverview(true);
      toastSuccess(t().workspace.projectPage.restored);
    } catch {
      // The API client already showed the error
    } finally {
      restoring = false;
    }
  }

  const canUpload = $derived(!project?.isArchived && capabilities(rights).canUpload);
  const empty = $derived(!loading && tracks.length === 0);

  async function afterDrop(result: { files: number; tracks: number }) {
    if (result.files) {
      await loadFiles();
      // Only files: show them where they went
      if (!result.tracks && view !== 'dateien') setView('dateien');
    }
    if (!result.tracks) return;
    tracks = (await api.get<{ tracks: Track[] }>(`/tracks/project/${projectId}`)).tracks;
    reloadSidebar?.();
    void loadOverview(true);
  }

  // --- Tidying up like a drive: a menu per row, a selection, dragging onto sections and projects ---
  let tidy = $state<TrackTidy>();
  let selected = $state<string[]>([]);
  // Phones: a long press starts selecting, then taps add and remove
  let selecting = $state(false);
  let dragIds = $state<string[]>([]);
  let dropKey = $state<string | null>(null);
  const DRAG_TYPE = 'application/x-musichub-tracks';
  const sectionNames = $derived([...new Set(tracks.map((tr) => tr.section?.trim()).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b)));
  const ownedProjects = $derived(ix ? [...ix.projects.values()].filter((p) => p.id !== projectId && (p.myRole === 'owner' || p.myRoles.includes('owner'))) : []);
  const isOwner = $derived(roles.includes('owner'));

  const tidyTrack = (id: string): TidyTrack | null => {
    const tr = tracks.find((x) => x.id === id);
    return tr ? { id: tr.id, name: tr.name, projectId: projectId!, section: tr.section?.trim() || null } : null;
  };
  const tidyList = (ids: string[]) => ids.map(tidyTrack).filter((x): x is TidyTrack => !!x);
  // The row acted on, with the selection if it is part of it
  const withSelection = (id: string) => (selected.includes(id) ? selected : [id]);

  async function refresh() {
    tracks = (await api.get<{ tracks: Track[] }>(`/tracks/project/${projectId}`)).tracks;
    selected = selected.filter((id) => tracks.some((tr) => tr.id === id));
    if (!selected.length) selecting = false;
    reloadSidebar?.();
    await loadOverview(true);
    void loadFiles();
  }

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    if (!selected.length) selecting = false;
  }

  function clearSelection() {
    selected = [];
    selecting = false;
  }

  function openMenu(id: string, at: { x: number; y: number } | null) {
    tidy?.menu(tidyList(withSelection(id)), at);
  }

  let lastPointer = 'mouse';
  let press: { id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let pressed = false;

  function pressStart(e: PointerEvent, id: string) {
    lastPointer = e.pointerType;
    if (e.pointerType !== 'touch' || !canUpload) return;
    pressed = false;
    press = {
      id,
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        pressed = true;
        selecting = true;
        if (!selected.includes(id)) selected = [...selected, id];
        navigator.vibrate?.(10);
      }, 450),
    };
  }
  function pressMove(e: PointerEvent) {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) pressEnd();
  }
  function pressEnd() {
    if (press) clearTimeout(press.timer);
    press = null;
  }

  // Ctrl/⌘ and shift pick like a drive, while selecting a tap picks; the row's link stays for plain clicks
  function clickRow(e: MouseEvent, id: string) {
    if ((e.target as Element).closest('.pick, .dots')) return;
    const picking = pressed || selecting || e.metaKey || e.ctrlKey || (e.shiftKey && selected.length > 0);
    if (!picking || !canUpload) return;
    e.preventDefault();
    e.stopPropagation();
    if (pressed) {
      pressed = false;
      return;
    }
    if (e.shiftKey && selected.length) {
      const order = sections.flatMap((s) => s.list.map((i) => i.track.id));
      const [a, b] = [order.indexOf(selected.at(-1)!), order.indexOf(id)].sort((x, y) => x - y);
      selected = [...new Set([...selected, ...order.slice(a, b + 1)])];
    } else {
      toggle(id);
    }
  }

  function contextMenu(e: MouseEvent, id: string) {
    if (!canUpload) return;
    e.preventDefault();
    // A long press on a phone selects; its context menu would get in the way
    if (lastPointer === 'touch') return;
    openMenu(id, { x: e.clientX, y: e.clientY });
  }

  function dragStart(e: DragEvent, id: string) {
    if (!canUpload || !e.dataTransfer) return;
    dragIds = withSelection(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_TYPE, dragIds.join(','));
  }
  function dragEnd() {
    dragIds = [];
    dropKey = null;
  }
  const carriesTracks = (e: DragEvent) => !!e.dataTransfer?.types.includes(DRAG_TYPE);
  function dragOver(e: DragEvent, key: string) {
    if (!carriesTracks(e)) return;
    e.preventDefault();
    dropKey = key;
  }
  function dropOn(e: DragEvent, target: { section: string | null } | { projectId: string }) {
    if (!carriesTracks(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const list = tidyList(e.dataTransfer!.getData(DRAG_TYPE).split(','));
    dragEnd();
    if (!list.length) return;
    if ('projectId' in target) tidy?.move(list, target.projectId);
    else void tidy?.setSection(list, target.section);
  }

  // Files dropped anywhere on the page become tracks too
  function dropOnPage(e: DragEvent) {
    if (!canUpload || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    void drop?.add(Array.from(e.dataTransfer.files));
  }
</script>

<TopBar
  crumbs={[...musicCrumbs(artist), { label: project?.name ?? '…' }]}
>
  {#snippet actions()}
    <!-- Wide screens show every action with its label; phones keep sharing and put the rest behind "⋯" -->
    <span class="wide-only">
      {#if !loading}
        <Button variant="ghost" size="sm" href="/projects/{projectId}/settings" title={t().workspace.projectPage.settings}>
          <Icon name="settings" size={14} /> {t().workspace.projectPage.settings}
        </Button>
      {/if}
      {#if canUpload}
        <Button variant="ghost" size="sm" title={t().workspace.projectPage.uploadLink} onclick={() => (uploadLinkOpen = true)}>
          <Icon name="link" size={14} /> {t().workspace.projectPage.uploadLink}
        </Button>
        <Button variant="ghost" size="sm" title={newTrackLabel} onclick={() => showNewTrack = !showNewTrack}>
          <Icon name={showNewTrack ? 'x' : 'plus'} size={14} /> {newTrackLabel}
        </Button>
        {#if !empty}
          <Button variant="secondary" size="sm" onclick={() => drop?.pick()}><Icon name="upload" size={14} /> {t().workspace.projectPage.uploadMix}</Button>
        {/if}
      {/if}
    </span>
    <span class="bar-actions">
      {#if !loading && !empty}
        <Button size="sm" title={t().workspace.projectPage.share} onclick={() => (shareOpen = true)}><Icon name="share" size={14} /> {t().workspace.projectPage.share}</Button>
      {/if}
      {#if !loading}
        <span class="narrow-only">
          <Button variant="ghost" size="sm" title={t().workspace.projectPage.moreActions} onclick={() => (moreOpen = true)}>
            <Icon name="more" size={16} /> <span class="sr-only">{t().workspace.projectPage.moreActions}</span>
          </Button>
        </span>
      {/if}
    </span>
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

  {#if canUpload && !empty && !loading}
    <div class="narrow-only upload-cta">
      <Button size="lg" onclick={() => drop?.pick()}><Icon name="upload" size={16} /> {t().workspace.projectPage.uploadMixOrStems}</Button>
    </div>
  {/if}

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
      <Button variant="ghost" onclick={() => { showNewTrack = false; newTrackName = ''; }}>{t().common.cancel}</Button>
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
        { id: 'dateien', label: t().workspace.projectPage.tabFiles, count: trackFolders.length + looseFiles.length },
        ...(roles.includes('owner') ? [{ id: 'auftrag', label: t().workspace.projectPage.tabOrder }] : []),
      ]}
      active={view}
      onselect={setView}
    />
  </div>

  {#if view === 'auftrag' && projectId && !loading}
    <DeliveryPanel {projectId} {tracks} />
  {:else if view === 'dateien' && projectId}
    <!-- Like a drive: the tracks as folders, then the files that belong to no track -->
    <div class="drive">
      {#if trackFolders.length}<FolderList folders={trackFolders} onactions={canUpload ? (folder, at) => openMenu(folder.key, at) : undefined} />{/if}
      {#if looseFiles.length || !trackFolders.length}
        {#if trackFolders.length}<h2 class="drive-title">{t().workspace.music.filesTitle}</h2>{/if}
        <ProjectFiles {projectId} files={looseFiles} canDownload={canDownloadFiles} {tracks} onChange={filesChanged} />
      {/if}
    </div>
  {:else if project?.isArchived}
    <!-- The overview leaves archived projects out, so their tracks come straight from the track list -->
    {#if tracks.length}
      <ul class="archived-tracks">
        {#each tracks as tr (tr.id)}
          <li><a href="/projects/{projectId}/tracks/{tr.id}"><Icon name="music" size={14} /> {tr.name}</a></li>
        {/each}
      </ul>
    {:else}
      <EmptyState title={t().workspace.projectPage.emptyTitle} />
    {/if}
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
    {#if canUpload}<p class="tidy-hint wide">{t().tidy.dragHint}</p>{/if}
    <div class="cols" class:tidy={canUpload} aria-hidden="true"><span>{t().workspace.projectPage.colTrack}</span><span>{t().workspace.projectPage.colLatest}</span><span>{t().workspace.projectPage.colStage}</span><span>{t().workspace.projectPage.colLast}</span></div>
    {#each sections as section (section.name)}
      <section class="section">
        {#if sections.length > 1}
          <h2
            class="section-title"
            class:drop={dropKey === `s:${section.name}`}
            ondragover={(e) => dragOver(e, `s:${section.name}`)}
            ondragleave={() => (dropKey = null)}
            ondrop={(e) => dropOn(e, { section: section.name === 'Mainline' ? null : section.name })}
          >
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
    {@const id = info.track.id}
    {#if k}<div class="sep"></div>{/if}
    {#if canUpload}
      <div
        class="tidy-row"
        class:selected={selected.includes(id)}
        class:selecting
        class:dragging={dragIds.includes(id)}
        role="group"
        aria-label={info.track.name}
        draggable="true"
        ondragstart={(e) => dragStart(e, id)}
        ondragend={dragEnd}
        oncontextmenu={(e) => contextMenu(e, id)}
        onclickcapture={(e) => clickRow(e, id)}
        onpointerdown={(e) => pressStart(e, id)}
        onpointermove={pressMove}
        onpointerup={pressEnd}
        onpointercancel={pressEnd}
      >
        <label class="pick"><input type="checkbox" checked={selected.includes(id)} onchange={() => toggle(id)} aria-label={t().tidy.select(info.track.name)} /></label>
        <div class="row-main">
          <TrackRow ix={ix!} {info} expanded={!!expanded[id]} ontoggle={() => (expanded = { ...expanded, [id]: !expanded[id] })} />
        </div>
        <button type="button" class="dots" aria-label={t().tidy.actions(info.track.name)} title={t().tidy.actions(info.track.name)} onclick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(id, { x: r.right - 240, y: r.bottom + 4 }); }}>
          <Icon name="more" size={16} />
        </button>
      </div>
    {:else}
      <TrackRow ix={ix!} {info} expanded={!!expanded[id]} ontoggle={() => (expanded = { ...expanded, [id]: !expanded[id] })} />
    {/if}
  {/each}
{/snippet}

<svelte:window onkeydown={(e) => e.key === 'Escape' && selected.length && clearSelection()} />

{#if canUpload && projectId}
  <TrackTidy
    bind:this={tidy}
    sections={sectionNames}
    onchange={refresh}
    onopen={(tr) => goto(`/projects/${projectId}/tracks/${tr.id}`)}
  />
{/if}

{#if selected.length && view === 'tracks'}
  <div class="selection-bar" role="region" aria-label={t().tidy.selected(selected.length)}>
    <span class="count">{t().tidy.selected(selected.length)}</span>
    <Button variant="ghost" size="sm" onclick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); tidy?.menu(tidyList(selected), { x: r.left, y: r.top - 8 }); }}>
      <Icon name="more" size={14} /> {t().tidy.section}
    </Button>
    {#if isOwner}
      <Button variant="ghost" size="sm" onclick={() => tidy?.move(tidyList(selected))}><Icon name="folder-move" size={14} /> {t().tidy.moveConfirm}</Button>
      <Button variant="ghost" size="sm" disabled={selected.length < 2} onclick={() => tidy?.merge(tidyList(selected))}><Icon name="merge" size={14} /> {t().tidy.mergeConfirm}</Button>
      <Button variant="ghost" size="sm" title={t().tidy.trash} onclick={() => tidy?.trash(tidyList(selected))}><Icon name="trash" size={14} /></Button>
    {/if}
    <Button variant="ghost" size="sm" title={t().tidy.clear} onclick={clearSelection}><Icon name="x" size={14} /></Button>
  </div>
{/if}

{#if dragIds.length}
  <div class="drop-dock" role="region" aria-label={t().tidy.dropProjects}>
    {#each [...sectionNames, null] as s (s ?? '')}
      <span
        class="drop-chip"
        role="listitem"
        class:drop={dropKey === `d:${s ?? ''}`}
        ondragover={(e) => dragOver(e, `d:${s ?? ''}`)}
        ondragleave={() => (dropKey = null)}
        ondrop={(e) => dropOn(e, { section: s })}
      ><Icon name="layers" size={13} /> {s ?? t().tidy.noSection}</span>
    {/each}
    {#if isOwner}
      {#each ownedProjects as p (p.id)}
        <span
          class="drop-chip project"
          role="listitem"
          class:drop={dropKey === `p:${p.id}`}
          ondragover={(e) => dragOver(e, `p:${p.id}`)}
          ondragleave={() => (dropKey = null)}
          ondrop={(e) => dropOn(e, { projectId: p.id })}
        ><Icon name="folder-move" size={13} /> {p.name}</span>
      {/each}
    {/if}
  </div>
{/if}

<Sheet bind:open={moreOpen} title={t().workspace.projectPage.moreActions}>
  <nav class="more-list" aria-label={t().workspace.projectPage.moreActions}>
    {#if canUpload}
      <button type="button" onclick={() => { moreOpen = false; showNewTrack = true; }}><Icon name="plus" size={18} /> {t().workspace.projectPage.newTrack}</button>
      <button type="button" onclick={() => { moreOpen = false; uploadLinkOpen = true; }}><Icon name="link" size={18} /> {t().workspace.projectPage.uploadLinkGuests}</button>
    {/if}
    <a href="/projects/{projectId}/settings" onclick={() => (moreOpen = false)}><Icon name="settings" size={18} /> {t().workspace.projectPage.settingsMembers}</a>
  </nav>
</Sheet>

{#if canUpload && projectId}
  <UploadLinkModal bind:open={uploadLinkOpen} {projectId} />
{/if}

{#if project && projectId}
  <ProjectShareModal
    bind:open={shareOpen}
    {projectId}
    projectName={project.name}
    {rights}
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
  /* Phones: sharing and "⋯" in the bar, uploading as the one big button under the title */
  .wide-only,
  .bar-actions {
    display: contents;
  }
  .narrow-only {
    display: none;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .upload-cta {
    margin-bottom: var(--space-5);
  }
  .upload-cta :global(.btn) {
    width: 100%;
    justify-content: center;
  }
  .more-list {
    display: flex;
    flex-direction: column;
    padding: var(--space-2) 0 var(--space-4);
  }
  .more-list button,
  .more-list a {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 52px;
    padding: 0 var(--space-4);
    border: none;
    border-top: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-base);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .more-list > :first-child {
    border-top: none;
  }
  @media (max-width: 540px) {
    .wide-only {
      display: none;
    }
    .narrow-only {
      display: contents;
    }
    .upload-cta.narrow-only {
      display: block;
    }
    /* Big enough for a finger */
    .bar-actions :global(.btn) {
      min-height: 40px;
      min-width: 40px;
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








  .drive {
    display: grid;
    gap: var(--space-3);
  }
  .drive-title {
    margin: var(--space-4) 0 0;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 600;
    font-stretch: normal;
    letter-spacing: 0;
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
  .cols.tidy {
    padding-left: calc(var(--space-3) + 28px);
    padding-right: calc(var(--space-3) + 36px);
  }
  .tidy-hint {
    margin: calc(-1 * var(--space-3)) 0 var(--space-3);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .tidy-row {
    display: flex;
    align-items: center;
    border-radius: var(--radius-md);
    -webkit-touch-callout: none;
  }
  .tidy-row.selected {
    background: var(--color-accent-subtle);
  }
  .tidy-row.dragging {
    opacity: 0.45;
  }
  .row-main {
    flex: 1;
    min-width: 0;
  }
  .pick {
    width: 28px;
    flex: none;
    display: grid;
    place-items: center;
    align-self: stretch;
    cursor: pointer;
  }
  .pick input {
    width: 16px;
    height: 16px;
    accent-color: var(--color-accent);
    opacity: 0;
    cursor: pointer;
  }
  .tidy-row:hover .pick input,
  .tidy-row.selected .pick input,
  .pick input:focus-visible {
    opacity: 1;
  }
  .dots {
    width: 32px;
    height: 32px;
    flex: none;
    margin-right: 4px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
  }
  .dots:hover,
  .dots:focus-visible {
    background: var(--color-bg-overlay);
    color: var(--color-text-primary);
  }
  .section-title.drop,
  .drop-chip.drop {
    outline: 2px dashed var(--color-accent);
    outline-offset: 2px;
    color: var(--color-text-primary);
  }
  .selection-bar,
  .drop-dock {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(var(--space-5) + env(safe-area-inset-bottom));
    z-index: var(--z-dropdown);
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: calc(100vw - 2 * var(--space-4));
    padding: 6px 8px;
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }
  .selection-bar .count {
    padding: 0 var(--space-2);
    color: var(--color-text-primary);
    font-weight: 600;
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .drop-dock {
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }
  .drop-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 1px dashed var(--color-border-hover);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .drop-chip.project {
    border-style: solid;
  }
  @media (max-width: 640px) {
    .tidy-hint.wide,
    .cols.tidy {
      display: none;
    }
    .pick {
      display: none;
    }
    .tidy-row.selecting .pick {
      display: grid;
    }
    .tidy-row.selecting .pick input {
      opacity: 1;
    }
    .selection-bar {
      left: var(--space-3);
      right: var(--space-3);
      transform: none;
      max-width: none;
      flex-wrap: wrap;
      justify-content: space-between;
      bottom: calc(76px + env(safe-area-inset-bottom));
    }
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

  .archived-tracks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .archived-tracks a {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    text-decoration: none;
  }
  .archived-tracks a:hover {
    background: var(--color-bg-raised);
  }
  .archived-tracks :global(svg) {
    color: var(--color-text-tertiary);
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
