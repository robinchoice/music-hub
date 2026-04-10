<script lang="ts">
  import { TRACK_STATUS_LABELS, type TrackStatus } from '@music-hub/shared';

  let {
    status,
    size = 'sm',
  }: { status: TrackStatus; size?: 'sm' | 'md' } = $props();

  const COLORS: Record<TrackStatus, { bg: string; fg: string; border: string }> = {
    sketch: {
      bg: 'rgba(155, 150, 168, 0.12)',
      fg: '#9b96a8',
      border: 'rgba(155, 150, 168, 0.3)',
    },
    in_progress: {
      bg: 'rgba(251, 146, 60, 0.12)',
      fg: '#fb923c',
      border: 'rgba(251, 146, 60, 0.35)',
    },
    final: {
      bg: 'rgba(34, 197, 94, 0.12)',
      fg: '#22c55e',
      border: 'rgba(34, 197, 94, 0.35)',
    },
    released: {
      bg: 'rgba(244, 63, 94, 0.12)',
      fg: '#f43f5e',
      border: 'rgba(244, 63, 94, 0.4)',
    },
  };

  const c = $derived(COLORS[status]);
</script>

<span
  class="pill {size}"
  style="background: {c.bg}; color: {c.fg}; border-color: {c.border}"
>
  <span class="dot" style="background: {c.fg}"></span>
  {TRACK_STATUS_LABELS[status]}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
  }
  .sm {
    padding: 3px 8px 3px 7px;
    font-size: var(--text-xs);
  }
  .md {
    padding: 5px 11px 5px 10px;
    font-size: var(--text-sm);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
