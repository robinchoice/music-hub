<script lang="ts">
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  type Version = {
    id: string;
    versionNumber: number;
    label: string | null;
    notes: string | null;
    status: string;
  };

  let {
    version,
    canApprove = false,
    onApprove,
    onReject,
  }: {
    version: Version;
    canApprove?: boolean;
    onApprove: () => void;
    onReject: () => void;
  } = $props();

  const statusVariant = $derived(
    ({ approved: 'success', rejected: 'error', processing: 'warning', ready: 'accent', uploaded: 'default' } as const)[version.status] || 'default'
  );

  const showActions = $derived(canApprove && version.status !== 'approved' && version.status !== 'rejected');
</script>

<div class="version-info">
  <div class="version-meta">
    <span class="version-label">
      V{version.versionNumber}
      {#if version.label} — {version.label}{/if}
    </span>
    <Badge variant={statusVariant}>{version.status}</Badge>
  </div>

  {#if showActions}
    <div class="version-actions">
      <Button variant="ghost" size="sm" onclick={onApprove}>
        <span style="color: var(--color-success)">✓ Approve</span>
      </Button>
      <Button variant="ghost" size="sm" onclick={onReject}>
        <span style="color: var(--color-error)">✕ Reject</span>
      </Button>
    </div>
  {/if}
</div>

{#if version.notes}
  <p class="version-notes">{version.notes}</p>
{/if}

<style>
  .version-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .version-meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .version-label {
    color: var(--color-text-primary);
    font-weight: 500;
  }

  .version-actions {
    display: flex;
    gap: var(--space-1);
  }

  .version-notes {
    margin: var(--space-2) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-style: italic;
  }
</style>
