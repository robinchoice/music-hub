<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import { timeAgo } from '$lib/utils/format.js';
  import type { FeedbackRow, ReviewVerdict } from '$lib/utils/track.js';

  const VERDICT_LABEL: Record<ReviewVerdict, string> = {
    approve: 'Freigegeben',
    fine: 'Passt für mich',
    changes: 'Änderungen nötig',
    notes: 'Nur Anmerkungen',
  };
  const VERDICT_VARIANT: Record<ReviewVerdict, 'default' | 'success' | 'warning'> = {
    approve: 'success',
    fine: 'success',
    changes: 'warning',
    notes: 'default',
  };

  let {
    rows,
    versionNumber,
    currentUserId = null,
    remindable = [],
    onRemind,
  }: {
    rows: FeedbackRow[];
    versionNumber: number;
    currentUserId?: string | null;
    /** Approvers whose verdict is missing and who may be reminded */
    remindable?: string[];
    onRemind?: (userId: string) => Promise<void>;
  } = $props();

  const notes = (n: number) => (n === 1 ? 'eine Anmerkung' : `${n} Anmerkungen`);

  let reminded = $state<string[]>([]);
  async function remind(userId: string) {
    try {
      await onRemind!(userId);
      reminded = [...reminded, userId];
    } catch {
      // The API client already showed the error
    }
  }
</script>

<!-- Who finished listening to the version and how, who is still at it, which approvers are missing -->
<div class="feedback">
  <h3>Rückmeldungen zu V{versionNumber}</h3>
  {#each rows as row (row.key)}
    <div class="row">
      <Avatar name={row.name} src={row.avatarUrl} size="xs" />
      <span class="who">{row.key === currentUserId ? 'Du' : row.name}</span>
      {#if row.open > 0}
        <span class="what"><span class="pulse" aria-hidden="true"></span>{row.key === currentUserId ? 'noch nicht fertig' : 'noch dabei'} · {notes(row.open)} neu</span>
      {:else if row.review}
        {#if row.review.verdict}
          <Badge variant={VERDICT_VARIANT[row.review.verdict]}>{VERDICT_LABEL[row.review.verdict]}</Badge>
        {/if}
        <span class="what">
          {[row.review.commentCount ? notes(row.review.commentCount) : null, row.review.verdict ? null : 'ohne Urteil'].filter(Boolean).join(', ')}
        </span>
        <span class="when">{timeAgo(row.review.createdAt)}</span>
      {:else}
        <span class="what">steht noch aus</span>
      {/if}
      {#if onRemind && remindable.includes(row.key) && row.key !== currentUserId}
        <button class="remind" disabled={reminded.includes(row.key)} onclick={() => remind(row.key)}>
          {reminded.includes(row.key) ? 'Erinnert' : 'Erinnern'}
        </button>
      {/if}
    </div>
    {#if row.open === 0 && row.review?.note}
      <p class="note">„{row.review.note}“</p>
    {/if}
  {/each}
</div>

<style>
  .feedback {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }

  /* On phones the count and the time move to a second line instead of squeezing the badge */
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px var(--space-2);
    min-height: 30px;
    font-size: var(--text-sm);
  }

  .row :global(.badge) {
    white-space: nowrap;
  }

  .who {
    font-weight: 600;
    white-space: nowrap;
  }

  .what {
    color: var(--color-text-secondary);
  }

  .when {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .remind {
    margin-left: auto;
    padding: 2px var(--space-2);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .when + .remind {
    margin-left: var(--space-2);
  }
  .remind:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-text-tertiary);
  }
  .remind:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .note {
    margin: 0 0 var(--space-1) calc(20px + var(--space-2));
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    white-space: pre-wrap;
  }

  .pulse {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--color-text-tertiary);
    animation: pulse 1.4s infinite;
    vertical-align: 1px;
  }

  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>
