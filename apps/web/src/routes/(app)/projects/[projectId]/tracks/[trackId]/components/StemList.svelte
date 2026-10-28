<script lang="ts">
  import { MAX_ZIP_SIZE } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { demoMode } from '$lib/demo/mode.js';
  import { t } from '$lib/i18n/index.js';
  import { toastError, toastSuccess, toastTrash } from '$lib/stores/toast.js';
  import { formatFileSize, formatWhen, timeAgo } from '$lib/utils/format.js';
  import { replaceStemFile } from '$lib/audio/upload.js';
  import { spurDisplayName, compareSpurNames } from '$lib/utils/track.js';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  export type Stem = {
    id: string;
    name: string;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    createdAt: string;
    createdById: string;
    guestName?: string | null;
    revisedAt?: string | null;
    revisionCount?: number;
  };

  export type GuestNote = { id: string; guestName: string; body: string; createdAt: string };

  type Revision = {
    id: string;
    originalFileName: string;
    fileSize: number;
    createdAt: string;
    replacedAt: string;
    createdById: string;
    createdByName: string;
  };

  let {
    trackId,
    trackName,
    stems = $bindable<Stem[]>([]),
    notes = $bindable<GuestNote[]>([]),
    canUpload,
    canDownload,
    currentUserId,
    role,
    locked = false,
    onUpload,
  }: {
    trackId: string;
    trackName: string;
    stems: Stem[];
    notes?: GuestNote[];
    canUpload: boolean;
    /** Downloading stems is for roles with the download right */
    canDownload: boolean;
    currentUserId: string | null;
    role: string;
    /** An open track keeps its stems; the API would refuse the new file only after the upload */
    locked?: boolean;
    onUpload: () => void;
  } = $props();

  let deleting = $state<string | null>(null);
  // The stem getting a new file and how far the upload is
  let replacing = $state<{ id: string; progress: number } | null>(null);
  let replaceTarget: Stem | null = null;
  let fileInput: HTMLInputElement;
  // The stem whose earlier files are open
  let historyOf = $state<string | null>(null);
  let revisions = $state<Revision[]>([]);

  const mayChange = (stem: Stem) => canUpload && (role === 'owner' || stem.createdById === currentUserId);

  const rows = $derived(
    stems
      .map((stem) => ({ stem, label: spurDisplayName(stem.name, trackName) }))
      .sort((a, b) => compareSpurNames(a.label, b.label)),
  );
  const totalSize = $derived(stems.reduce((sum, s) => sum + s.fileSize, 0));
  const lastUpload = $derived(
    stems.reduce<string | null>((latest, s) => (!latest || s.createdAt > latest ? s.createdAt : latest), null),
  );

  async function loadStems() {
    const res = await api.get<{ stems: Stem[] }>(`/stems/track/${trackId}`);
    stems = res.stems;
  }

  function downloadZip() {
    if (demoMode) return toastError(t().track.stems.demoUnavailable);
    if (totalSize > MAX_ZIP_SIZE) return toastError(t().track.stems.zipTooBig);
    // As a plain download the browser writes the stream to disk and shows progress
    const a = document.createElement('a');
    a.href = `/api/v1/stems/track/${trackId}/download-zip`;
    a.download = '';
    a.click();
  }

  async function downloadStem(stem: Stem) {
    const res = await api.get<{ url: string }>(`/stems/${stem.id}/download-url`);
    window.location.href = res.url;
  }

  function pickReplacement(stem: Stem) {
    if (demoMode) return toastError(t().track.stems.demoUnavailable);
    if (locked) return toastError(t().track.stems.openLocked);
    replaceTarget = stem;
    fileInput.click();
  }

  async function replaceStem(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const stem = replaceTarget;
    if (!file || !stem) return;
    replacing = { id: stem.id, progress: 0 };
    try {
      const updated = await replaceStemFile<Stem>(trackId, stem.id, file, (p) => replacing && (replacing.progress = p));
      stems = stems.map((s) => (s.id === stem.id ? { ...updated, revisionCount: (s.revisionCount ?? 0) + 1 } : s));
      if (historyOf === stem.id) await loadRevisions(stem.id);
      toastSuccess(t().track.stems.newTakeUploaded(spurDisplayName(stem.name, trackName)));
    } catch (err) {
      // API errors were shown already
      if (!(err as { status?: number }).status) toastError((err as Error).message);
    } finally {
      replacing = null;
    }
  }

  async function loadRevisions(stemId: string) {
    const res = await api.get<{ revisions: Revision[] }>(`/stems/${stemId}/revisions`);
    revisions = res.revisions;
  }

  async function toggleHistory(stem: Stem) {
    if (historyOf === stem.id) {
      historyOf = null;
      return;
    }
    revisions = [];
    historyOf = stem.id;
    await loadRevisions(stem.id);
  }

  async function downloadRevision(revision: Revision) {
    const res = await api.get<{ url: string }>(`/stems/revisions/${revision.id}/download-url`);
    window.location.href = res.url;
  }

  async function restoreRevision(stem: Stem, revision: Revision) {
    try {
      const { stem: updated } = await api.post<{ stem: Stem }>(`/stems/revisions/${revision.id}/restore`);
      stems = stems.map((s) => (s.id === stem.id ? { ...updated, ...(s.revisionCount !== undefined && { revisionCount: s.revisionCount }) } : s));
      await loadRevisions(stem.id);
      toastSuccess(t().track.stems.takeRestored(revision.originalFileName));
    } catch {
      // The API client already showed the error
    }
  }

  async function deleteRevision(stem: Stem, revision: Revision, n: number) {
    const count = (by: number) => (stems = stems.map((s) => (s.id === stem.id ? { ...s, revisionCount: (s.revisionCount ?? 0) + by } : s)));
    try {
      await api.delete(`/stems/revisions/${revision.id}`);
      revisions = revisions.filter((r) => r.id !== revision.id);
      count(-1);
      if (!revisions.length) historyOf = null;
      toastTrash(t().track.stems.takeTrashed(n, spurDisplayName(stem.name, trackName)), async () => {
        await api.post(`/trash/revision/${revision.id}/restore`);
        count(1);
        if (historyOf === stem.id) await loadRevisions(stem.id);
      });
    } catch {
      // The API client already showed the error
    }
  }

  async function deleteStem(stem: Stem, label: string) {
    deleting = stem.id;
    try {
      await api.delete(`/stems/${stem.id}`);
      stems = stems.filter((s) => s.id !== stem.id);
      toastTrash(t().track.stems.stemTrashed(label), async () => {
        await api.post(`/trash/stem/${stem.id}/restore`);
        await loadStems();
      });
    } catch {
      // The API client already showed the error
    } finally {
      deleting = null;
    }
  }

  async function deleteNote(note: GuestNote) {
    if (!confirm(t().track.stems.confirmDeleteNote(note.guestName))) return;
    await api.delete(`/upload-links/notes/${note.id}`);
    notes = notes.filter((n) => n.id !== note.id);
  }
