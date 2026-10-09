<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CommentItem from './CommentItem.svelte';
  import { formatTime } from '$lib/utils/format.js';
  import { byPosition, activeCommentId, type TrackComment } from '$lib/utils/track.js';

  let {
    versionLabel,
    comments,
    carryLabel = null,
    carryComments = [],
    canComment = false,
    currentUserId = null,
    currentTime = 0,
    commentTimestamp = $bindable<number | null>(null),
    onSubmit,
    onReply,
    onResolve,
    onReopen,
    onEdit,
    onDelete,
    onRestore,
    onSeek,
  }: {
    versionLabel: string;
    comments: TrackComment[];
    carryLabel?: string | null;
    carryComments?: TrackComment[];
    canComment?: boolean;
    currentUserId?: string | null;
    currentTime?: number;
    commentTimestamp: number | null;
    onSubmit: (body: string, timestamp: number | null) => Promise<void>;
    onReply: (parentId: string, body: string, onCarry: boolean) => Promise<void>;
    onResolve: (id: string) => Promise<void>;
    onReopen: (id: string) => Promise<void>;
    onEdit: (id: string, body: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onRestore: (id: string) => Promise<void>;
    onSeek: (time: number) => void;
  } = $props();

  let body = $state('');
  let submitting = $state(false);
  let filter = $state<'open' | 'done'>('open');
  let carryOpen = $state(true);
  let input = $state<HTMLInputElement>();

  const topLevel = $derived(comments.filter((c) => !c.parentId));
  const open = $derived(topLevel.filter((c) => !c.resolvedAt).sort(byPosition));
  const done = $derived(topLevel.filter((c) => c.resolvedAt).sort(byPosition));
  const shown = $derived(filter === 'open' ? open : done);
  // Placeholders of deleted comments are listed for their replies, but don't count
  const openCount = $derived(open.filter((c) => !c.deletedAt).length);
  const doneCount = $derived(done.filter((c) => !c.deletedAt).length);
  const activeId = $derived(activeCommentId(open.filter((c) => !c.deletedAt), currentTime));
  const carryOpenItems = $derived(carryComments.filter((c) => !c.parentId && !c.resolvedAt && !c.deletedAt).sort(byPosition));

  function repliesOf(list: TrackComment[], id: string) {
    return list.filter((c) => c.parentId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  function focusComposer() {
    input?.focus();
  }

  async function submit() {
    const text = body.trim();
    if (!text) return;
    const timestamp = commentTimestamp;
    submitting = true;
    try {
      await onSubmit(text, timestamp);
      // The list updates before onSubmit returns; keep a next comment the user already started
      if (body.trim() === text) body = '';
      if (commentTimestamp === timestamp) commentTimestamp = null;
    } finally {
      submitting = false;
    }
  }

  export { focusComposer };
</script>

<section class="comments">
  {#if canComment}
    <form class="composer" onsubmit={(e) => { e.preventDefault(); submit(); }}>
      {#if commentTimestamp !== null}
        <span class="ts-chip">
          <button type="button" class="ts-seek" onclick={() => onSeek(commentTimestamp!)}>
            <Icon name="clock" size={12} /> {formatTime(commentTimestamp)}
          </button>
          <button type="button" class="ts-remove" onclick={() => (commentTimestamp = null)} aria-label="Stelle entfernen">×</button>
        </span>
      {/if}
      <input bind:this={input} type="text" bind:value={body} placeholder={`Kommentar zu ${versionLabel} …`} />
      <Button type="submit" size="sm" loading={submitting} disabled={!body.trim()}>Senden</Button>
    </form>
    <p class="hint">Klick in die Wellenform wählt die Stelle<span class="keys">{' '}· Taste C nimmt die aktuelle Position</span></p>
  {/if}

  <div class="list-head">
    <h2>Kommentare <span>zu {versionLabel}</span></h2>
    <div class="filter">
      <button class:on={filter === 'open'} aria-pressed={filter === 'open'} onclick={() => (filter = 'open')}>Offen <i>{openCount}</i></button>
      <button class:on={filter === 'done'} aria-pressed={filter === 'done'} onclick={() => (filter = 'done')}>Erledigte <i>{doneCount}</i></button>
    </div>
  </div>

  {#if shown.length === 0}
    <p class="empty">
      {filter === 'open' ? 'Keine offenen Kommentare. Klick in die Wellenform, um eine Stelle zu markieren.' : 'Noch nichts erledigt.'}
    </p>
  {:else}
    <div class="list">
      {#each shown as comment (comment.id)}
        <CommentItem
          {comment}
          active={comment.id === activeId}
          {currentUserId}
          {canComment}
          {onSeek}
          onReply={(text) => onReply(comment.id, text, false)}
          onResolve={() => onResolve(comment.id)}
          onReopen={() => onReopen(comment.id)}
          onEdit={(text) => onEdit(comment.id, text)}
          onDelete={() => onDelete(comment.id)}
          onRestore={() => onRestore(comment.id)}
        />
        {#each repliesOf(comments, comment.id) as reply (reply.id)}
          <div class="replies">
            <CommentItem
              comment={reply}
              isReply
              {currentUserId}
              {canComment}
              {onSeek}
              onEdit={(text) => onEdit(reply.id, text)}
              onDelete={() => onDelete(reply.id)}
            />
          </div>
        {/each}
      {/each}
    </div>
  {/if}

  {#if carryLabel && carryOpenItems.length > 0}
    <div class="carry">
      <button class="carry-head" onclick={() => (carryOpen = !carryOpen)} aria-expanded={carryOpen}>
        <Icon name={carryOpen ? 'chevron-down' : 'chevron-right'} size={14} />
        <b>Aus {carryLabel} noch offen</b>
        <i>{carryOpenItems.length}</i>
        <span>In {versionLabel} gelöst?</span>
      </button>
      {#if carryOpen}
        {#each carryOpenItems as comment (comment.id)}
          <CommentItem
            {comment}
            versionTag={carryLabel}
            {currentUserId}
            {canComment}
            {onSeek}
            onReply={(text) => onReply(comment.id, text, true)}
            onResolve={() => onResolve(comment.id)}
          />
          {#each repliesOf(carryComments, comment.id) as reply (reply.id)}
            <div class="replies">
              <CommentItem comment={reply} isReply {currentUserId} {onSeek} />
            </div>
          {/each}
        {/each}
      {/if}
    </div>
  {/if}
</section>

<style>
  .comments {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .composer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 6px 6px 6px var(--space-2);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
  }

  .composer:focus-within {
    border-color: var(--color-border-focus);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 8%, transparent);
  }

  .composer input {
    flex: 1;
    min-width: 0;
    padding: 6px 4px;
    border: none;
    background: none;
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
  }

  .composer input:focus {
    outline: none;
  }

  .ts-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 28px;
    padding: 0 6px;
    flex-shrink: 0;
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    border-radius: var(--radius-sm);
  }

  .ts-seek,
  .ts-remove {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 2px;
    border: none;
    background: none;
    color: inherit;
    font-family: inherit;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .ts-remove {
    font-size: 1rem;
    line-height: 1;
    opacity: 0.6;
  }

  .hint {
    margin: 0 2px var(--space-3);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  /* Touch screens have no keyboard shortcuts */
  @media (hover: none) {
    .keys {
      display: none;
    }
  }

  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .list-head h2 {
    margin: 0;
    font-size: 1.5rem;
    white-space: nowrap;
  }

  .list-head h2 span {
    margin-left: 4px;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-text-tertiary);
  }

  .filter {
    display: inline-flex;
    padding: 2px;
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .filter button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .filter button.on {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }

  .filter i {
    font-style: normal;
    color: var(--color-text-tertiary);
  }

  .list {
    display: flex;
    flex-direction: column;
  }

  .replies {
    margin-left: 44px;
  }

  .empty {
    margin: var(--space-3) 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  .carry {
    margin-top: var(--space-3);
    padding: 2px var(--space-2) var(--space-2);
    border: 1px dashed #3d3646;
    border-radius: var(--radius-lg);
  }

  .carry-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-3) var(--space-2);
    border: none;
    background: none;
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .carry-head :global(svg) {
    color: var(--color-text-tertiary);
  }

  .carry-head i {
    padding: 0 7px;
    font-style: normal;
    font-size: var(--text-xs);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    border-radius: var(--radius-full);
  }

  .carry-head span {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
</style>
