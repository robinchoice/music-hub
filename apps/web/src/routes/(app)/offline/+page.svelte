<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { offlineVersions, removeOffline, initOfflineStore } from '$lib/stores/offline.js';

  let storageUsed = $state(0);
  let storageQuota = $state(0);
  let removing = $state<string | null>(null);

  onMount(async () => {
    await initOfflineStore();
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      storageUsed = estimate.usage ?? 0;
      storageQuota = estimate.quota ?? 0;
    }
  });

  function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  async function handleRemove(versionId: string) {
    removing = versionId;
    try {
      await removeOffline(versionId);
    } finally {
      removing = null;
    }
  }

  async function handleRemoveAll() {
    if (!confirm('Alle offline-verfügbaren Versionen entfernen?')) return;
    for (const v of offlineVersions.value) {
      await removeOffline(v.versionId);
    }
  }
</script>

<TopBar crumbs={[{ label: 'Projekte', href: '/dashboard' }, { label: 'Offline-Tracks' }]}>
  {#snippet actions()}
    {#if offlineVersions.value.length > 0}
      <Button size="sm" variant="ghost" onclick={handleRemoveAll}>Alle entfernen</Button>
    {/if}
  {/snippet}
</TopBar>

<div class="offline-page">
  {#if offlineVersions.value.length === 0}
    <EmptyState
      title="Keine Offline-Tracks"
      description="Öffne einen Track, klicke auf das Cloud-Icon neben einer Version und wähle eine Qualität zum Download."
    />
  {:else}
    <div class="storage-bar">
      <span class="storage-label">Gerätespeicher belegt:</span>
      <span class="storage-value">{formatBytes(storageUsed)} / {formatBytes(storageQuota)}</span>
    </div>

    <div class="version-list">
      {#each offlineVersions.value as v (v.versionId)}
        <div class="version-row">
          <div class="version-info">
            <span class="version-title">{v.title}</span>
            <span class="version-meta">
              V{v.versionNumber}
              · {v.quality === 'stream' ? 'Stream (MP3)' : 'Original'}
              · {formatBytes(v.sizeBytes)}
              · {formatDate(v.downloadedAt)}
            </span>
          </div>
          <button
            class="remove-btn"
            onclick={() => handleRemove(v.versionId)}
            disabled={removing === v.versionId}
            aria-label="Offline entfernen"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .offline-page {
    padding: var(--space-6);
    max-width: 640px;
  }

  .storage-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
    color: var(--color-text-tertiary);
    margin-bottom: var(--space-5);
  }

  .storage-label {
    color: var(--color-text-secondary);
  }

  .version-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .version-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--color-surface-2);
    border-radius: 8px;
  }

  .version-info {
    flex: 1;
    min-width: 0;
  }

  .version-title {
    display: block;
    font-size: 0.9rem;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .version-meta {
    display: block;
    font-size: 0.78rem;
    color: var(--color-text-tertiary);
    margin-top: 0.15rem;
  }

  .remove-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-tertiary);
    padding: 0.25rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .remove-btn:hover {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
  }

  .remove-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
