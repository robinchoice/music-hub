<script lang="ts">
  import { MAX_ZIP_SIZE } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { demoMode } from '$lib/demo/mode.js';
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
    if (demoMode) return toastError('In der Demo nicht verfügbar');
    if (totalSize > MAX_ZIP_SIZE) return toastError('Zu groß für ein ZIP — bitte die Spuren einzeln laden');
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
    if (demoMode) return toastError('In der Demo nicht verfügbar');
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
      toastSuccess(`Neue Fassung von „${spurDisplayName(stem.name, trackName)}“ hochgeladen`);
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
      toastSuccess(`„${revision.originalFileName}“ ist wieder die aktuelle Fassung`);
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
      toastTrash(`Fassung ${n} von „${spurDisplayName(stem.name, trackName)}“ liegt im Papierkorb`, async () => {
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
      toastTrash(`Spur „${label}“ liegt im Papierkorb`, async () => {
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
    if (!confirm(`Notiz von ${note.guestName} löschen?`)) return;
    await api.delete(`/upload-links/notes/${note.id}`);
    notes = notes.filter((n) => n.id !== note.id);
  }
</script>

<div class="spuren">
  {#if notes.length > 0}
    <ul class="notes" aria-label="Notizen von Gästen">
      {#each notes as note (note.id)}
        <li>
          <p class="note-head">
            <b>{note.guestName}</b> · {timeAgo(note.createdAt)}
            {#if canUpload}
              <button class="row-btn" onclick={() => deleteNote(note)} title="Notiz löschen" aria-label={`Notiz von ${note.guestName} löschen`}>
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
      {stems.length} {stems.length === 1 ? 'Datei' : 'Dateien'} · {formatFileSize(totalSize)}{lastUpload ? ` · zuletzt ${timeAgo(lastUpload)}` : ''}
    </p>
  {/if}

  {#if stems.length > 0}
    <div class="tools">
      {#if canDownload}
        <Button variant="secondary" size="sm" onclick={downloadZip}><Icon name="download" size={14} /> Alle als ZIP</Button>
      {/if}
      {#if canUpload}
        <Button variant="secondary" size="sm" onclick={onUpload}><Icon name="upload" size={14} /> Hochladen</Button>
      {/if}
    </div>
  {/if}

  {#if stems.length === 0}
    <div class="empty">
      <p>Noch keine Spuren.</p>
      {#if canUpload}
        <Button size="sm" onclick={onUpload}><Icon name="upload" size={14} /> Spuren hochladen</Button>
      {/if}
    </div>
  {:else}
    <ul class="list">
      {#each rows as { stem, label } (stem.id)}
        <li title={stem.originalFileName}>
          <Icon name="music" size={13} />
          <span class="name">{label}</span>
          {#if stem.guestName}
            <span class="guest" title="Über den Upload-Link geschickt">von {stem.guestName}</span>
          {/if}
          {#if stem.revisionCount}
            <button
              class="fassung"
              class:on={historyOf === stem.id}
              onclick={() => toggleHistory(stem)}
              aria-expanded={historyOf === stem.id}
              title="Frühere Fassungen"
            >
              Fassung {stem.revisionCount + 1}
            </button>
          {/if}
          <span class="size">
            {replacing?.id === stem.id ? `${replacing.progress} %` : formatFileSize(stem.fileSize)}
          </span>
          {#if canDownload}
            <button class="row-btn" onclick={() => downloadStem(stem)} title="Herunterladen" aria-label={`${label} herunterladen`}>
              <Icon name="download" size={13} />
            </button>
          {/if}
          {#if mayChange(stem)}
            <button
              class="row-btn hover-only"
              onclick={() => pickReplacement(stem)}
              disabled={!!replacing}
              title="Neue Fassung hochladen"
              aria-label={`Neue Fassung von ${label} hochladen`}
            >
              <Icon name="upload" size={13} />
            </button>
          {/if}
          {#if role === 'owner' || stem.createdById === currentUserId}
            <button
              class="row-btn delete"
              onclick={() => deleteStem(stem, label)}
              disabled={deleting === stem.id}
              title="In den Papierkorb"
              aria-label={`${label} in den Papierkorb`}
            >
              <Icon name="trash" size={13} />
            </button>
          {/if}
        </li>
        {#if historyOf === stem.id}
          {#each revisions as revision, i (revision.id)}
            <li class="revision" title={revision.originalFileName}>
              <span class="name">
                Fassung {revisions.length - i} · {revision.createdByName} · bis {formatWhen(revision.replacedAt)}
              </span>
              <span class="size">{formatFileSize(revision.fileSize)}</span>
              {#if canDownload}
                <button
                  class="row-btn"
                  onclick={() => downloadRevision(revision)}
                  title="Herunterladen"
                  aria-label={`Fassung ${revisions.length - i} herunterladen`}
                >
                  <Icon name="download" size={13} />
                </button>
              {/if}
              {#if mayChange(stem)}
                <button
                  class="row-btn"
                  onclick={() => restoreRevision(stem, revision)}
                  title="Wieder zur aktuellen Fassung machen"
                  aria-label={`Fassung ${revisions.length - i} wiederherstellen`}
                >
                  <Icon name="restore" size={13} />
                </button>
              {/if}
              {#if role === 'owner' || revision.createdById === currentUserId}
                <button
                  class="row-btn delete"
                  onclick={() => deleteRevision(stem, revision, revisions.length - i)}
                  title="In den Papierkorb"
                  aria-label={`Fassung ${revisions.length - i} in den Papierkorb`}
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
