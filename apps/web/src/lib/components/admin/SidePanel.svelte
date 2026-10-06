<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  // Panel on the right that leaves the page beside it visible; full screen on phones
  let {
    open = $bindable(false),
    label,
    children,
  }: {
    open: boolean;
    label: string;
    children: Snippet;
  } = $props();

  let panel = $state<HTMLElement | undefined>();
  const narrow = () => window.matchMedia('(max-width: 640px)').matches;

  $effect(() => {
    if (open) panel?.focus();
  });
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && (open = false)} />

{#if open}
  <button class="backdrop" aria-label="Schließen" onclick={() => (open = false)}></button>
  <aside
    class="panel"
    aria-label={label}
    tabindex="-1"
    bind:this={panel}
    transition:fly={narrow() ? { y: 40, duration: 220, easing: cubicOut } : { x: 60, duration: 220, easing: cubicOut }}
  >
    {@render children()}
  </aside>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: rgba(8, 6, 14, 0.5);
    border: none;
    cursor: default;
  }
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(520px, 100%);
    z-index: var(--z-modal);
    background: var(--color-bg-raised);
    border-left: 1px solid var(--color-border);
    box-shadow: var(--shadow-lg);
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
  }
  @media (max-width: 640px) {
    .panel {
      width: 100%;
      border-left: none;
    }
  }
</style>