</script>

<div class="spuren">
  {#if notes.length > 0}
    <ul class="notes" aria-label={t().track.stems.guestNotes}>
      {#each notes as note (note.id)}
        <li>
          <p class="note-head">
            <b>{note.guestName}</b> · {timeAgo(note.createdAt)}
            {#if canUpload}
              <button class="row-btn" onclick={() => deleteNote(note)} title={t().track.stems.deleteNote} aria-label={t().track.stems.deleteNoteOf(note.guestName)}>
                <Icon name="x" size={12} />
              </button>
            {/if}
          </p>
          <p class="note-body">{note.body}</p>
        </li>
      {/each}
    </ul>
  {/if}

  {#if stems.length > 0}
    <p class="summary">
      {t().track.stems.files(stems.length)} · {formatFileSize(totalSize)}{lastUpload ? ` · ${t().track.stems.lastAgo(timeAgo(lastUpload))}` : ''}
    </p>
  {/if}

  {#if stems.length > 0}
    <div class="tools">
      {#if canDownload}
        <Button variant="secondary" size="sm" onclick={downloadZip}><Icon name="download" size={14} /> {t().track.stems.allAsZip}</Button>
      {/if}
      {#if canUpload}
        <Button variant="secondary" size="sm" onclick={onUpload}><Icon name="upload" size={14} /> {t().track.stems.upload}</Button>
      {/if}
    </div>
  {/if}

  {#if stems.length === 0}
    <div class="empty">
      <p>{t().track.stems.none}</p>
      {#if canUpload}
        <Button size="sm" onclick={onUpload}><Icon name="upload" size={14} /> {t().track.stems.uploadStems}</Button>
      {/if}
    </div>
  {:else}
    <ul class="list">
      {#each rows as { stem, label } (stem.id)}
        <li title={stem.originalFileName}>
          <Icon name="music" size={13} />
          <span class="name">{label}</span>
          {#if stem.guestName}
            <span class="guest" title={t().track.stems.viaUploadLink}>{t().track.stems.fromGuest(stem.guestName)}</span>
          {/if}
          {#if stem.revisionCount}
            <button
              class="fassung"
              class:on={historyOf === stem.id}
              onclick={() => toggleHistory(stem)}
              aria-expanded={historyOf === stem.id}
              title={t().track.stems.earlierTakes}
            >
              {t().track.stems.take(stem.revisionCount + 1)}
            </button>
          {/if}
          <span class="size">
            {replacing?.id === stem.id ? `${replacing.progress} %` : formatFileSize(stem.fileSize)}
          </span>
          {#if canDownload}
            <button class="row-btn" onclick={() => downloadStem(stem)} title={t().track.stems.download} aria-label={t().track.stems.downloadOf(label)}>
              <Icon name="download" size={13} />
            </button>
          {/if}
          {#if mayChange(stem)}
            <button
              class="row-btn hover-only"
              onclick={() => pickReplacement(stem)}
              disabled={!!replacing}
              title={t().track.stems.uploadTake}
              aria-label={t().track.stems.uploadTakeOf(label)}
            >
              <Icon name="upload" size={13} />
            </button>
          {/if}
          {#if role === 'owner' || stem.createdById === currentUserId}
            <button
              class="row-btn delete"
              onclick={() => deleteStem(stem, label)}
              disabled={deleting === stem.id}
              title={t().track.stems.toTrash}
              aria-label={t().track.stems.toTrashOf(label)}
            >
              <Icon name="trash" size={13} />
            </button>
          {/if}
        </li>
        {#if historyOf === stem.id}
          {#each revisions as revision, i (revision.id)}
            <li class="revision" title={revision.originalFileName}>
              <span class="name">
                {t().track.stems.takeLine(revisions.length - i, revision.createdByName, formatWhen(revision.replacedAt))}
              </span>
              <span class="size">{formatFileSize(revision.fileSize)}</span>
              {#if canDownload}
                <button
                  class="row-btn"
                  onclick={() => downloadRevision(revision)}
                  title={t().track.stems.download}
                  aria-label={t().track.stems.downloadTake(revisions.length - i)}
                >
                  <Icon name="download" size={13} />
                </button>
              {/if}
              {#if mayChange(stem)}
                <button
                  class="row-btn"
                  onclick={() => restoreRevision(stem, revision)}
                  title={t().track.stems.makeCurrent}
                  aria-label={t().track.stems.restoreTake(revisions.length - i)}
                >
                  <Icon name="restore" size={13} />
                </button>
              {/if}
              {#if role === 'owner' || revision.createdById === currentUserId}
                <button
                  class="row-btn delete"
                  onclick={() => deleteRevision(stem, revision, revisions.length - i)}
                  title={t().track.stems.toTrash}
                  aria-label={t().track.stems.takeToTrashLabel(revisions.length - i)}
                >
                  <Icon name="trash" size={13} />
                </button>
              {/if}
            </li>
          {/each}
        {/if}
      {/each}
    </ul>
  {/if}
  <input bind:this={fileInput} type="file" accept="audio/*" hidden onchange={replaceStem} />
</div>

<style>
  .spuren {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    height: 100%;
  }

  .notes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .notes li {
    padding: var(--space-2) var(--space-3);
    border-left: 2px solid var(--color-accent);
    border-radius: var(--radius-sm);
    background: var(--color-bg-base);
  }

  .note-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .note-head b {
    color: var(--color-text-secondary);
    font-weight: 600;
  }

  .note-head .row-btn {
    margin-left: auto;
  }

  .note-body {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .summary {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .tools {
    display: flex;
    gap: var(--space-2);
  }

  .tools :global(.btn) {
    flex: 1;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  .empty p {
    margin: 0;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    list-style: none;
    margin: 0 calc(-1 * var(--space-2));
    padding: 0;
  }

  .list li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 6px var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }

  .list li:hover {
    background: var(--color-bg-subtle);
  }

  .list li > :global(svg) {
    flex-shrink: 0;
    color: var(--color-text-tertiary);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .guest {
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .size {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }

  .row-btn {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
  }

  .row-btn:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-overlay);
  }

  .row-btn.delete,
  .row-btn.hover-only {
    opacity: 0;
  }

  .list li:hover .row-btn.delete,
  .row-btn.delete:focus-visible,
  .list li:hover .row-btn.hover-only,
  .row-btn.hover-only:focus-visible {
    opacity: 1;
  }

  .fassung {
    flex-shrink: 0;
    padding: 1px 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: none;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    cursor: pointer;
    white-space: nowrap;
  }

  .fassung:hover,
  .fassung.on {
    color: var(--color-text-primary);
    border-color: var(--color-border-hover);
  }

  .list li.revision {
    padding-left: calc(var(--space-2) + 13px + var(--space-2));
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .row-btn.delete:hover {
    color: var(--color-error);
  }

  .row-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  @media (hover: none) {
    .row-btn.delete,
    .row-btn.hover-only {
      opacity: 1;
    }
  }
</style>
