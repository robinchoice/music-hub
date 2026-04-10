<script lang="ts">
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';

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

  const STATUS_LABEL: Record<string, string> = {
    uploaded: 'hochgeladen',
    processing: 'wird verarbeitet',
    ready: 'bereit',
    approved: 'freigegeben',
    rejected: 'abgelehnt',
  };

  const showActions = $derived(canApprove && version.status !== 'approved' && version.status !== 'rejected');
</script>

<div class="version-info">
  <div class="version-meta">
    <span class="version-label">
      V{version.versionNumber}
      {#if version.label} — {version.label}{/if}
    </span>
    <Badge variant={statusVariant}>{STATUS_LABEL[version.status] || version.status}</Badge>
  </div>

  {#if showActions}
    <div class="version-actions">
      <Button variant="ghost" size="sm" onclick={onApprove}>
        <span class="ok"><Icon name="check" size={14} /> Freigeben</span>
      </Button>
      <Button variant="ghost" size="sm" onclick={onReject}>
        <span class="err"><Icon name="x" size={14} /> Ablehnen</span>
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

  .ok, .err {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .ok { color: var(--color-success); }
  .err { color: var(--color-error); }

  .version-notes {
    margin: var(--space-2) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-style: italic;
  }
</style>
