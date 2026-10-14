<script lang="ts" module>
  import type { ReviewVerdict } from '$lib/utils/track.js';

  export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
    approve: 'Freigegeben',
    fine: 'Passt für mich',
    changes: 'Änderungen nötig',
    notes: 'Nur Anmerkungen',
  };
  export const VERDICT_VARIANT: Record<ReviewVerdict, 'default' | 'success' | 'error'> = {
    approve: 'success',
    fine: 'success',
    changes: 'error',
    notes: 'default',
  };
</script>

<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import { timeAgo } from '$lib/utils/format.js';
  import type { FeedbackRow } from '$lib/utils/track.js';

  let {
    rows,
    versionNumber,
    currentUserId = null,
  }: {
    rows: FeedbackRow[];
    versionNumber: number;
    currentUserId?: string | null;
  } = $props();

  const notes = (n: number) => (n === 1 ? 'eine Anmerkung' : `${n} Anmerkungen`);
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
        <span class="what">{row.review.commentCount ? notes(row.review.commentCount) : row.review.verdict ? '' : 'ohne Anmerkungen'}</span>
        <span class="when">{timeAgo(row.review.createdAt)}</span>
      {:else}
        <span class="what">steht noch aus</span>
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

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 30px;
    font-size: var(--text-sm);
  }

  .who {
    font-weight: 600;
  }

  .what {
    color: var(--color-text-secondary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .when {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    white-space: nowrap;
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
    background: var(--color-accent);
    animation: pulse 1.4s infinite;
    vertical-align: 1px;
  }

  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>
