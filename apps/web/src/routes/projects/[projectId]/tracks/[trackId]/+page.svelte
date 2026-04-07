<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import WaveformPlayer from '$lib/components/audio/WaveformPlayer.svelte';
  import UploadDropzone from '$lib/components/audio/UploadDropzone.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import ABCompare from '$lib/components/audio/ABCompare.svelte';
  import VersionInfo from './components/VersionInfo.svelte';
  import VersionHistory from './components/VersionHistory.svelte';
  import VersionGraph from './components/VersionGraph.svelte';
  import ShareModal from './components/ShareModal.svelte';
  import CommentSection from './components/CommentSection.svelte';

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

  const projectId = $page.params.projectId!;
  const trackId = $page.params.trackId!;

  let trackName = $state('');
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
  let viewMode = $state<'list' | 'graph'>('list');
  let branchFromId = $state<string | null>(null);
  let branchLabelInput = $state('');
  let shareOpen = $state(false);

  const canUpload = $derived(role === 'owner' || role.includes('engineer'));
  const canApprove = $derived(['owner', 'artist', 'label', 'management'].includes(role));
  const canComment = $derived(role !== 'viewer');

  onMount(async () => {
    try {
      const [projectRes, trackVersions, tracksRes, treeRes] = await Promise.all([
        api.get<{ project: any; role: string }>(`/projects/${projectId}`),
        api.get<{ versions: Version[] }>(`/versions/track/${trackId}`),
        api.get<{ tracks: { id: string; name: string }[] }>(`/tracks/project/${projectId}`),
        api.get<{ nodes: GraphNode[] }>(`/versions/track/${trackId}/tree`),
      ]);

      role = projectRes.role;
      trackName = tracksRes.tracks.find((t) => t.id === trackId)?.name || '';
      versions = trackVersions.versions;
      graphNodes = treeRes.nodes;

      if (versions.length > 0) await selectVersion(versions[0]);
    } finally {
      loading = false;
    }
  });

  async function selectVersion(version: Version) {
    selectedVersion = version;
    const [streamRes, commentRes] = await Promise.all([
      api.get<{ url: string }>(`/versions/${version.id}/stream-url`),
      api.get<{ comments: Comment[] }>(`/comments/version/${version.id}`),
    ]);
    streamUrl = streamRes.url;
    comments = commentRes.comments;
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
    toastSuccess('Version übernommen');
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
    toastSuccess('Version approved');
    await loadVersions();
  }

  async function handleReject() {
    if (!selectedVersion) return;
    await api.post(`/versions/${selectedVersion.id}/reject`);
    toastSuccess('Version rejected');
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
    toastSuccess('Comment added');
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
</script>

<div class="track-page">
  <header>
    <a href="/projects/{projectId}" class="back">&larr; Back to project</a>
    {#if loading}
      <Skeleton width="200px" height="2rem" />
    {:else}
      <h1>{trackName}</h1>
    {/if}
  </header>

  <!-- Player -->
  {#if selectedVersion && streamUrl}
    {#key streamUrl}
      <WaveformPlayer
        bind:this={playerRef}
        url={streamUrl}
        markers={comments
          .filter((c) => c.timestampSeconds !== null)
          .map((c) => ({
            id: c.id,
            timestampSeconds: c.timestampSeconds!,
            body: c.body,
            userName: c.user?.name ?? c.guestName ?? 'Gast',
          }))}
        onTimeClick={(time) => commentTimestamp = Math.round(time * 10) / 10}
      />
    {/key}

    <VersionInfo
      version={selectedVersion}
      {canApprove}
      onApprove={handleApprove}
      onReject={handleReject}
    />

    <div class="track-actions">
      {#if canUpload}
        <Button variant="secondary" size="sm" onclick={() => { branchFromId = null; branchLabelInput = ''; showUpload = !showUpload; }}>
          {showUpload ? 'Cancel' : 'Upload new version'}
        </Button>
      {/if}
      <Button variant="ghost" size="sm" onclick={handleDownload}>
        ↓ Download
      </Button>
      <Button variant="ghost" size="sm" onclick={() => (shareOpen = true)}>
        ↗ Share
      </Button>
      {#if canApprove && selectedVersion.branchLabel}
        <Button variant="ghost" size="sm" onclick={handlePromote}>
          ⤴ Übernehmen (Mainline)
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
          <option value="">Compare with...</option>
          {#each versions.filter((v) => v.id !== selectedVersion?.id) as v}
            <option value={v.id}>V{v.versionNumber}{v.label ? ` — ${v.label}` : ''}</option>
          {/each}
        </select>
      {/if}
    </div>
  {/if}

  <!-- A/B Compare -->
  {#if compareVersion && compareStreamUrl && selectedVersion && streamUrl}
    <ABCompare
      versionA={selectedVersion}
      versionB={compareVersion}
      streamUrlA={streamUrl}
      streamUrlB={compareStreamUrl}
      onClose={closeCompare}
    />
  {/if}

  {#if showUpload}
    {#if branchFromId}
      <div class="branch-banner">
        <span>Neue Variante von <strong>V{graphNodes.find((n) => n.id === branchFromId)?.versionNumber}</strong></span>
        <input
          type="text"
          bind:value={branchLabelInput}
          placeholder="Branch-Name (z.B. 'vocals-neu')"
        />
        <button class="cancel-branch" onclick={() => (branchFromId = null)}>×</button>
      </div>
    {/if}
    <UploadDropzone
      {trackId}
      parentVersionId={branchFromId}
      branchLabel={branchFromId ? branchLabelInput || 'branch' : null}
      onUploaded={() => { showUpload = false; branchFromId = null; loadVersions(); toastSuccess('Version uploaded'); }}
    />
  {/if}

  {#if loading}
    <Skeleton height="80px" variant="rect" />
  {:else if versions.length === 0}
    <EmptyState
      icon="🎵"
      title="No versions yet"
      description="Upload your first audio file to get started."
    >
      {#snippet action()}
        {#if canUpload}
          <Button onclick={() => showUpload = true}>Upload Audio</Button>
        {/if}
      {/snippet}
    </EmptyState>
  {/if}

  {#if selectedVersion}
    <CommentSection
      {comments}
      {canComment}
      bind:commentTimestamp
      onSubmit={handleComment}
      onResolve={handleResolve}
      onSeek={(time) => playerRef?.seekToTime(time)}
    />
  {/if}

  {#if versions.length > 1}
    <div class="view-toggle">
      <button class:active={viewMode === 'list'} onclick={() => (viewMode = 'list')}>Liste</button>
      <button class:active={viewMode === 'graph'} onclick={() => (viewMode = 'graph')}>Graph</button>
    </div>
  {/if}

  {#if viewMode === 'graph'}
    <VersionGraph
      nodes={graphNodes}
      selectedId={selectedVersion?.id ?? null}
      onSelect={(id) => {
        const v = versions.find((v) => v.id === id);
        if (v) selectVersion(v);
      }}
      onBranch={canUpload ? startBranch : undefined}
    />
  {:else}
    <VersionHistory
      {versions}
      selectedId={selectedVersion?.id ?? null}
      onSelect={selectVersion}
    />
  {/if}

  {#if selectedVersion}
    <ShareModal bind:open={shareOpen} versionId={selectedVersion.id} />
  {/if}
</div>

<style>
  .track-page {
    max-width: 800px;
    margin: 0 auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  header {
    margin-bottom: var(--space-2);
  }

  .back {
    color: var(--color-text-tertiary);
    text-decoration: none;
    font-size: var(--text-sm);
  }

  .back:hover {
    color: var(--color-text-primary);
  }

  h1 {
    margin: var(--space-2) 0 0;
  }

  .track-actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }

  .view-toggle {
    display: flex;
    gap: var(--space-1);
  }
  .view-toggle button {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    cursor: pointer;
    font-family: inherit;
  }
  .view-toggle button.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .branch-banner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-accent-subtle);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
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

  .compare-select {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-family: inherit;
    cursor: pointer;
  }
</style>
