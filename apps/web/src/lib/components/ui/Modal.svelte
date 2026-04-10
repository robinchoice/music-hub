<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    open = $bindable(false),
    title,
    children,
    actions,
  }: {
    open: boolean;
    title: string;
    children: Snippet;
    actions?: Snippet;
  } = $props();

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
  <div class="backdrop" onclick={handleBackdrop} role="dialog" aria-modal="true">
    <div class="modal">
      <div class="modal-header">
        <h2>{title}</h2>
        <button class="close-btn" onclick={() => open = false} aria-label="Schließen">
          <Icon name="x" size={18} />
        </button>
      </div>
      <div class="modal-body">
        {@render children()}
      </div>
      {#if actions}
        <div class="modal-actions">
          {@render actions()}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(8, 6, 14, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
    padding: var(--space-4);
    backdrop-filter: blur(12px) saturate(140%);
    -webkit-backdrop-filter: blur(12px) saturate(140%);
    animation: fade-in 200ms var(--ease-out);
  }

  .modal {
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 480px;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
    animation: pop-in 280ms var(--ease-spring);
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes pop-in {
    from { opacity: 0; transform: translateY(8px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--color-border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--color-text-primary);
  }

  .modal-body {
    padding: var(--space-6);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--color-border);
  }
</style>
