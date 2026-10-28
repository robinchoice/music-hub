<script lang="ts">
  import type { Snippet } from 'svelte';
  import { trapFocus } from '$lib/utils/focus-trap.js';

  let {
    open = $bindable(false),
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: Snippet;
  } = $props();

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) open = false;
  }
</script>

{#if open}
  <div class="backdrop" onclick={handleBackdrop} role="presentation">
    <div class="sheet" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" use:trapFocus={() => (open = false)}>
      <div class="grabber" aria-hidden="true"></div>
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: rgba(8, 6, 14, 0.6);
    display: flex;
    align-items: flex-end;
  }

  .sheet {
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
    background: var(--color-bg-raised);
    border-top: 1px solid var(--color-border-hover);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding: var(--space-2) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom));
    box-shadow: var(--shadow-lg);
    outline: none;
  }

  .grabber {
    width: 36px;
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--color-border-hover);
    margin: var(--space-1) auto var(--space-4);
  }
</style>
