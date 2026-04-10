<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'default',
    children,
  }: {
    variant?: 'default' | 'success' | 'warning' | 'error' | 'accent';
    children: Snippet;
  } = $props();
</script>

<span class="badge {variant}">
  {@render children()}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 0.2rem 0.55rem;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.01em;
    text-transform: capitalize;
    border: 1px solid transparent;
  }

  .default {
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
    border-color: var(--color-border);
  }

  .success {
    background: rgba(34, 197, 94, 0.15);
    color: var(--color-success);
  }

  .warning {
    background: rgba(251, 191, 36, 0.15);
    color: var(--color-warning);
  }

  .error {
    background: rgba(239, 68, 68, 0.15);
    color: var(--color-error);
  }

  .accent {
    background: var(--color-accent-subtle);
    color: #fb923c;
    border-color: rgba(244, 63, 94, 0.3);
  }
</style>
