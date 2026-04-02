<script lang="ts">
  import Badge from '$lib/components/ui/Badge.svelte';
  import { timeAgo } from '$lib/utils/format.js';

  type Version = {
    id: string;
    versionNumber: number;
    label: string | null;
    notes: string | null;
    status: string;
    originalFileName: string;
    duration: number | null;
    createdAt: string;
  };

  let {
    versions,
    selectedId,
    onSelect,
  }: {
    versions: Version[];
    selectedId: string | null;
    onSelect: (version: Version) => void | Promise<void>;
  } = $props();

  const statusVariant = (s: string) =>
    ({ approved: 'success', rejected: 'error', processing: 'warning', ready: 'accent', uploaded: 'default' } as Record<string, any>)[s] || 'default';
</script>

{#if versions.length > 1}
  <div class="version-history">
    <h2>Version History</h2>
    <div class="version-list">
      {#each versions as version}
        <button
          class="version-item"
          class:active={selectedId === version.id}
          onclick={() => onSelect(version)}
        >
          <span class="v-number">V{version.versionNumber}</span>
          <span class="v-label">{version.label || version.originalFileName}</span>
          <Badge variant={statusVariant(version.status)}>{version.status}</Badge>
          <span class="v-date">{timeAgo(version.createdAt)}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .version-history {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-5);
  }

  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-lg);
  }

  .version-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .version-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    color: inherit;
    text-align: left;
    width: 100%;
    font-family: inherit;
    font-size: var(--text-sm);
    transition: border-color var(--transition-fast);
  }

  .version-item:hover {
    border-color: var(--color-border-hover);
  }

  .version-item.active {
    border-color: var(--color-accent);
    background: var(--color-accent-subtle);
  }

  .v-number {
    color: var(--color-text-primary);
    font-weight: 600;
    min-width: 2rem;
  }

  .v-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .v-date {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
</style>
