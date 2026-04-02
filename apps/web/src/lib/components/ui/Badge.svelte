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
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: capitalize;
  }

  .default {
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
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
    color: var(--color-accent);
  }
</style>
