<script lang="ts">
  import { toasts, removeToast, type ToastType } from '$lib/stores/toast.js';

  const icons: Record<ToastType, string> = {
    success: '✓',
    error: '✕',
    info: 'i',
    warning: '!',
  };
</script>

{#if $toasts.length > 0}
  <div class="toast-container">
    {#each $toasts as t (t.id)}
      <div class="toast {t.type}" role="alert">
        <span class="toast-icon">{icons[t.type]}</span>
        <span class="toast-message">{t.message}</span>
        <button class="toast-close" onclick={() => removeToast(t.id)}>×</button>
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
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    animation: slide-in 0.2s ease;
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
  .error .toast-icon { background: var(--color-error); color: #fff; }
  .info .toast-icon { background: var(--color-accent); color: #fff; }
  .warning .toast-icon { background: var(--color-warning); color: #000; }

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

  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @media (max-width: 640px) {
    .toast-container {
      left: var(--space-4);
      right: var(--space-4);
      bottom: var(--space-4);
      max-width: none;
    }
  }
</style>
