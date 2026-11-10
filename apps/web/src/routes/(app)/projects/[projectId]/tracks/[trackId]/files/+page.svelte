<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/index.js';
  import { api } from '$lib/api/client.js';
  import { user } from '$lib/stores/auth.js';
  import { loadOverview, overviewIndex } from '$lib/stores/overview.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import type { ProjectFile } from '$lib/components/workspace/ProjectFiles.svelte';
  import StemList, { type Stem, type GuestNote } from '../components/StemList.svelte';
  import TrackFiles from '../components/TrackFiles.svelte';
  import { capabilities, isProcessing, versionTitle, type Version } from '$lib/utils/track.js';
  import type { MemberRights } from '@music-hub/shared';
  import { trackHref } from '$lib/utils/overview.js';
  import { formatTime, formatWhen } from '$lib/utils/format.js';
  import { artistOf, musicCrumbs } from '$lib/utils/music.js';

  // A track as a folder, like in a drive: its versions, its stems and the files filed with it.
  // Listening, comments and A/B stay on the track page ("Im Player öffnen").
  const projectId = ($page.params as Record<string, string>).projectId;
  const trackId = ($page.params as Record<string, string>).trackId;

  let project = $state<{ name: string; isArchived: boolean } | null>(null);
  let track = $state<{ name: string; coverUrl: string | null } | null>(null);
  let rights = $state<MemberRights | null>(null);
  let role = $state('');
  let versions = $state<Version[]>([]);
  let stems = $state<Stem[]>([]);
  let guestNotes = $state<GuestNote[]>([]);
  let files = $state<ProjectFile[]>([]);
  let canDownloadFiles = $state(false);
  let projectTracks = $state<{ id: string; name: string }[]>([]);
  let loading = $state(true);
  let missing = $state(false);

  const can = $derived(capabilities(rights));
  const canUpload = $derived(can.canUpload && !project?.isArchived);
  const trackFiles = $derived(files.filter((f) => f.trackId === trackId));
  const ix = $derived($overviewIndex);
  const artist = $derived(ix?.projects.get(projectId) ? artistOf(ix.projects.get(projectId)!) : '');
  const player = trackHref(projectId, trackId);
  const m = $derived(t().workspace.music);

  onMount(async () => {
    void loadOverview();
    try {
      const [projectRes, tracksRes, versionRes, stemsRes] = await Promise.all([
        api.get<{ project: { name: string; isArchived: boolean }; role: string; roles: string[]; rights: MemberRights }>(`/projects/${projectId}`, true),
        api.get<{ tracks: { id: string; name: string; coverUrl: string | null }[] }>(`/tracks/project/${projectId}`, true),
        api.get<{ versions: Version[] }>(`/versions/track/${trackId}`, true),
        api.get<{ stems: Stem[]; guestNotes?: GuestNote[] }>(`/stems/track/${trackId}`, true),
      ]);
      const found = tracksRes.tracks.find((tr) => tr.id === trackId);
      if (!found) {
        missing = true;
        return;
      }
      project = projectRes.project;
      role = projectRes.role;
      rights = projectRes.rights;
      track = { name: found.name, coverUrl: found.coverUrl ?? null };
      projectTracks = tracksRes.tracks.map(({ id, name }) => ({ id, name }));
      versions = versionRes.versions;
      stems = stemsRes.stems;
      guestNotes = stemsRes.guestNotes ?? [];
      void loadFiles();
    } catch {
      missing = true;
    } finally {
      loading = false;
    }
  });

  async function loadFiles() {
    const res = await api.get<{ files: ProjectFile[]; canDownload: boolean }>(`/files/project/${projectId}`, true).catch(() => null);
    files = res?.files ?? [];
    canDownloadFiles = res?.canDownload ?? false;
  }

  async function filesChanged(opts: { tracks?: boolean } = {}) {
    await loadFiles();
    if (opts.tracks) stems = (await api.get<{ stems: Stem[] }>(`/stems/track/${trackId}`)).stems;
  }

  const details = (v: Version) =>
    [v.originalFileName, v.duration ? formatTime(v.duration) : '', isProcessing(v) ? m.processing : ''].filter(Boolean).join(' · ');

  // The URL answers as an attachment, so the page stays
  async function download(v: Version) {
    const res = await api.get<{ url: string }>(`/versions/${v.id}/download-url`);
    window.location.href = res.url;
  }
