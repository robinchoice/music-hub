<script lang="ts">
  import Input from '$lib/components/ui/Input.svelte';
  import { overviewIndex } from '$lib/stores/overview.js';
  import { artistNames } from '$lib/utils/overview.js';

  let { value = $bindable('') }: { value?: string } = $props();

  const names = $derived($overviewIndex ? artistNames($overviewIndex) : []);
  const typed = $derived(value.trim().toLowerCase());
  const match = $derived(names.find((n) => n.toLowerCase() === typed));
  // While typing only the artists that fit, the chosen one stays visible
  const shown = $derived(match || !typed ? names : names.filter((n) => n.toLowerCase().includes(typed)));
</script>

<div class="artist">
  <Input label="Artist (optional)" bind:value placeholder="z. B. Anna Berger" />
  {#if shown.length}
    <div class="chips" role="group" aria-label="Bestehende Artists">
      {#each shown as name (name)}
        <button
          type="button"
          class="chip"
          class:on={name === match}
          aria-pressed={name === match}
          onclick={() => (value = name === match ? '' : name)}>{name}</button
        >
      {/each}
    </div>
  {/if}
  {#if typed && !match}
    <span class="hint">Neuer Artist</span>
  {/if}
</div>

<style>
  .artist {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--color-border-hover);
    color: var(--color-text-primary);
  }
  .chip.on {
    background: var(--color-accent-subtle);
    border-color: var(--color-accent);
    color: var(--color-text-primary);
  }
  .hint {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
</style>
