<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    href,
    type = 'button',
    onclick,
    children,
  }: {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    loading?: boolean;
    disabled?: boolean;
    href?: string;
    type?: 'button' | 'submit';
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

{#if href}
  <a {href} class="btn {variant} {size}" class:disabled {onclick}>
    {@render children()}
  </a>
{:else}
  <button
    {type}
    class="btn {variant} {size}"
    class:loading
    disabled={disabled || loading}
    {onclick}
  >
    {#if loading}
      <span class="spinner"></span>
    {/if}
    <span class:hidden={loading}>
      {@render children()}
    </span>
  </button>
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-weight: 500;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      color var(--transition-fast),
      transform var(--transition-fast),
      filter var(--transition-fast);
    text-decoration: none;
    border: 1px solid transparent;
    position: relative;
    user-select: none;
    white-space: nowrap;
  }

  .btn:active:not(:disabled) {
    transform: scale(0.97);
  }

  .btn:disabled, .btn.disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
  }

  /* Sizes */
  .sm { padding: 0.35rem 0.7rem; font-size: var(--text-xs); height: 28px; }
  .md { padding: 0.5rem 1rem; font-size: var(--text-sm); height: 36px; }
  .lg { padding: 0.7rem 1.4rem; font-size: var(--text-base); height: 44px; }

  /* Variants */
  .primary {
    background: var(--gradient-accent);
    color: var(--color-on-accent);
    border-color: transparent;
    font-weight: 600;
  }
  .primary:hover:not(:disabled) {
    filter: brightness(1.06) saturate(1.05);
  }
  /* Without anything to do there is no gradient */
  .primary:disabled:not(.loading),
  .primary.disabled {
    background: var(--color-bg-subtle);
    color: var(--color-text-tertiary);
    opacity: 1;
  }

  .secondary {
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    border-color: var(--color-border);
  }
  .secondary:hover:not(:disabled) {
    background: var(--color-bg-overlay);
    border-color: var(--color-border-hover);
  }

  .ghost {
    background: transparent;
    color: var(--color-text-secondary);
  }
  .ghost:hover:not(:disabled) {
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
  }

  .danger {
    background: transparent;
    color: var(--color-error);
    border-color: color-mix(in srgb, var(--color-error) 40%, transparent);
  }
  .danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-error) 12%, transparent);
    border-color: var(--color-error);
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    position: absolute;
    opacity: 0.9;
  }

  .hidden {
    visibility: hidden;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
