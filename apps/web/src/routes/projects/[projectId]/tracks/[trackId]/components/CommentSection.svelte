<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import CommentItem from './CommentItem.svelte';
  import { formatTime } from '$lib/utils/format.js';

  type Comment = {
    id: string;
    body: string;
    timestampSeconds: number | null;
    parentId: string | null;
    resolvedAt: string | null;
    createdAt: string;
    guestName?: string | null;
    user: { id: string; name: string; avatarUrl: string | null } | null;
  };

  let {
    comments,
    canComment = false,
    commentTimestamp = $bindable<number | null>(null),
    onSubmit,
    onResolve,
    onSeek,
  }: {
    comments: Comment[];
    canComment?: boolean;
    commentTimestamp: number | null;
    onSubmit: (body: string, timestamp: number | null, parentId?: string) => void;
    onResolve: (id: string) => void;
    onSeek?: (time: number) => void;
  } = $props();

  let body = $state('');
  let replyingTo = $state<string | null>(null);
  let submitting = $state(false);

  // Group comments: top-level + replies
  const topLevel = $derived(comments.filter((c) => !c.parentId));
  const replies = $derived((parentId: string) => comments.filter((c) => c.parentId === parentId));

  async function handleSubmit() {
    if (!body.trim()) return;
    submitting = true;
    try {
      await onSubmit(body, replyingTo ? null : commentTimestamp, replyingTo ?? undefined);
      body = '';
      commentTimestamp = null;
      replyingTo = null;
    } finally {
      submitting = false;
    }
  }

  function handleReply(id: string) {
    replyingTo = id;
    commentTimestamp = null;
  }
</script>

<div class="comments-section">
  <h2>Comments</h2>

  {#if canComment}
    <form class="comment-form" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      {#if commentTimestamp !== null}
        <span class="timestamp-badge">
          <button type="button" class="ts-seek" onclick={() => onSeek?.(commentTimestamp!)}>
            {formatTime(commentTimestamp)}
          </button>
          <button type="button" class="remove-ts" onclick={() => commentTimestamp = null}>×</button>
        </span>
      {/if}
      {#if replyingTo}
        <span class="reply-badge">
          Replying...
          <button type="button" class="remove-ts" onclick={() => replyingTo = null}>×</button>
        </span>
      {/if}
      <div class="comment-input-row">
        <input
          type="text"
          bind:value={body}
          placeholder={commentTimestamp !== null
            ? `Comment at ${formatTime(commentTimestamp)}...`
            : replyingTo
              ? 'Write a reply...'
              : 'Add a comment... (click waveform for timestamp)'}
        />
        <Button type="submit" size="sm" loading={submitting} disabled={!body.trim()}>Send</Button>
      </div>
    </form>
  {/if}

  <div class="comment-list">
    {#each topLevel as comment}
      <CommentItem {comment} {onSeek} {onResolve} onReply={handleReply} />
      {#each replies(comment.id) as reply}
        <div class="reply">
          <CommentItem comment={reply} {onSeek} {onResolve} />
        </div>
      {/each}
    {/each}

    {#if comments.length === 0}
      <EmptyState
        icon="💬"
        title="No comments yet"
        description="Click the waveform to leave a timestamped comment."
      />
    {/if}
  </div>
</div>

<style>
  .comments-section {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-5);
  }

  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-lg);
  }

  .comment-form {
    margin-bottom: var(--space-4);
  }

  .timestamp-badge, .reply-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0.15rem var(--space-2) 0.15rem var(--space-2);
    background: rgba(251, 191, 36, 0.15);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    margin-bottom: var(--space-2);
    color: var(--color-warning);
  }

  .reply-badge {
    background: var(--color-accent-subtle);
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .ts-seek, .remove-ts {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font-family: inherit;
    font-size: inherit;
  }

  .remove-ts {
    font-size: 1rem;
    line-height: 1;
  }

  .comment-input-row {
    display: flex;
    gap: var(--space-2);
  }

  .comment-input-row input {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-size: var(--text-sm);
    font-family: inherit;
  }

  .comment-input-row input:focus {
    outline: none;
    border-color: var(--color-border-focus);
  }

  .comment-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .reply {
    margin-left: var(--space-8);
  }
</style>
