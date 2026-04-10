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
    letter-spacing: -0.01em;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      color var(--transition-fast),
      transform var(--transition-fast),
      box-shadow var(--transition-fast);
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
    color: #fff;
    border-color: transparent;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.15) inset, 0 4px 14px rgba(244, 63, 94, 0.25);
  }
  .primary:hover:not(:disabled) {
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.2) inset, 0 8px 24px rgba(244, 63, 94, 0.35);
    transform: translateY(-1px);
  }
  .primary:active:not(:disabled) {
    transform: scale(0.97) translateY(0);
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
    border-color: rgba(239, 68, 68, 0.4);
  }
  .danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.12);
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
