<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { formatTime, timeAgo } from '$lib/utils/format.js';
  import type { TrackComment } from '$lib/utils/track.js';

  let {
    comment,
    versionTag = null,
    active = false,
    isReply = false,
    currentUserId = null,
    canComment = false,
    onSeek,
    onReply,
    onResolve,
    onReopen,
    onEdit,
    onDelete,
  }: {
    comment: TrackComment;
    versionTag?: string | null;
    active?: boolean;
    isReply?: boolean;
    currentUserId?: string | null;
    canComment?: boolean;
    onSeek?: (time: number) => void;
    onReply?: (body: string) => Promise<void>;
    onResolve?: () => Promise<void>;
    onReopen?: () => Promise<void>;
    onEdit?: (body: string) => Promise<void>;
    onDelete?: () => Promise<void>;
  } = $props();

  const displayName = $derived(comment.user?.name ?? comment.guestName ?? 'Gast');
  const isGuest = $derived(!comment.user);
  const isMine = $derived(!!currentUserId && comment.user?.id === currentUserId);

  let editing = $state(false);
  let editBody = $state('');
  let replying = $state(false);
  let replyBody = $state('');
  let busy = $state(false);

  async function run(action: () => Promise<void>) {
    busy = true;
    try {
      await action();
    } finally {
      busy = false;
    }
  }

  function startEdit() {
    editBody = comment.body;
    editing = true;
  }

  async function saveEdit() {
    const body = editBody.trim();
    const edit = onEdit;
    if (!body || !edit) return;
    await run(() => edit(body));
    editing = false;
  }

  async function sendReply() {
    const body = replyBody.trim();
    const reply = onReply;
    if (!body || !reply) return;
    await run(() => reply(body));
    replyBody = '';
    replying = false;
  }
</script>

<div class="comment" class:active class:reply={isReply} class:resolved={!!comment.resolvedAt}>
  <Avatar name={displayName} src={comment.user?.avatarUrl ?? null} size="sm" />
  <div class="body">
    <div class="head">
      <span class="author">{displayName}</span>
      {#if isGuest}<span class="tag">Gast</span>{/if}
      {#if versionTag}<span class="tag">{versionTag}</span>{/if}
      {#if comment.timestampSeconds !== null}
        <button class="ts" onclick={() => onSeek?.(comment.timestampSeconds!)}>{formatTime(comment.timestampSeconds)}</button>
      {:else if !isReply}
        <span class="tag">Allgemein</span>
      {/if}
      <span class="when">{timeAgo(comment.createdAt)}</span>
    </div>

    {#if editing}
      <form class="inline-form" onsubmit={(e) => { e.preventDefault(); saveEdit(); }}>
        <textarea bind:value={editBody} rows="2"></textarea>
        <div class="form-actions">
          <button type="button" class="link" onclick={() => (editing = false)}>Abbrechen</button>
          <button type="submit" class="link primary" disabled={!editBody.trim() || busy}>Speichern</button>
        </div>
      </form>
    {:else}
      <p class="text">{comment.body}</p>
      <div class="actions">
        {#if onReply && canComment && !isReply}
          <button onclick={() => (replying = !replying)}><Icon name="comment" size={12} /> Antworten</button>
        {/if}
        {#if canComment && !isReply}
          {#if comment.resolvedAt && onReopen}
            <button onclick={() => onReopen && run(onReopen)} disabled={busy}>Wieder öffnen</button>
          {:else if !comment.resolvedAt && onResolve}
            <button class="ok" onclick={() => onResolve && run(onResolve)} disabled={busy}><Icon name="check" size={12} /> Erledigt</button>
          {/if}
        {/if}
        {#if isMine && onEdit}
          <button onclick={startEdit}><Icon name="edit" size={12} /> Bearbeiten</button>
        {/if}
        {#if isMine && onDelete}
          <button class="danger" onclick={() => onDelete && run(onDelete)} disabled={busy}><Icon name="trash" size={12} /> Löschen</button>
        {/if}
      </div>
    {/if}

    {#if replying}
      <form class="inline-form" onsubmit={(e) => { e.preventDefault(); sendReply(); }}>
        <textarea bind:value={replyBody} rows="2" placeholder="Antwort schreiben …"></textarea>
        <div class="form-actions">
          <button type="button" class="link" onclick={() => (replying = false)}>Abbrechen</button>
          <button type="submit" class="link primary" disabled={!replyBody.trim() || busy}>Antworten</button>
        </div>
      </form>
    {/if}
  </div>
</div>

<style>
  .comment {
    position: relative;
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md);
  }

  .comment.reply {
    padding: var(--space-2) 0 0;
  }

  .comment.active {
    background: linear-gradient(90deg, rgba(244, 63, 94, 0.09), rgba(244, 63, 94, 0) 75%);
  }

  .comment.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: var(--space-3);
    bottom: var(--space-3);
    width: 2px;
    border-radius: 2px;
    background: var(--color-accent);
  }

  .body {
    flex: 1;
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .author {
    color: var(--color-text-primary);
    font-weight: 600;
  }

  .tag {
    padding: 0 6px;
    line-height: 18px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-sm);
  }

  .ts {
    padding: 0 6px;
    line-height: 18px;
    font-family: inherit;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--color-warning);
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.25);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .ts:hover {
    background: rgba(251, 191, 36, 0.2);
  }

  .when {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }

  .text {
    margin: 3px 0 0;
    font-size: var(--text-sm);
    line-height: 1.45;
    color: var(--color-text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .comment.resolved .text {
    color: var(--color-text-secondary);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin: 4px 0 0 -7px;
  }

  .actions button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-tertiary);
    font-family: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .actions button:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-subtle);
  }

  .actions .ok:hover {
    color: var(--color-success);
  }

  .actions .danger:hover {
    color: var(--color-error);
  }

  .actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .inline-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .inline-form textarea {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    resize: vertical;
  }

  .inline-form textarea:focus {
    outline: none;
    border-color: var(--color-border-focus);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }

  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text-tertiary);
    font-family: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .link:hover {
    color: var(--color-text-primary);
  }

  .link.primary {
    color: var(--color-accent);
  }

  .link:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
