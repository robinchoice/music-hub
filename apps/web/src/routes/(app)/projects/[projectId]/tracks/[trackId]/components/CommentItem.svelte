<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { COMMENT_REACTIONS } from '@music-hub/shared';
  import { t } from '$lib/i18n/index.js';
  import { formatTime, timeAgo } from '$lib/utils/format.js';
  import type { TrackComment } from '$lib/utils/track.js';

  let {
    comment,
    versionTag = null,
    active = false,
    fresh = false,
    isReply = false,
    currentUserId = null,
    canComment = false,
    onSeek,
    onReply,
    onResolve,
    onReopen,
    onReact,
    onEdit,
    onDelete,
    onRestore,
  }: {
    comment: TrackComment;
    versionTag?: string | null;
    active?: boolean;
    /** One of your comments that your next "Fertig" sends */
    fresh?: boolean;
    isReply?: boolean;
    currentUserId?: string | null;
    canComment?: boolean;
    onSeek?: (time: number) => void;
    onReply?: (body: string) => Promise<void>;
    onResolve?: () => Promise<void>;
    onReopen?: () => Promise<void>;
    onReact?: ((emoji: string) => Promise<void>) | undefined;
    onEdit?: (body: string) => Promise<void>;
    onDelete?: () => Promise<void>;
    onRestore?: () => Promise<void>;
  } = $props();

  const displayName = $derived(comment.user?.name ?? comment.guestName ?? t().common.guest);
  const isGuest = $derived(!comment.user);
  const isMine = $derived(!!currentUserId && comment.user?.id === currentUserId);

  let editing = $state(false);
  let editBody = $state('');
  let replying = $state(false);
  let replyBody = $state('');
  let busy = $state(false);
  let picking = $state(false);
  // On touch screens a tap on a reaction shows who reacted; you change your own in the picker
  let whoShown = $state<string | null>(null);
  let whoTimer: ReturnType<typeof setTimeout> | undefined;

  const reactions = $derived(comment.reactions ?? []);
  const canReact = $derived(!!onReact && canComment && !!currentUserId);
  const reactedByMe = (emoji: string) => !!reactions.find((r) => r.emoji === emoji)?.users.some((u) => u.id === currentUserId);
  const reactorNames = (users: { id: string; name: string }[]) => users.map((u) => (u.id === currentUserId ? t().common.you : u.name)).join(', ');

  // False when the action failed, the API client already showed the error
  async function run(action: () => Promise<void>) {
    busy = true;
    try {
      await action();
      return true;
    } catch {
      return false;
    } finally {
      busy = false;
    }
  }

  function react(emoji: string) {
    const fn = onReact;
    if (!fn || busy) return;
    picking = false;
    run(() => fn(emoji));
  }

  function tapReaction(emoji: string) {
    if (canReact && matchMedia('(hover: hover)').matches) return react(emoji);
    clearTimeout(whoTimer);
    whoShown = whoShown === emoji ? null : emoji;
    if (whoShown) whoTimer = setTimeout(() => (whoShown = null), 3000);
  }

  function startEdit() {
    editBody = comment.body;
    editing = true;
  }

  async function saveEdit() {
    const body = editBody.trim();
    const edit = onEdit;
    if (!body || !edit) return;
    if (await run(() => edit(body))) editing = false;
  }

  async function sendReply() {
    const body = replyBody.trim();
    const reply = onReply;
    if (!body || !reply) return;
    if (!(await run(() => reply(body)))) return;
    replyBody = '';
    replying = false;
  }
</script>

