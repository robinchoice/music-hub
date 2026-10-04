<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api/client.js';
  import { user } from '$lib/stores/auth.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import WaveformPlayer from '$lib/components/audio/WaveformPlayer.svelte';
  import UploadDropzone from '$lib/components/audio/UploadDropzone.svelte';
  import ABCompare from '$lib/components/audio/ABCompare.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import CoverUpload from '$lib/components/ui/CoverUpload.svelte';
  import TrackStatusPill from '$lib/components/ui/TrackStatusPill.svelte';
  import { onKey } from '$lib/utils/shortcuts.js';
  import { snapshotForTrack, continuationFor } from '$lib/stores/player.js';
  import { connectTrackSse } from '$lib/stores/sse.js';
  import {
    downloadForOffline,
    removeOffline,
    getOfflineAudioUrl,
    initOfflineStore,
    isOffline,
    type OfflineQuality,
  } from '$lib/stores/offline.svelte.js';
  import { TRACK_STATUSES, TRACK_STATUS_LABELS, type TrackStatus } from '@music-hub/shared';
  import { predecessorOf, type Version, type TrackComment } from '$lib/utils/track.js';
  import VersionCard from './components/VersionCard.svelte';
  import VersionList from './components/VersionList.svelte';
  import ShareModal from './components/ShareModal.svelte';
  import CommentSection from './components/CommentSection.svelte';
  import StemList, { type Stem } from './components/StemList.svelte';

  const projectId = ($page.params as Record<string, string>).projectId;
  const trackId = ($page.params as Record<string, string>).trackId;

  let projectName = $state('');
  let trackName = $state('');
  let trackStatus = $state<TrackStatus>('in_progress');
  let trackSection = $state<string | null>(null);
  let trackCoverUrl = $state<string | null>(null);
  let coverEditOpen = $state(false);
  let statusMenuOpen = $state(false);
  let trackMenuOpen = $state(false);
  let renameOpen = $state(false);
  let renameValue = $state('');
  let nextInitialTime = $state(0);
  let nextAutoPlay = $state(false);
  let versions = $state<Version[]>([]);
  let selectedVersion = $state<Version | null>(null);
  let streamUrl = $state('');
  let comments = $state<TrackComment[]>([]);
  let predecessorComments = $state<TrackComment[]>([]);
  let currentTime = $state(0);
  let commentSection = $state<CommentSection>();
  let showUpload = $state(false);
  let role = $state('');
  let loading = $state(true);
  let commentTimestamp = $state<number | null>(null);
  let playerRef = $state<WaveformPlayer>();
  let compareVersion = $state<Version | null>(null);
  let compareStreamUrl = $state('');
  let branchFromId = $state<string | null>(null);
  let branchLabelInput = $state('');
  let shareOpen = $state(false);
  let stems = $state<Stem[]>([]);
  let panelOpen = $state(true);
  let isNarrow = $state(false);
  let versionsSheetOpen = $state(false);
  let spurenSheetOpen = $state(false);
  let editVersionOpen = $state(false);
  let editVersionLabel = $state('');
  let editVersionNotes = $state('');
  let savingVersion = $state(false);
  let offlineDownloading = $state(false);
  let offlineProgress = $state(0);
  let rejectOpen = $state(false);
  let rejectReason = $state('');
  let rejecting = $state(false);
  let disconnectSse: (() => void) | null = null;
  let selectSeq = 0;

  const canUpload = $derived(role === 'owner' || role.includes('engineer'));
  const canApprove = $derived(['owner', 'artist', 'label', 'management'].includes(role));
  const canComment = $derived(role !== 'viewer');
  const predecessor = $derived(selectedVersion ? predecessorOf(selectedVersion, versions) : null);

  // Phones and narrow windows get one column; versions and raw tracks open as sheets there.
  $effect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    isNarrow = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      isNarrow = e.matches;
      if (!e.matches) {
        versionsSheetOpen = false;
        spurenSheetOpen = false;
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  onDestroy(() => disconnectSse?.());

  onMount(async () => {
    await initOfflineStore();
    try {
      const [projectRes, trackVersions, tracksRes, stemsRes] = await Promise.all([
        api.get<{ project: { name: string }; role: string }>(`/projects/${projectId}`),
        api.get<{ versions: Version[] }>(`/versions/track/${trackId}`),
        api.get<{ tracks: { id: string; name: string; coverUrl: string | null; status: TrackStatus; section: string | null }[] }>(`/tracks/project/${projectId}`),
        api.get<{ stems: Stem[] }>(`/stems/track/${trackId}`),
      ]);

      projectName = projectRes.project.name;
      role = projectRes.role;
      const t = tracksRes.tracks.find((t) => t.id === trackId);
      trackName = t?.name || '';
      trackCoverUrl = t?.coverUrl ?? null;
      trackStatus = t?.status ?? 'in_progress';
      trackSection = t?.section ?? null;
      versions = trackVersions.versions;
      stems = stemsRes.stems;

      if (versions.length > 0) await selectVersion(versions[0]);
    } finally {
      loading = false;
    }

    disconnectSse = connectTrackSse(trackId, async ({ type, data }: { type: string; data: any }) => {
      if (type === 'version:new') {
        await loadVersions();
      } else if (type === 'version:status') {
        await refreshVersions();
      } else if (type === 'comment:new') {
        if (data.versionId === selectedVersion?.id || data.versionId === predecessor?.id) await reloadComments();
        else await refreshVersions();
      }
    });
  });

  async function selectVersion(version: Version) {
    // Snapshot current playhead so the new version picks up where we left off
    if (playerRef && selectedVersion) {
      snapshotForTrack(trackId, playerRef.getCurrentTime(), playerRef.getIsPlaying());
    }
    const cont = continuationFor(trackId);
    nextInitialTime = cont?.initialTime ?? 0;
    nextAutoPlay = cont?.autoPlay ?? false;

    selectedVersion = version;
    // Only the latest selection may apply its responses, so fast switching can't mix versions
    const seq = ++selectSeq;

    // Use cached audio if offline and version is downloaded
    if (!navigator.onLine && isOffline(version.id)) {
      const blobUrl = await getOfflineAudioUrl(version.id);
      if (seq !== selectSeq) return;
      if (blobUrl) {
        streamUrl = blobUrl;
        comments = [];
        predecessorComments = [];
        return;
      }
    }

    const pred = predecessorOf(version, versions);
    const [streamRes, commentRes, predRes] = await Promise.all([
      api.get<{ url: string }>(`/versions/${version.id}/stream-url`),
      api.get<{ comments: TrackComment[] }>(`/comments/version/${version.id}`),
      pred
        ? api
            .get<{ comments: TrackComment[] }>(`/comments/version/${pred.id}`, true)
            .catch(() => ({ comments: [] as TrackComment[] }))
        : Promise.resolve({ comments: [] as TrackComment[] }),
    ]);
    if (seq !== selectSeq) return;
    streamUrl = streamRes.url;
    comments = commentRes.comments;
    predecessorComments = predRes.comments;
  }

  // Reloads the list and selects the newest version, e.g. after an upload
  async function loadVersions() {
    const res = await api.get<{ versions: Version[] }>(`/versions/track/${trackId}`);
    versions = res.versions;
    if (versions.length > 0) await selectVersion(versions[0]);
  }

  // Reloads the list (counts, status) and keeps the current selection
  async function refreshVersions() {
    const res = await api.get<{ versions: Version[] }>(`/versions/track/${trackId}`);
    versions = res.versions;
    const id = selectedVersion?.id;
    if (id) selectedVersion = versions.find((v) => v.id === id) ?? selectedVersion;
  }

  async function reloadComments() {
    if (!selectedVersion) return;
    const id = selectedVersion.id;
    const pred = predecessor;
    const [res, predRes] = await Promise.all([
      api.get<{ comments: TrackComment[] }>(`/comments/version/${id}`),
      pred
        ? api.get<{ comments: TrackComment[] }>(`/comments/version/${pred.id}`)
        : Promise.resolve({ comments: [] as TrackComment[] }),
    ]);
    // Skip if the user switched versions meanwhile; selectVersion loads the new comments
    if (selectedVersion?.id === id) {
      comments = res.comments;
      predecessorComments = predRes.comments;
    }
    await refreshVersions();
  }

  async function setTrackStatus(s: TrackStatus) {
    trackStatus = s;
    statusMenuOpen = false;
    await api.patch(`/tracks/${trackId}`, { status: s });
    toastSuccess(`Status: ${TRACK_STATUS_LABELS[s]}`);
  }

  async function handlePromote() {
    if (!selectedVersion) return;
    await api.post(`/versions/${selectedVersion.id}/promote`);
    toastSuccess('Als Hauptversion festgelegt');
    await refreshVersions();
  }

  async function scrollToUpload() {
    await tick();
    document.querySelector('.upload-zone')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function openUpload() {
    branchFromId = null;
    branchLabelInput = '';
    showUpload = true;
    versionsSheetOpen = false;
    scrollToUpload();
  }

  function startBranch() {
    if (!selectedVersion) return;
    branchFromId = selectedVersion.id;
    branchLabelInput = '';
    showUpload = true;
    scrollToUpload();
  }

  async function revealPanel(id: string) {
    panelOpen = true;
    await tick();
    document.getElementById(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function openVersions() {
    if (isNarrow) versionsSheetOpen = true;
    else revealPanel('panel-versions');
  }

  function openSpuren() {
    if (isNarrow) spurenSheetOpen = true;
    else revealPanel('panel-spuren');
  }

  async function handleApprove() {
    if (!selectedVersion) return;
    await api.post(`/versions/${selectedVersion.id}/approve`);
    toastSuccess('Version freigegeben');
    await refreshVersions();
  }

  function handleReject() {
    rejectReason = '';
    rejectOpen = true;
  }

  async function submitReject() {
    if (!selectedVersion || !rejectReason.trim()) return;
    rejecting = true;
    try {
      await api.post(`/versions/${selectedVersion.id}/reject`, { reason: rejectReason.trim() });
      rejectOpen = false;
      toastSuccess('Version abgelehnt');
      await reloadComments();
    } finally {
      rejecting = false;
    }
  }

  async function handleComment(body: string, timestamp: number | null) {
    if (!selectedVersion) return;
    await api.post(`/comments/version/${selectedVersion.id}`, {
      body,
      timestampSeconds: timestamp ?? undefined,
    });
    await reloadComments();
    toastSuccess('Kommentar gespeichert');
  }

  async function handleReply(parentId: string, body: string, onCarry: boolean) {
    const target = onCarry ? predecessor : selectedVersion;
    if (!target) return;
    await api.post(`/comments/version/${target.id}`, { body, parentId });
    await reloadComments();
  }

  async function handleResolve(id: string) {
    await api.post(`/comments/${id}/resolve`);
    await reloadComments();
  }

  async function handleReopen(id: string) {
    await api.post(`/comments/${id}/reopen`);
    await reloadComments();
  }

  async function handleEditComment(id: string, body: string) {
    await api.patch(`/comments/${id}`, { body });
    await reloadComments();
  }

  async function handleDeleteComment(id: string) {
    if (!confirm('Diesen Kommentar wirklich löschen?')) return;
    await api.delete(`/comments/${id}`);
    await reloadComments();
  }

  function handleDownload() {
    if (!selectedVersion) return;
    api.get<{ url: string }>(`/versions/${selectedVersion.id}/download-url`).then((res) => {
      window.open(res.url, '_blank');
    });
  }

  async function startCompare(version: Version) {
    const res = await api.get<{ url: string }>(`/versions/${version.id}/stream-url`);
    compareVersion = version;
    compareStreamUrl = res.url;
  }

  function closeCompare() {
    compareVersion = null;
    compareStreamUrl = '';
  }

  async function saveTrackCover(key: string) {
    await api.patch(`/tracks/${trackId}`, { coverImageUrl: key });
    // Reload list to refresh signed URL via /tracks/project/:id
    const tracksRes = await api.get<{ tracks: { id: string; coverUrl: string | null }[] }>(`/tracks/project/${projectId}`);
    trackCoverUrl = tracksRes.tracks.find((t) => t.id === trackId)?.coverUrl ?? null;
    coverEditOpen = false;
    toastSuccess('Cover gespeichert');
  }

  function openRename() {
    renameValue = trackName;
    renameOpen = true;
  }

  async function saveRename() {
    const name = renameValue.trim();
    if (!name) return;
    await api.patch(`/tracks/${trackId}`, { name });
    trackName = name;
    renameOpen = false;
    toastSuccess('Track umbenannt');
  }

  function openVersionEdit() {
    if (!selectedVersion) return;
    editVersionLabel = selectedVersion.label ?? '';
    editVersionNotes = selectedVersion.notes ?? '';
    editVersionOpen = true;
  }

  async function saveVersion() {
    if (!selectedVersion) return;
    savingVersion = true;
    try {
      await api.patch(`/versions/${selectedVersion.id}`, {
        label: editVersionLabel.trim() || null,
        notes: editVersionNotes.trim() || null,
      });
      toastSuccess('Version aktualisiert');
      editVersionOpen = false;
      await refreshVersions();
    } finally {
      savingVersion = false;
    }
  }

  async function deleteTrack() {
    if (!confirm(`Track "${trackName}" mit allen Versionen und Kommentaren wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    await api.delete(`/tracks/${trackId}`);
    toastSuccess('Track gelöscht');
    window.location.href = `/projects/${projectId}`;
  }

  function jumpVersion(direction: 1 | -1) {
    if (versions.length === 0 || !selectedVersion) return;
    const idx = versions.findIndex((v) => v.id === selectedVersion!.id);
    const next = versions[idx + direction];
    if (next) selectVersion(next);
  }

  function focusComment() {
    if (!playerRef) return;
    commentTimestamp = Math.round(playerRef.getCurrentTime() * 10) / 10;
    commentSection?.focusComposer();
  }

  onKey({
    ' ': () => playerRef?.togglePlay(),
    k: () => playerRef?.togglePlay(),
    j: () => playerRef && playerRef.seekToTime(Math.max(0, playerRef.getCurrentTime() - 10)),
    l: () => playerRef && playerRef.seekToTime(playerRef.getCurrentTime() + 10),
    c: () => focusComment(),
    ArrowLeft: () => jumpVersion(-1),
    ArrowRight: () => jumpVersion(1),
    Escape: () => {
      if (compareVersion) closeCompare();
    },
  });

  async function handleOfflineDownload(quality: OfflineQuality) {
    if (!selectedVersion) return;
    offlineDownloading = true;
    offlineProgress = 0;
    try {
      await downloadForOffline(
        selectedVersion.id,
        quality,
        { trackId, projectId, title: trackName, versionNumber: selectedVersion.versionNumber },
        (pct) => { offlineProgress = pct; },
      );
      toastSuccess('Offline verfügbar');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Fehler';
      toastSuccess(`Download fehlgeschlagen: ${msg}`);
    } finally {
      offlineDownloading = false;
    }
  }

  async function handleOfflineRemove() {
    if (!selectedVersion) return;
    await removeOffline(selectedVersion.id);
    toastSuccess('Offline-Version entfernt');
  }

  async function deleteVersion() {
    if (!selectedVersion) return;
    if (!confirm(`Version V${selectedVersion.versionNumber} wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    await api.delete(`/versions/${selectedVersion.id}`);
    toastSuccess('Version gelöscht');
    await loadVersions();
  }

  function handleWindowClick(e: MouseEvent) {
    if (!(e.target as Element).closest('.track-menu-root')) trackMenuOpen = false;
  }
</script>

<svelte:window onclick={handleWindowClick} />

<TopBar
  crumbs={[
    { label: 'Projekte', href: '/dashboard' },
    { label: projectName || '…', href: `/projects/${projectId}` },
    { label: trackName || '…' },
  ]}
>
  {#snippet actions()}
    <Button size="sm" variant="ghost" onclick={() => (shareOpen = true)}>
      <Icon name="share" size={14} /> <span class="btn-label">Teilen</span>
    </Button>
    {#if !isNarrow}
      <button class="panel-toggle" class:open={panelOpen} onclick={() => (panelOpen = !panelOpen)} title="Seitenleiste umschalten" aria-label="Seitenleiste umschalten">
        <Icon name="panel" size={16} />
      </button>
    {/if}
  {/snippet}
</TopBar>

<div class="track-workspace">
  <main class="player-area">
    {#if loading}
      <div class="loading-block">
        <Skeleton width="60%" height="2rem" />
        <Skeleton height="120px" variant="rect" />
      </div>
    {:else}
      <div class="track-head">
        <button class="track-cover-btn" onclick={() => canUpload && (coverEditOpen = true)} disabled={!canUpload} aria-label="Cover ändern">
          <CoverImage src={trackCoverUrl} name={trackName} size="lg" rounded="lg" />
        </button>
        <div class="title-block">
          <h1>{trackName}</h1>
          <div class="meta-row">
            <button class="status-trigger" onclick={() => canUpload && (statusMenuOpen = !statusMenuOpen)} disabled={!canUpload}>
              <TrackStatusPill status={trackStatus} size="md" />
            </button>
            {#if statusMenuOpen}
              <div class="status-menu" role="menu">
                {#each TRACK_STATUSES as s}
                  <button onclick={() => setTrackStatus(s)} class:active={s === trackStatus}>
                    <TrackStatusPill status={s} />
                  </button>
                {/each}
              </div>
            {/if}
            {#if trackSection}
              <span class="section-tag">{trackSection}</span>
            {/if}
            <button class="chip" onclick={openVersions}>
              <Icon name="list" size={13} /><b>{versions.length}</b> {versions.length === 1 ? 'Version' : 'Versionen'}
            </button>
            <button class="chip" onclick={openSpuren}>
              <Icon name="music" size={13} /><b>{stems.length}</b> {stems.length === 1 ? 'Spur' : 'Spuren'}
            </button>
          </div>
        </div>
        {#if canUpload || role === 'owner'}
          <div class="track-menu-root">
            <button class="icon-btn" title="Track-Aktionen" aria-label="Track-Aktionen" onclick={() => (trackMenuOpen = !trackMenuOpen)}>
              <Icon name="more" size={18} />
            </button>
            {#if trackMenuOpen}
              <div class="menu" role="menu">
                {#if canUpload}
                  <button role="menuitem" onclick={() => { trackMenuOpen = false; coverEditOpen = true; }}><Icon name="upload" size={14} /> Cover ändern</button>
                  <button role="menuitem" onclick={() => { trackMenuOpen = false; openRename(); }}><Icon name="edit" size={14} /> Umbenennen</button>
                {/if}
                {#if role === 'owner'}
                  <hr />
                  <button role="menuitem" class="danger" onclick={() => { trackMenuOpen = false; deleteTrack(); }}><Icon name="trash" size={14} /> Track löschen</button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      {#if showUpload}
        <div class="upload-zone">
          <button class="close-upload" onclick={() => { showUpload = false; branchFromId = null; }} title="Schließen" aria-label="Upload schließen">
            <Icon name="x" size={16} />
          </button>
          {#if branchFromId}
            <div class="branch-banner">
              <span>Variante von <strong>V{versions.find((v) => v.id === branchFromId)?.versionNumber}</strong></span>
              <input type="text" bind:value={branchLabelInput} placeholder="Name der Variante (z.B. 'andere Vocals')" />
              <button class="cancel-branch" onclick={() => (branchFromId = null)} aria-label="Variante abbrechen">×</button>
            </div>
          {/if}
          <UploadDropzone
            {trackId}
            parentVersionId={branchFromId}
            branchLabel={branchFromId ? branchLabelInput || 'Variante' : null}
            onUploaded={(count) => {
              showUpload = false;
              branchFromId = null;
              loadVersions();
              toastSuccess(count === 1 ? 'Version hochgeladen' : `${count} Versionen hochgeladen`);
            }}
          />
        </div>
      {/if}

      {#if versions.length === 0}
        <EmptyState
          title="Noch keine Version"
          description="Lade dein erstes Audio hoch — wir kümmern uns um Wellenform und Vorschau."
        >
          {#snippet action()}
            {#if canUpload}
              <Button onclick={openUpload}>Audio hochladen</Button>
            {/if}
          {/snippet}
        </EmptyState>
      {:else if selectedVersion && streamUrl}
        <VersionCard
          version={selectedVersion}
          {versions}
          narrow={isNarrow}
          {canApprove}
          {canUpload}
          isOwner={role === 'owner'}
          offlineAvailable={isOffline(selectedVersion.id)}
          {offlineDownloading}
          {offlineProgress}
          onSelect={selectVersion}
          onOpenVersions={() => (versionsSheetOpen = true)}
          onUpload={openUpload}
          onApprove={handleApprove}
          onReject={handleReject}
          onCompare={startCompare}
          onEdit={openVersionEdit}
          onDownload={handleDownload}
          onOfflineDownload={handleOfflineDownload}
          onOfflineRemove={handleOfflineRemove}
          onBranch={startBranch}
          onPromote={handlePromote}
          onDelete={deleteVersion}
        >
          {#snippet player()}
            {#key streamUrl}
              <WaveformPlayer
                bind:this={playerRef}
                url={streamUrl}
                initialTime={nextInitialTime}
                autoPlay={nextAutoPlay}
                markers={comments
                  .filter((c) => c.timestampSeconds !== null)
                  .map((c) => ({
                    id: c.id,
                    timestampSeconds: c.timestampSeconds!,
                    body: c.body,
                    userName: c.user?.name ?? c.guestName ?? 'Gast',
                  }))}
                onTimeClick={(time) => (commentTimestamp = Math.round(time * 10) / 10)}
                onSeek={(time) => (currentTime = time)}
              />
            {/key}
          {/snippet}
        </VersionCard>

        <CommentSection
          bind:this={commentSection}
          versionLabel={`V${selectedVersion.versionNumber}`}
          {comments}
          carryLabel={predecessor ? `V${predecessor.versionNumber}` : null}
          carryComments={predecessorComments}
          {canComment}
          currentUserId={$user?.id ?? null}
          {currentTime}
          bind:commentTimestamp
          onSubmit={handleComment}
          onReply={handleReply}
          onResolve={handleResolve}
          onReopen={handleReopen}
          onEdit={handleEditComment}
          onDelete={handleDeleteComment}
          onSeek={(time) => playerRef?.seekToTime(time)}
        />
      {/if}
    {/if}

    {#if compareVersion && compareStreamUrl && selectedVersion && streamUrl}
      <div class="compare-overlay" role="dialog" aria-modal="true">
        <ABCompare
          versionA={selectedVersion}
          versionB={compareVersion}
          streamUrlA={streamUrl}
          streamUrlB={compareStreamUrl}
          onClose={closeCompare}
        />
      </div>
    {/if}
  </main>

  {#if panelOpen && !isNarrow}
    <aside class="side-panel">
      <section id="panel-versions" class="panel-section versions">
        <VersionList
          {versions}
          selectedId={selectedVersion?.id ?? null}
          {canUpload}
          onSelect={selectVersion}
          onUpload={openUpload}
        />
      </section>
      <section id="panel-spuren" class="panel-section spuren">
        <StemList {trackId} {trackName} bind:stems {canUpload} currentUserId={$user?.id ?? null} {role} />
      </section>
    </aside>
  {/if}
</div>

{#if isNarrow}
  <Sheet bind:open={versionsSheetOpen} title="Versionen">
    <VersionList
      {versions}
      selectedId={selectedVersion?.id ?? null}
      {canUpload}
      onSelect={(v) => { versionsSheetOpen = false; selectVersion(v); }}
      onUpload={openUpload}
    />
  </Sheet>
  <Sheet bind:open={spurenSheetOpen} title="Spuren">
    <StemList {trackId} {trackName} bind:stems {canUpload} currentUserId={$user?.id ?? null} {role} />
  </Sheet>
{/if}

{#if selectedVersion}
  <ShareModal bind:open={shareOpen} versionId={selectedVersion.id} />
{/if}

<Modal bind:open={rejectOpen} title="Version ablehnen">
  <div class="edit-form">
    <label>
      <span class="lbl">Begründung <span style="color: var(--color-error)">*</span></span>
      <textarea bind:value={rejectReason} rows="4" placeholder="Was muss geändert werden? (Pflichtfeld)"></textarea>
    </label>
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (rejectOpen = false)}>Abbrechen</Button>
    <Button onclick={submitReject} loading={rejecting} disabled={!rejectReason.trim()}>Ablehnen</Button>
  {/snippet}
</Modal>

<Modal bind:open={coverEditOpen} title="Track-Cover ändern">
  <div class="cover-modal">
    <CoverUpload currentUrl={trackCoverUrl} name={trackName} onUploaded={saveTrackCover} />
  </div>
  {#snippet actions()}
    <Button onclick={() => (coverEditOpen = false)}>Schließen</Button>
  {/snippet}
</Modal>

<Modal bind:open={renameOpen} title="Track umbenennen">
  <form class="edit-form" onsubmit={(e) => { e.preventDefault(); saveRename(); }}>
    <label>
      <span class="lbl">Name</span>
      <input type="text" bind:value={renameValue} maxlength="255" />
    </label>
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (renameOpen = false)}>Abbrechen</Button>
    <Button onclick={saveRename} disabled={!renameValue.trim()}>Speichern</Button>
  {/snippet}
</Modal>

<Modal bind:open={editVersionOpen} title="Version bearbeiten">
  <div class="edit-form">
    <label>
      <span class="lbl">Bezeichnung</span>
      <input type="text" bind:value={editVersionLabel} placeholder="z.B. 'Mehr Bass'" />
    </label>
    <label>
      <span class="lbl">Notizen</span>
      <textarea bind:value={editVersionNotes} rows="4" placeholder="Was hat sich geändert?"></textarea>
    </label>
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (editVersionOpen = false)}>Abbrechen</Button>
    <Button onclick={saveVersion} loading={savingVersion}>Speichern</Button>
  {/snippet}
</Modal>

<style>
  .track-workspace {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .player-area {
    flex: 1;
    min-width: 0;
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    overflow-y: auto;
  }
  @media (max-width: 640px) {
    .player-area {
      padding: var(--space-4);
      gap: var(--space-4);
    }
  }

  .loading-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .track-head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .track-head h1 {
    margin: 0;
    font-size: var(--text-2xl);
    word-break: break-word;
  }
  @media (max-width: 540px) {
    .track-head h1 {
      font-size: var(--text-xl);
    }
  }
  .title-block {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .meta-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    position: relative;
  }
  .status-trigger {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    border-radius: var(--radius-full);
  }
  .status-trigger:disabled {
    cursor: default;
  }
  .status-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: var(--shadow-md);
  }
  .status-menu button {
    background: none;
    border: none;
    padding: 6px 8px;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .status-menu button:hover {
    background: var(--color-bg-raised);
  }
  .status-menu button.active {
    background: var(--color-bg-subtle);
  }
  .section-tag {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border);
    padding: 3px 8px;
    border-radius: var(--radius-full);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-full);
    background: var(--color-bg-raised);
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--text-xs);
    white-space: nowrap;
    cursor: pointer;
  }
  .chip b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .chip:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-focus);
  }
  .track-cover-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    border-radius: var(--radius-lg);
    transition: transform var(--transition-fast);
  }
  .track-cover-btn:not(:disabled):hover {
    transform: scale(1.04);
  }
  .track-cover-btn:disabled {
    cursor: default;
  }
  .cover-modal {
    display: flex;
    justify-content: center;
    padding: var(--space-3) 0;
  }

  .track-menu-root {
    position: relative;
    align-self: flex-start;
  }
  .icon-btn {
    width: 32px;
    height: 32px;
    display: inline-grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: var(--z-dropdown);
    min-width: 220px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 8px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--text-sm);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }
  .menu .danger {
    color: var(--color-error);
  }
  .menu hr {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 4px;
  }

  .edit-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .edit-form label {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .edit-form .lbl {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .edit-form input,
  .edit-form textarea {
    padding: 0.7rem 0.9rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    font-size: var(--text-sm);
    font-family: inherit;
  }
  .edit-form input:focus,
  .edit-form textarea:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.12);
  }

  .upload-zone {
    position: relative;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    /* scrollIntoView stops below the sticky TopBar (65px) instead of under it */
    scroll-margin-top: calc(65px + var(--space-4));
  }
  .close-upload {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
  }
  .close-upload:hover {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }
  .branch-banner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-accent-subtle);
    border: 1px solid rgba(244, 63, 94, 0.3);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-3);
  }
  .branch-banner input {
    flex: 1;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-size: var(--text-sm);
    font-family: inherit;
  }
  .cancel-branch {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    font-size: 1.2rem;
  }

  .compare-overlay {
    position: fixed;
    inset: 0;
    background: rgba(8, 6, 14, 0.7);
    backdrop-filter: blur(10px);
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
  }

  /* The page scrolls as a whole; the panel sticks below the TopBar (65px high) so the raw tracks stay in view. */
  .side-panel {
    position: sticky;
    top: 65px;
    align-self: flex-start;
    height: calc(100vh - 65px);
    width: 320px;
    flex-shrink: 0;
    border-left: 1px solid var(--color-border);
    background: var(--color-bg-raised);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel-section {
    padding: var(--space-5) var(--space-4) var(--space-4);
  }
  .panel-section + .panel-section {
    border-top: 1px solid var(--color-border);
  }
  .panel-section.versions {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .panel-section.spuren {
    flex: 1 1 auto;
    min-height: 200px;
    display: flex;
    flex-direction: column;
  }
  @media (max-width: 1180px) {
    .side-panel {
      width: 280px;
    }
  }

  @media (max-width: 480px) {
    .btn-label {
      display: none;
    }
  }

  .panel-toggle {
    background: none;
    border: 1px solid var(--color-border);
    color: var(--color-text-tertiary);
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    cursor: pointer;
    font-family: inherit;
    transition: all var(--transition-fast);
  }
  .panel-toggle:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-hover);
  }
  .panel-toggle.open {
    color: var(--color-accent);
    border-color: var(--color-accent);
    background: var(--color-accent-subtle);
  }
</style>
