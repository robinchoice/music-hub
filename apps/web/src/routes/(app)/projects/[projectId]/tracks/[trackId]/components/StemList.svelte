<script lang="ts">
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import StemUploadDropzone from '$lib/components/audio/StemUploadDropzone.svelte';

  type Stem = {
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
    stems = $bindable<Stem[]>([]),
    canUpload,
    currentUserId,
    role,
  }: {
    trackId: string;
    stems: Stem[];
    canUpload: boolean;
    currentUserId: string | null;
    role: string;
  } = $props();

  let showUpload = $state(false);
  let deleting = $state<string | null>(null);

  function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function loadStems() {
    const res = await api.get<{ stems: Stem[] }>(`/stems/track/${trackId}`);
    stems = res.stems;
  }

  async function downloadZip() {
    const res = await fetch(`/api/v1/stems/track/${trackId}/download-zip`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.headers.get('content-disposition')?.match(/filename="(.+?)"/)?.[1] ?? 'stems.zip';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteStem(id: string, name: string) {
    if (!confirm(`Stem "${name}" wirklich löschen?`)) return;
    deleting = id;
    try {
      await api.delete(`/stems/${id}`);
      stems = stems.filter((s) => s.id !== id);
      toastSuccess('Stem gelöscht');
    } finally {
      deleting = null;
    }
  }
</script>

<div class="stems">
  <div class="stems-header">
    {#if stems.length > 0}
      <Button variant="ghost" size="sm" onclick={downloadZip}>
        <Icon name="download" size={14} /> Alle als ZIP
      </Button>
    {/if}
    {#if canUpload}
      <Button variant="ghost" size="sm" onclick={() => (showUpload = !showUpload)}>
        <Icon name="upload" size={14} /> {showUpload ? 'Schließen' : 'STEMs hochladen'}
      </Button>
    {/if}
  </div>

  {#if showUpload}
    <div class="upload-box">
      <StemUploadDropzone
        {trackId}
        onUploaded={async () => {
          await loadStems();
          toastSuccess('STEMs hochgeladen');
          showUpload = false;
        }}
      />
    </div>
  {/if}

  {#if stems.length === 0 && !showUpload}
    <p class="empty">Noch keine STEMs hochgeladen.</p>
  {:else}
    <ul class="stem-list">
      {#each stems as stem (stem.id)}
        <li class="stem-item">
          <span class="stem-icon"><Icon name="music" size={14} /></span>
          <div class="stem-info">
            <span class="stem-name">{stem.name}</span>
            <span class="stem-meta">{stem.originalFileName} · {formatSize(stem.fileSize)}</span>
          </div>
          {#if role === 'owner' || stem.createdById === currentUserId}
            <button
              class="delete-btn"
              onclick={() => deleteStem(stem.id, stem.name)}
              disabled={deleting === stem.id}
              title="Stem löschen"
            >
              <Icon name="x" size={12} />
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .stems {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .stems-header {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .upload-box {
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }

  .empty {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }

  .stem-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .stem-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    transition: border-color var(--transition-fast);
  }

  .stem-item:hover {
    border-color: var(--color-border-hover);
  }

  .stem-icon {
    color: var(--color-text-tertiary);
    flex-shrink: 0;
  }

  .stem-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .stem-name {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stem-meta {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .delete-btn {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    transition: color var(--transition-fast);
  }

  .delete-btn:hover {
    color: var(--color-error);
  }

  .delete-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