</script>

<TopBar settingsHref="/projects/{projectId}/settings" crumbs={[...musicCrumbs(artist, { id: projectId, name: project?.name ?? '…' }, true), { label: track?.name ?? '…' }]}>
  {#snippet actions()}
    {#if !missing}
      <Button size="sm" href={player}><Icon name="play" size={14} /> {m.openPlayer}</Button>
    {/if}
  {/snippet}
</TopBar>

<div class="track-folder">
  {#if loading}
    <Skeleton width="240px" height="2rem" />
    <Skeleton height="4rem" variant="rect" />
  {:else if missing || !track}
    <EmptyState title={t().track.page.missingTitle} description={t().track.page.missingText} />
  {:else}
    <header>
      <CoverImage src={track.coverUrl} name={track.name} size="md" rounded="md" />
      <div>
        <h1>{track.name}</h1>
        <p>{m.versions(versions.length)} · {m.stems(stems.length)} · {m.files(trackFiles.length)}</p>
      </div>
    </header>

    <section aria-labelledby="versions-title">
      <div class="section-head">
        <h2 id="versions-title">{m.versionsTitle} <span class="count">{versions.length}</span></h2>
        {#if canUpload}
          <Button variant="secondary" size="sm" href="{player}?upload=version"><Icon name="upload" size={14} /> {m.uploadVersion}</Button>
        {/if}
      </div>
      {#if versions.length}
        <ul class="versions">
          {#each versions as v (v.id)}
            <li>
              <a href={trackHref(projectId, trackId, v.id)} class="version">
                <span class="icon"><Icon name="music" size={15} /></span>
                <span class="name">
                  <b>V{v.versionNumber} · {versionTitle(v)}</b>
                  <small>{details(v)}</small>
                </span>
                <span class="when">{formatWhen(v.createdAt)}</span>
              </a>
              {#if can.canDownload && !isProcessing(v)}
                <button class="row-btn" onclick={() => download(v)} title={m.downloadOf(`V${v.versionNumber}`)} aria-label={m.downloadOf(`V${v.versionNumber}`)}>
                  <Icon name="download" size={14} />
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">{m.noVersions}</p>
      {/if}
    </section>

    <section aria-labelledby="stems-title">
      <h2 id="stems-title">{m.stemsTitle} <span class="count">{stems.length}</span></h2>
      <StemList
        {trackId}
        trackName={track.name}
        bind:stems
        bind:notes={guestNotes}
        {canUpload}
        canDownload={can.canDownload}
        currentUserId={$user?.id ?? null}
        {role}
        onUpload={() => goto(`${player}?upload=spuren`)}
      />
    </section>

    <section aria-labelledby="files-title">
      <h2 id="files-title">{m.filesTitle} <span class="count">{trackFiles.length}</span></h2>
      <TrackFiles {projectId} {trackId} files={trackFiles} tracks={projectTracks} {canUpload} canDownload={canDownloadFiles} onChange={filesChanged} />
    </section>
  {/if}
</div>

<style>
  .track-folder {
    display: grid;
    gap: var(--space-6);
    max-width: 1100px;
    padding: var(--space-6) var(--space-6) var(--space-12);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }
  header > div {
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: var(--text-2xl);
    overflow-wrap: anywhere;
  }
  header p {
    margin: var(--space-1) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  section {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
  }
  .count {
    margin-left: var(--space-1);
    color: var(--color-text-tertiary);
    font-weight: 400;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .versions li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border-bottom: 1px solid var(--color-border);
  }
  .version {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    text-decoration: none;
    transition: background var(--transition-fast);
  }
  .version:hover {
    background: var(--color-bg-raised);
    color: var(--color-text-secondary);
  }
  .icon {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--color-bg-overlay);
  }
  .name {
    min-width: 0;
    display: grid;
  }
  .name b {
    color: var(--color-text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name small {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .when {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .row-btn {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .row-btn:hover {
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
  }
  .empty {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  @media (max-width: 640px) {
    .track-folder {
      padding: var(--space-4) var(--space-4) var(--space-12);
    }
    .version {
      grid-template-columns: 32px minmax(0, 1fr);
      padding: var(--space-3) var(--space-1);
    }
    .when {
      display: none;
    }
  }
</style>
