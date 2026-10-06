<script lang="ts">
  import { TRACK_STATUS_LABELS, type TrackStatus } from '@music-hub/shared';

  let {
    status,
    size = 'sm',
  }: { status: TrackStatus; size?: 'sm' | 'md' } = $props();

  // Sketch neutral, in progress in the product colour, final green, released filled in the text colour
  const tint = (color: string, alpha: number) => `color-mix(in srgb, ${color} ${alpha}%, transparent)`;
  const COLORS: Record<TrackStatus, { bg: string; fg: string; border: string }> = {
    sketch: {
      bg: tint('var(--color-text-secondary)', 12),
      fg: 'var(--color-text-secondary)',
      border: tint('var(--color-text-secondary)', 30),
    },
    in_progress: {
      bg: 'var(--color-accent-subtle)',
      fg: 'var(--color-accent)',
      border: tint('var(--color-accent)', 40),
    },
    final: {
      bg: tint('var(--color-success)', 12),
      fg: 'var(--color-success)',
      border: tint('var(--color-success)', 35),
    },
    released: {
      bg: 'var(--color-text-primary)',
      fg: 'var(--color-bg-base)',
      border: 'var(--color-text-primary)',
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
