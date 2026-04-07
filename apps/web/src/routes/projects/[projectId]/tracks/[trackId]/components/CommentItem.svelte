<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import { formatTime, timeAgo } from '$lib/utils/format.js';

  type Comment = {
    id: string;
    body: string;
    timestampSeconds: number | null;
    resolvedAt: string | null;
    createdAt: string;
    guestName?: string | null;
    user: { id: string; name: string; avatarUrl: string | null } | null;
  };

  let {
    comment,
    onSeek,
    onResolve,
    onReply,
  }: {
    comment: Comment;
    onSeek?: (time: number) => void;
    onResolve: (id: string) => void;
    onReply?: (id: string) => void;
  } = $props();

  const displayName = $derived(comment.user?.name ?? comment.guestName ?? 'Gast');
  const isGuest = $derived(!comment.user);
</script>

<div class="comment" class:resolved={comment.resolvedAt}>
  <div class="comment-header">
    <Avatar name={displayName} src={comment.user?.avatarUrl ?? null} size="sm" />
    <span class="comment-author">{displayName}{#if isGuest} <span class="guest-tag">Gast</span>{/if}</span>
    {#if comment.timestampSeconds !== null}
      <button
        class="comment-timestamp"
        onclick={() => onSeek?.(comment.timestampSeconds!)}
      >
        {formatTime(comment.timestampSeconds)}
      </button>
    {/if}
    <span class="comment-date">{timeAgo(comment.createdAt)}</span>
    <div class="comment-actions">
      {#if onReply}
        <button class="action-btn" onclick={() => onReply?.(comment.id)} title="Reply">↩</button>
      {/if}
      {#if !comment.resolvedAt}
        <button class="action-btn resolve" onclick={() => onResolve(comment.id)} title="Resolve">✓</button>
      {/if}
    </div>
  </div>
  <p class="comment-body">{comment.body}</p>
</div>

<style>
  .comment {
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-raised);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    transition: opacity var(--transition-base);
  }

  .comment.resolved {
    opacity: 0.4;
  }

  .comment-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
    font-size: var(--text-sm);
  }

  .comment-author {
    color: var(--color-text-primary);
    font-weight: 500;
  }

  .comment-timestamp {
    background: rgba(251, 191, 36, 0.15);
    border: 1px solid rgba(251, 191, 36, 0.3);
    color: var(--color-warning);
    border-radius: var(--radius-sm);
    padding: 0.05rem 0.4rem;
    font-size: var(--text-xs);
    cursor: pointer;
    font-family: inherit;
    transition: background var(--transition-fast);
  }

  .comment-timestamp:hover {
    background: rgba(251, 191, 36, 0.25);
  }

  .comment-date {
    color: var(--color-text-tertiary);
    margin-left: auto;
    font-size: var(--text-xs);
  }

  .comment-actions {
    display: flex;
    gap: var(--space-1);
  }

  .action-btn {
    background: none;
    border: 1px solid var(--color-border);
    color: var(--color-text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: 0 0.3rem;
    font-size: var(--text-sm);
    transition: all var(--transition-fast);
  }

  .action-btn:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-hover);
  }

  .action-btn.resolve:hover {
    color: var(--color-success);
    border-color: var(--color-success);
  }

  .guest-tag {
    font-size: var(--text-xs);
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    color: var(--color-text-tertiary);
    padding: 0 0.3rem;
    border-radius: var(--radius-sm);
    margin-left: var(--space-1);
  }

  .comment-body {
    margin: 0;
    font-size: var(--text-sm);
  }
</style>
