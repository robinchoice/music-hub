<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api/client.js';
  import { user } from '$lib/stores/auth.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import WaveformPlayer from '$lib/components/audio/WaveformPlayer.svelte';
  import UploadDropzone from '$lib/components/audio/UploadDropzone.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import ABCompare from '$lib/components/audio/ABCompare.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import CoverUpload from '$lib/components/ui/CoverUpload.svelte';
  import TrackStatusPill from '$lib/components/ui/TrackStatusPill.svelte';
  import { onKey } from '$lib/utils/shortcuts.js';
  import { snapshotForTrack, continuationFor } from '$lib/stores/player.js';
  import { TRACK_STATUSES, TRACK_STATUS_LABELS, type TrackStatus } from '@music-hub/shared';
  import VersionInfo from './components/VersionInfo.svelte';
  import VersionGraph from './components/VersionGraph.svelte';
  import ShareModal from './components/ShareModal.svelte';
  import CommentSection from './components/CommentSection.svelte';
  import StemList from './components/StemList.svelte';

  type Version = {
    id: string;
    versionNumber: number;
    label: string | null;
    notes: string | null;
    status: string;
    originalFileName: string;
    duration: number | null;
    createdAt: string;
    parentVersionId?: string | null;
    branchLabel?: string | null;
  };

  type GraphNode = {
    id: string;
    parentVersionId: string | null;
    branchLabel: string | null;
    versionNumber: number;
    label: string | null;
    status: string;
    createdAt: string;
  };

  type Comment = {
    id: string;
    body: string;
    timestampSeconds: number | null;
    parentId: string | null;
    resolvedAt: string | null;
    createdAt: string;
    guestName?: string | null;
    user: { id: string; name: string; avatarUrl: string | null } | null;
  };

  const projectId = ($page.params as Record<string, string>).projectId;
  const trackId = ($page.params as Record<string, string>).trackId;

  let projectName = $state('');
  let trackName = $state('');
  let trackStatus = $state<TrackStatus>('in_progress');
  let trackSection = $state<string | null>(null);
  let trackCoverUrl = $state<string | null>(null);
  let coverEditOpen = $state(false);
  let statusMenuOpen = $state(false);
  let nextInitialTime = $state(0);
  let nextAutoPlay = $state(false);
  let versions = $state<Version[]>([]);
  let selectedVersion = $state<Version | null>(null);
  let streamUrl = $state('');
  let comments = $state<Comment[]>([]);
  let showUpload = $state(false);
  let role = $state('');
  let loading = $state(true);
  let commentTimestamp = $state<number | null>(null);
  let playerRef = $state<WaveformPlayer>();
  let compareVersion = $state<Version | null>(null);
  let compareStreamUrl = $state('');
  let graphNodes = $state<GraphNode[]>([]);
  let branchFromId = $state<string | null>(null);
  let branchLabelInput = $state('');
  let shareOpen = $state(false);
  type Stem = { id: string; name: string; originalFileName: string; mimeType: string; fileSize: number; createdAt: string; createdById: string };
  let stems = $state<Stem[]>([]);
  let panelTab = $state<'versions' | 'comments' | 'stems'>('versions');
  let panelOpen = $state(true);
  let editVersionOpen = $state(false);
  let editVersionLabel = $state('');
  let editVersionNotes = $state('');
  let savingVersion = $state(false);

  const canUpload = $derived(role === 'owner' || role.includes('engineer'));
  const canApprove = $derived(['owner', 'artist', 'label', 'management'].includes(role));
  const canComment = $derived(role !== 'viewer');

  onMount(async () => {
    try {
      const [projectRes, trackVersions, tracksRes, treeRes, stemsRes] = await Promise.all([
        api.get<{ project: { name: string }; role: string }>(`/projects/${projectId}`),
        api.get<{ versions: Version[] }>(`/versions/track/${trackId}`),
        api.get<{ tracks: { id: string; name: string; coverUrl: string | null; status: TrackStatus; section: string | null }[] }>(`/tracks/project/${projectId}`),
        api.get<{ nodes: GraphNode[] }>(`/versions/track/${trackId}/tree`),
        api.get<{ stems: Stem[] }>(`/stems/track/${trackId}`),
      ]);

      projectName = projectRes.project.name;
      role = projectRes.role;
      const t = tracksRes.tracks.find((t) => t.id === trackId) as any;
      trackName = t?.name || '';
      trackCoverUrl = t?.coverUrl ?? null;
      trackStatus = (t?.status ?? 'in_progress') as TrackStatus;
      trackSection = t?.section ?? null;
      versions = trackVersions.versions;
      graphNodes = treeRes.nodes;
      stems = stemsRes.stems;

      if (versions.length > 0) await selectVersion(versions[0]);
    } finally {
      loading = false;
    }
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
    const [streamRes, commentRes] = await Promise.all([
      api.get<{ url: string }>(`/versions/${version.id}/stream-url`),
      api.get<{ comments: Comment[] }>(`/comments/version/${version.id}`),
    ]);
    streamUrl = streamRes.url;
    comments = commentRes.comments;
  }

  async function setTrackStatus(s: TrackStatus) {
    trackStatus = s;
    statusMenuOpen = false;
    await api.patch(`/tracks/${trackId}`, { status: s });
    toastSuccess(`Status: ${TRACK_STATUS_LABELS[s]}`);
  }

  async function loadVersions() {
    const [res, treeRes] = await Promise.all([
      api.get<{ versions: Version[] }>(`/versions/track/${trackId}`),
      api.get<{ nodes: GraphNode[] }>(`/versions/track/${trackId}/tree`),
    ]);
    versions = res.versions;
    graphNodes = treeRes.nodes;
    if (versions.length > 0) await selectVersion(versions[0]);
  }

  async function handlePromote() {
    if (!selectedVersion) return;
    await api.post(`/versions/${selectedVersion.id}/promote`);
    toastSuccess('Als Hauptversion festgelegt');
    await loadVersions();
  }

  function startBranch(id: string) {
    branchFromId = id;
    branchLabelInput = '';
    showUpload = true;
  }

  async function handleApprove() {
    if (!selectedVersion) return;
    await api.post(`/versions/${selectedVersion.id}/approve`);
    toastSuccess('Version freigegeben');
    await loadVersions();
  }

  async function handleReject() {
    if (!selectedVersion) return;
    await api.post(`/versions/${selectedVersion.id}/reject`);
    toastSuccess('Version abgelehnt');
    await loadVersions();
  }

  async function handleComment(body: string, timestamp: number | null, parentId?: string) {
    if (!selectedVersion) return;
    await api.post(`/comments/version/${selectedVersion.id}`, {
      body,
      timestampSeconds: timestamp ?? undefined,
      parentId,
    });
    const res = await api.get<{ comments: Comment[] }>(`/comments/version/${selectedVersion.id}`);
    comments = res.comments;
    toastSuccess('Kommentar gespeichert');
  }

  async function handleEditComment(id: string, body: string) {
    await api.patch(`/comments/${id}`, { body });
    if (selectedVersion) {
      const res = await api.get<{ comments: Comment[] }>(`/comments/version/${selectedVersion.id}`);
      comments = res.comments;
    }
  }

  async function handleDeleteComment(id: string) {
    if (!confirm('Diesen Kommentar wirklich löschen?')) return;
    await api.delete(`/comments/${id}`);
    if (selectedVersion) {
      const res = await api.get<{ comments: Comment[] }>(`/comments/version/${selectedVersion.id}`);
      comments = res.comments;
    }
  }

  async function handleResolve(commentId: string) {
    await api.post(`/comments/${commentId}/resolve`);
    if (selectedVersion) {
      const res = await api.get<{ comments: Comment[] }>(`/comments/version/${selectedVersion.id}`);
      comments = res.comments;
    }
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
    const res = await api.patch<{ track: { coverImageUrl: string | null } }>(`/tracks/${trackId}`, { coverImageUrl: key });
    // Reload list to refresh signed URL via /tracks/project/:id
    const tracksRes = await api.get<{ tracks: { id: string; coverUrl: string | null }[] }>(`/tracks/project/${projectId}`);
    trackCoverUrl = tracksRes.tracks.find((t) => t.id === trackId)?.coverUrl ?? null;
    coverEditOpen = false;
    toastSuccess('Cover gespeichert');
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
      await loadVersions();
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
    panelTab = 'comments';
    panelOpen = true;
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.comments-section input[type="text"]');
      input?.focus();
    }, 50);
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

  async function deleteVersion() {
    if (!selectedVersion) return;
    if (!confirm(`Version V${selectedVersion.versionNumber} wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    await api.delete(`/versions/${selectedVersion.id}`);
    toastSuccess('Version gelöscht');
    await loadVersions();
  }
</script>

<TopBar
  crumbs={[
    { label: 'Projekte', href: '/dashboard' },
    { label: projectName || '…', href: `/projects/${projectId}` },
    { label: trackName || '…' },
  ]}
>
  {#snippet actions()}
    {#if canUpload}
      <Button size="sm" variant="ghost" onclick={() => { branchFromId = null; branchLabelInput = ''; showUpload = !showUpload; }}>
        <Icon name="upload" size={14} /> Hochladen
      </Button>
    {/if}
    <Button size="sm" variant="ghost" onclick={() => (shareOpen = true)}>
      <Icon name="share" size={14} /> Teilen
    </Button>
    <button class="panel-toggle" class:open={panelOpen} onclick={() => (panelOpen = !panelOpen)} title="Seitenleiste umschalten" aria-label="Seitenleiste umschalten">
      <Icon name="panel" size={16} />
    </button>
  {/snippet}
</TopBar>

<div class="track-workspace">
  <main class="player-area">
    {#if loading}
      <div class="loading-block">
        <Skeleton width="60%" height="2rem" />
        <Skeleton height="120px" variant="rect" />
      </div>
    {:else if versions.length === 0}
      <EmptyState
        title="Noch keine Version"
        description="Lade dein erstes Audio hoch — wir kümmern uns um Wellenform und Vorschau."
      >
        {#snippet action()}
          {#if canUpload}
            <Button onclick={() => (showUpload = true)}>Audio hochladen</Button>
          {/if}
        {/snippet}
      </EmptyState>
    {:else if selectedVersion && streamUrl}
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
          </div>
        </div>
        <VersionInfo
          version={selectedVersion}
          {canApprove}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      </div>

      <div class="player-card">
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
          />
        {/key}
      </div>

      <div class="toolbar">
        <Button variant="ghost" size="sm" onclick={handleDownload}>
          <Icon name="download" size={14} /> Download Original
        </Button>
        {#if canUpload}
          <Button variant="ghost" size="sm" onclick={openVersionEdit}>
            <Icon name="settings" size={14} /> Bearbeiten
          </Button>
        {/if}
        {#if role === 'owner'}
          <Button variant="ghost" size="sm" onclick={deleteVersion}>
            <span class="danger-text"><Icon name="x" size={14} /> Version löschen</span>
          </Button>
          <Button variant="ghost" size="sm" onclick={deleteTrack}>
            <span class="danger-text"><Icon name="x" size={14} /> Track löschen</span>
          </Button>
        {/if}
        {#if canApprove && selectedVersion.branchLabel}
          <Button variant="ghost" size="sm" onclick={handlePromote}>
            <Icon name="arrow-up" size={14} /> Als Hauptversion
          </Button>
        {/if}
        {#if versions.length > 1}
          <select
            class="compare-select"
            onchange={(e) => {
              const id = (e.target as HTMLSelectElement).value;
              if (id) {
                const v = versions.find((v) => v.id === id);
                if (v) startCompare(v);
              }
              (e.target as HTMLSelectElement).value = '';
            }}
          >
            <option value="">Vergleichen mit…</option>
            {#each versions.filter((v) => v.id !== selectedVersion?.id) as v}
              <option value={v.id}>V{v.versionNumber}{v.label ? ` — ${v.label}` : ''}</option>
            {/each}
          </select>
        {/if}
      </div>
    {/if}

    {#if showUpload}
      <div class="upload-zone">
        {#if branchFromId}
          <div class="branch-banner">
            <span>Variante von <strong>V{graphNodes.find((n) => n.id === branchFromId)?.versionNumber}</strong></span>
            <input
              type="text"
              bind:value={branchLabelInput}
              placeholder="Name der Variante (z.B. 'andere Vocals')"
            />
            <button class="cancel-branch" onclick={() => (branchFromId = null)}>×</button>
          </div>
        {/if}
        <UploadDropzone
          {trackId}
          parentVersionId={branchFromId}
          branchLabel={branchFromId ? branchLabelInput || 'Variante' : null}
          onUploaded={() => {
            showUpload = false;
            branchFromId = null;
            loadVersions();
            toastSuccess('Version hochgeladen');
          }}
        />
      </div>
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

  {#if panelOpen}
    <aside class="side-panel">
      <div class="tabs">
        <button class:active={panelTab === 'versions'} onclick={() => (panelTab = 'versions')}>
          Versionen <span class="badge">{versions.length}</span>
        </button>
        <button class:active={panelTab === 'comments'} onclick={() => (panelTab = 'comments')}>
          Kommentare <span class="badge">{comments.length}</span>
        </button>
        <button class:active={panelTab === 'stems'} onclick={() => (panelTab = 'stems')}>
          STEMs <span class="badge">{stems.length}</span>
        </button>
      </div>

      <div class="panel-body">
        {#if panelTab === 'versions'}
          {#if graphNodes.length === 0}
            <p class="muted">Noch keine Versionen.</p>
          {:else}
            <VersionGraph
              nodes={graphNodes}
              selectedId={selectedVersion?.id ?? null}
              onSelect={(id) => {
                const v = versions.find((v) => v.id === id);
                if (v) selectVersion(v);
              }}
              onBranch={canUpload ? startBranch : undefined}
            />
          {/if}
        {:else if panelTab === 'stems'}
          <StemList
            {trackId}
            bind:stems
            {canUpload}
            currentUserId={$user?.id ?? null}
            {role}
          />
        {:else if selectedVersion}
          <CommentSection
            {comments}
            {canComment}
            currentUserId={$user?.id ?? null}
            bind:commentTimestamp
            onSubmit={handleComment}
            onResolve={handleResolve}
            onEdit={handleEditComment}
            onDelete={handleDeleteComment}
            onSeek={(time) => playerRef?.seekToTime(time)}
          />
        {/if}
      </div>
    </aside>
  {/if}
</div>

{#if selectedVersion}
  <ShareModal bind:open={shareOpen} versionId={selectedVersion.id} />
{/if}

<Modal bind:open={coverEditOpen} title="Track-Cover ändern">
  <div class="cover-modal">
    <CoverUpload currentUrl={trackCoverUrl} name={trackName} onUploaded={saveTrackCover} />
  </div>
  {#snippet actions()}
    <Button onclick={() => (coverEditOpen = false)}>Schließen</Button>
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
    flex-wrap: wrap;
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

  .player-card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
  }
  @media (max-width: 540px) {
    .player-card {
      padding: var(--space-3);
    }
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  @media (max-width: 640px) {
    .toolbar :global(.btn) {
      flex: 1 0 calc(50% - var(--space-1));
      min-width: 0;
      justify-content: center;
    }
    .toolbar .compare-select {
      flex: 1 0 100%;
    }
  }

  .danger-text {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--color-error);
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

  .compare-select {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-raised);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-family: inherit;
    cursor: pointer;
  }
  .compare-select:hover {
    border-color: var(--color-border-hover);
  }

  .upload-zone {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
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

  /* SIDE PANEL */
  .side-panel {
    width: 320px;
    flex-shrink: 0;
    border-left: 1px solid var(--color-border);
    background: var(--color-bg-raised);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--color-border);
  }
  .tabs button {
    flex: 1;
    background: none;
    border: none;
    color: var(--color-text-secondary);
    padding: var(--space-4) var(--space-3);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    border-bottom: 2px solid transparent;
    transition: all var(--transition-fast);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }
  .tabs button:hover {
    color: var(--color-text-primary);
  }
  .tabs button.active {
    color: var(--color-text-primary);
    border-bottom-color: var(--color-accent);
  }
  .badge {
    background: var(--color-bg-subtle);
    color: var(--color-text-tertiary);
    padding: 0.05rem 0.45rem;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .tabs button.active .badge {
    background: var(--color-accent-subtle);
    color: var(--color-accent);
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5);
  }
  .muted {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
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

  @media (max-width: 1180px) {
    .side-panel {
      width: 280px;
    }
  }
  @media (max-width: 1024px) {
    .track-workspace {
      flex-direction: column;
    }
    .side-panel {
      width: 100%;
      border-left: none;
      border-top: 1px solid var(--color-border);
    }
  }
</style>
