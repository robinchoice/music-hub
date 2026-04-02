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
  <a {href} class="btn {variant} {size}" class:disabled>
    {@render children()}
  </a>
{:else}
  <button
    {type}
    class="btn {variant} {size}"
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
    cursor: pointer;
    transition: all var(--transition-fast);
    text-decoration: none;
    border: 1px solid transparent;
    position: relative;
  }

  .btn:disabled, .btn.disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
  }

  /* Sizes */
  .sm { padding: 0.3rem 0.6rem; font-size: var(--text-xs); }
  .md { padding: 0.5rem 1rem; font-size: var(--text-sm); }
  .lg { padding: 0.65rem 1.25rem; font-size: var(--text-base); }

  /* Variants */
  .primary {
    background: var(--color-accent);
    color: #fff;
    border-color: var(--color-accent);
  }
  .primary:hover:not(:disabled) {
    background: var(--color-accent-hover);
    border-color: var(--color-accent-hover);
  }

  .secondary {
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
    border-color: var(--color-border-hover);
  }
  .secondary:hover:not(:disabled) {
    border-color: var(--color-accent);
    color: var(--color-text-primary);
  }

  .ghost {
    background: transparent;
    color: var(--color-text-secondary);
  }
  .ghost:hover:not(:disabled) {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }

  .danger {
    background: transparent;
    color: var(--color-error);
    border-color: var(--color-error);
  }
  .danger:hover:not(:disabled) {
    background: var(--color-error);
    color: #fff;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    position: absolute;
  }

  .hidden {
    visibility: hidden;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