{#if comment.deletedAt}
  <!-- Deleted, but its replies still need their thread -->
  <div class="comment gone">
    <span class="ghost"><Icon name="trash" size={12} /></span>
    <div class="body">
      <div class="head">
        <span class="gone-text">{t().track.comment.deleted}</span>
        {#if comment.timestampSeconds !== null}
          <button class="ts" onclick={() => onSeek?.(comment.timestampSeconds!)}>{formatTime(comment.timestampSeconds)}</button>
        {/if}
      </div>
      {#if comment.restorable && onRestore}
        <div class="actions">
          <button onclick={() => onRestore && run(onRestore)} disabled={busy}><Icon name="restore" size={12} /> {t().track.comment.restore}</button>
        </div>
      {/if}
    </div>
  </div>
{:else}
<div class="comment" class:active class:fresh class:reply={isReply} class:resolved={!!comment.resolvedAt}>
  <Avatar name={displayName} src={comment.user?.avatarUrl ?? null} size="sm" />
  <div class="body">
    <div class="head">
      <span class="author">{displayName}</span>
      {#if isGuest}<span class="tag">{t().common.guest}</span>{/if}
      {#if versionTag}<span class="vtag" title={t().track.comment.commentOn(versionTag)}>{versionTag}</span>{/if}
      {#if fresh}<span class="fresh-tag" title={t().track.comment.freshTitle}>{t().track.comment.fresh}</span>{/if}
      {#if comment.timestampSeconds !== null}
        <button class="ts" class:other={!!versionTag} title={versionTag ? t().track.comment.positionIn(versionTag) : undefined} onclick={() => onSeek?.(comment.timestampSeconds!)}>{formatTime(comment.timestampSeconds)}</button>
      {:else if !isReply}
        <span class="tag">{t().track.comment.general}</span>
      {/if}
      <span class="when">{timeAgo(comment.createdAt)}</span>
    </div>

    {#if editing}
      <form class="inline-form" onsubmit={(e) => { e.preventDefault(); saveEdit(); }}>
        <textarea bind:value={editBody} rows="2"></textarea>
        <div class="form-actions">
          <button type="button" class="link" onclick={() => (editing = false)}>{t().common.cancel}</button>
          <button type="submit" class="link primary" disabled={!editBody.trim() || busy}>{t().common.save}</button>
        </div>
      </form>
    {:else}
      <p class="text">{comment.body}</p>
      {#if reactions.length > 0 || picking}
        <div class="reactions">
          {#each reactions as r (r.emoji)}
            <span class="reaction" class:shown={whoShown === r.emoji}>
              <button
                class="chip"
                class:mine={reactedByMe(r.emoji)}
                aria-pressed={reactedByMe(r.emoji)}
                aria-label="{r.emoji} {r.users.length}: {reactorNames(r.users)}"
                onclick={() => tapReaction(r.emoji)}
              >{r.emoji} <b>{r.users.length}</b></button>
              <span class="who" role="tooltip">{reactorNames(r.users)}</span>
            </span>
          {/each}
          {#if picking}
            <div class="picker" role="group" aria-label={t().track.comment.pickReaction}>
              {#each COMMENT_REACTIONS as emoji (emoji)}
                <button class:mine={reactedByMe(emoji)} aria-pressed={reactedByMe(emoji)} onclick={() => react(emoji)} disabled={busy}>{emoji}</button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      <div class="actions">
        {#if onReply && canComment && !isReply}
          <button onclick={() => (replying = !replying)}><Icon name="comment" size={12} /> {t().track.comment.reply}</button>
        {/if}
        {#if canReact}
          <button onclick={() => (picking = !picking)} aria-expanded={picking}><Icon name="smile" size={12} /> {t().track.comment.react}</button>
        {/if}
        {#if canComment && !isReply}
          {#if comment.resolvedAt && onReopen}
            <button onclick={() => onReopen && run(onReopen)} disabled={busy}>{t().track.comment.reopen}</button>
          {:else if !comment.resolvedAt && onResolve}
            <button class="ok" onclick={() => onResolve && run(onResolve)} disabled={busy}><Icon name="check" size={12} /> {t().track.comment.resolve}</button>
          {/if}
        {/if}
        {#if isMine && onEdit}
          <button onclick={startEdit}><Icon name="edit" size={12} /> {t().track.comment.edit}</button>
        {/if}
        {#if isMine && onDelete}
          <button class="danger" onclick={() => onDelete && run(onDelete)} disabled={busy}><Icon name="trash" size={12} /> {t().common.delete}</button>
        {/if}
      </div>
    {/if}

    {#if replying}
      <form class="inline-form" onsubmit={(e) => { e.preventDefault(); sendReply(); }}>
        <textarea bind:value={replyBody} rows="2" placeholder={t().track.comment.writeReply}></textarea>
        <div class="form-actions">
          <button type="button" class="link" onclick={() => (replying = false)}>{t().common.cancel}</button>
          <button type="submit" class="link primary" disabled={!replyBody.trim() || busy}>{t().track.comment.reply}</button>
        </div>
      </form>
    {/if}
  </div>
</div>
{/if}

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

  .ghost {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border: 1px dashed var(--color-border-hover);
    border-radius: 50%;
    color: var(--color-text-tertiary);
  }

  .gone-text {
    font-style: italic;
    color: var(--color-text-tertiary);
  }

  .comment.active {
    background: linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 9%, transparent), rgba(244, 63, 94, 0) 75%);
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

  .fresh {
    box-shadow: inset 3px 0 0 var(--color-accent);
  }

  .fresh-tag {
    padding: 0 6px;
    line-height: 18px;
    font-size: var(--text-xs);
    color: var(--color-accent);
    background: var(--color-accent-subtle);
    border-radius: var(--radius-sm);
  }

  /* The version a carried-over comment belongs to, styled like the version picker */
  .vtag {
    padding: 0 6px;
    line-height: 18px;
    font-family: var(--font-display);
    font-weight: 800;
    font-stretch: 78%;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    border: 1px dashed var(--color-border-hover);
    border-radius: var(--radius-sm);
  }

  .ts {
    padding: 0 6px;
    line-height: 18px;
    font-family: inherit;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .ts:hover {
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  }

  /* A position in another version's audio: not on this waveform */
  .ts.other {
    color: var(--color-text-secondary);
    background: var(--color-bg-subtle);
    border-color: var(--color-border-hover);
  }

  .ts.other:hover {
    color: var(--color-text-primary);
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

  .reactions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
  }

  .reaction {
    position: relative;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px;
    line-height: 20px;
    font-family: inherit;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border-hover);
    border-radius: 999px;
    cursor: pointer;
  }

  .chip b {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .chip.mine {
    color: var(--color-accent);
    background: var(--color-accent-subtle);
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
  }

  .who {
    display: none;
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 5;
    width: max-content;
    max-width: 220px;
    padding: 4px 8px;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--color-text-primary);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    pointer-events: none;
  }

  .reaction.shown .who,
  .reaction:focus-within .who {
    display: block;
  }

  @media (hover: hover) {
    .reaction:hover .who {
      display: block;
    }
  }

  .picker {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border-hover);
    border-radius: 999px;
  }

  .picker button {
    width: 30px;
    height: 26px;
    padding: 0;
    font-size: 15px;
    line-height: 1;
    background: none;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .picker button:hover,
  .picker button.mine {
    background: var(--color-accent-subtle);
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
