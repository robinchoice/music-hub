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
    background: color-mix(in srgb, var(--color-success) 12%, transparent);
    color: var(--color-success);
  }

  .warning {
    background: color-mix(in srgb, var(--color-warning) 12%, transparent);
    color: var(--color-warning);
  }

  .error {
    background: color-mix(in srgb, var(--color-error) 12%, transparent);
    color: var(--color-error);
  }

  .accent {
    background: var(--color-accent-subtle);
    color: var(--color-accent);
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
  }
</style>
