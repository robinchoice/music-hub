<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import { formatTime, timeAgo } from '$lib/utils/format.js';

  type Event = {
    type: 'comment' | 'version' | 'approval';
    id: string;
    createdAt: string;
    user: { id: string | null; name: string; avatarUrl: string | null } | null;
    guestName: string | null;
    project: { id: string; name: string };
    track: { id: string; name: string };
    version?: { id: string; versionNumber: number; label: string | null };
    body?: string;
    status?: string;
    timestampSeconds?: number | null;
  };

  let { event }: { event: Event } = $props();

  const displayName = $derived(event.user?.name ?? event.guestName ?? 'Gast');
  const isGuest = $derived(!event.user);
  const trackHref = $derived(`/projects/${event.project.id}/tracks/${event.track.id}`);
  const versionLabel = $derived(
    event.version
      ? `V${event.version.versionNumber}${event.version.label ? ' · ' + event.version.label : ''}`
      : '',
  );
</script>

<a href={trackHref} class="item">
  <Avatar name={displayName} src={event.user?.avatarUrl ?? null} size="sm" />

  <div class="body">
    <div class="head">
      <strong>{displayName}</strong>
      {#if isGuest}<span class="guest">Gast</span>{/if}

      {#if event.type === 'comment'}
        <span class="action">kommentierte</span>
      {:else if event.type === 'version'}
        {#if event.status === 'approved'}
          <span class="action ok">gab frei</span>
        {:else if event.status === 'rejected'}
          <span class="action err">lehnte ab</span>
        {:else}
          <span class="action">lud hoch</span>
        {/if}
      {/if}

      <span class="target">
        {#if event.type === 'version' && event.version}
          <span class="strong">{versionLabel}</span> in
        {/if}
        <span class="strong">{event.project.name}</span>
        <span class="sep">·</span>
        <span>{event.track.name}</span>
        {#if event.type === 'comment' && event.timestampSeconds !== null && event.timestampSeconds !== undefined}
          <span class="ts">{formatTime(event.timestampSeconds)}</span>
        {/if}
      </span>

      <span class="when">{timeAgo(event.createdAt)}</span>
    </div>

    {#if event.body}
      <p class="quote">"{event.body}"</p>
    {/if}
  </div>
</a>

<style>
  .item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    border: 1px solid transparent;
    transition: all var(--transition-fast);
  }
  .item:hover {
    background: var(--color-bg-raised);
    border-color: var(--color-border);
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 6px;
    row-gap: 2px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  .head strong {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .strong {
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .action {
    color: var(--color-text-tertiary);
  }
  .action.ok {
    color: var(--color-success);
  }
  .action.err {
    color: var(--color-error);
  }
  .target {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .sep {
    color: var(--color-text-tertiary);
    margin: 0 2px;
  }
  .ts {
    color: var(--color-warning);
    font-variant-numeric: tabular-nums;
    background: rgba(251, 191, 36, 0.12);
    border: 1px solid rgba(251, 191, 36, 0.3);
    padding: 0 5px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    margin-left: 4px;
  }
  .when {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    margin-left: auto;
    flex-shrink: 0;
  }
  @media (max-width: 540px) {
    .item {
      padding: var(--space-3);
      gap: var(--space-2);
    }
    .when {
      margin-left: 0;
      width: 100%;
      order: 99;
    }
  }
  .guest {
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border);
    color: var(--color-text-tertiary);
    padding: 0 5px;
    border-radius: var(--radius-sm);
    font-size: 10px;
  }
  .quote {
    margin: 4px 0 0;
    padding-left: var(--space-3);
    border-left: 2px solid var(--color-border);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
