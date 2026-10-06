<script lang="ts">
  import { toasts, removeToast, type ToastType } from '$lib/stores/toast.js';
  import Icon from './Icon.svelte';

  const icons: Record<ToastType, 'check' | 'x' | 'comment' | 'trash'> = {
    success: 'check',
    error: 'x',
    info: 'comment',
    warning: 'comment',
    trash: 'trash',
  };
</script>

{#if $toasts.length > 0}
  <div class="toast-container">
    {#each $toasts as t (t.id)}
      <div class="toast {t.type}" role="alert">
        <span class="toast-icon"><Icon name={icons[t.type]} size={12} stroke={3} /></span>
        <span class="toast-message">{t.message}</span>
        {#if t.action}
          {@const action = t.action}
          <button class="toast-action" onclick={() => { removeToast(t.id); action.run(); }}>{action.label}</button>
          <span class="toast-bar" style="animation-duration: {t.duration}ms"></span>
        {/if}
        <button class="toast-close" onclick={() => removeToast(t.id)} aria-label="Schließen">
          <Icon name="x" size={14} />
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: var(--space-6);
    right: var(--space-6);
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-width: 400px;
  }

  .toast {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: color-mix(in srgb, var(--color-bg-overlay) 88%, transparent);
    backdrop-filter: blur(20px) saturate(150%);
    -webkit-backdrop-filter: blur(20px) saturate(150%);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    animation: slide-in 280ms var(--ease-spring);
    font-size: var(--text-sm);
  }

  .toast-icon {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .success .toast-icon { background: var(--color-success); color: #000; }
  .error .toast-icon { background: var(--color-error); color: var(--color-on-accent); }
  .info .toast-icon { background: var(--color-accent); color: var(--color-on-accent); }
  .warning .toast-icon { background: var(--color-warning); color: #000; }
  .trash .toast-icon { background: var(--color-bg-subtle); color: var(--color-text-primary); }

  .toast-message {
    flex: 1;
    color: var(--color-text-primary);
  }

  .toast-close {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    font-size: 1.1rem;
    padding: 0;
    line-height: 1;
  }

  .toast-close:hover {
    color: var(--color-text-primary);
  }

  .toast-action {
    flex-shrink: 0;
    padding: 4px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-accent);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
  }

  .toast-action:hover {
    background: var(--color-accent-subtle);
  }

  /* Runs out with the time left to undo */
  .toast-bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: var(--gradient-accent);
    animation: run-out linear forwards;
  }

  @keyframes run-out {
    from { width: 100%; }
    to { width: 0; }
  }

  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (max-width: 640px) {
    /* Above the bottom navigation, so "Rückgängig" stays reachable */
    .toast-container {
      left: var(--space-4);
      right: var(--space-4);
      bottom: calc(56px + env(safe-area-inset-bottom, 0px) + var(--space-3));
      max-width: none;
    }
  }
</style>
