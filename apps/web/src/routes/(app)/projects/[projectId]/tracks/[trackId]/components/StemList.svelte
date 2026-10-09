<script lang="ts">
  import { MAX_ZIP_SIZE } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { demoMode } from '$lib/demo/mode.js';
  import { toastError, toastTrash } from '$lib/stores/toast.js';
  import { formatFileSize, timeAgo } from '$lib/utils/format.js';
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
  };

  let {
    trackId,
    trackName,
    stems = $bindable<Stem[]>([]),
    canUpload,
    currentUserId,
    role,
    onUpload,
  }: {
    trackId: string;
    trackName: string;
    stems: Stem[];
    canUpload: boolean;
    currentUserId: string | null;
    role: string;
    onUpload: () => void;
  } = $props();

  let deleting = $state<string | null>(null);

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

  async function deleteStem(stem: Stem, label: string) {
    deleting = stem.id;
    try {
      await api.delete(`/stems/${stem.id}`);
      stems = stems.filter((s) => s.id !== stem.id);
      toastTrash(`Spur „${label}“ liegt im Papierkorb des Projekts`, async () => {
        await api.post(`/trash/stem/${stem.id}/restore`);
        await loadStems();
      });
    } finally {
      deleting = null;
    }
  }
</script>

<div class="spuren">
  {#if stems.length > 0}
    <p class="summary">
      {stems.length} {stems.length === 1 ? 'Datei' : 'Dateien'} · {formatFileSize(totalSize)}{lastUpload ? ` · zuletzt ${timeAgo(lastUpload)}` : ''}
    </p>
  {/if}

  {#if stems.length > 0}
    <div class="tools">
      <Button variant="secondary" size="sm" onclick={downloadZip}><Icon name="download" size={14} /> Alle als ZIP</Button>
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
          <span class="size">{formatFileSize(stem.fileSize)}</span>
          <button class="row-btn" onclick={() => downloadStem(stem)} title="Herunterladen" aria-label={`${label} herunterladen`}>
            <Icon name="download" size={13} />
          </button>
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
      {/each}
    </ul>
  {/if}
</div>

<style>
  .spuren {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    height: 100%;
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

  .row-btn.delete {
    opacity: 0;
  }

  .list li:hover .row-btn.delete,
  .row-btn.delete:focus-visible {
    opacity: 1;
  }

  .row-btn.delete:hover {
    color: var(--color-error);
  }

  .row-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  @media (hover: none) {
    .row-btn.delete {
      opacity: 1;
    }
  }
</style>
