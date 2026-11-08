<script lang="ts">
  type Tab = { id: string; label: string; count?: number | undefined; disabled?: boolean; title?: string | undefined };

  let { tabs, active, onselect }: { tabs: Tab[]; active: string; onselect: (id: string) => void } = $props();
</script>

<div class="tabbar" role="tablist">
  {#each tabs as tab (tab.id)}
    <button
      type="button"
      role="tab"
      aria-selected={tab.id === active}
      class:on={tab.id === active}
      disabled={tab.disabled}
      title={tab.title}
      onclick={() => onselect(tab.id)}
    >
      {tab.label}{#if tab.count !== undefined}<i>{tab.count}</i>{/if}
    </button>
  {/each}
</div>

<style>
  /* One line that scrolls sideways on narrow screens; the line under it is a shadow so scrolling cannot clip the active tab */
  .tabbar {
    display: flex;
    gap: var(--space-6);
    overflow-x: auto;
    scrollbar-width: none;
    box-shadow: inset 0 -1px 0 var(--color-border);
  }
  .tabbar::-webkit-scrollbar {
    display: none;
  }
  @media (max-width: 480px) {
    .tabbar {
      gap: var(--space-4);
    }
  }
  button {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    padding: 10px 2px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    font: inherit;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    white-space: nowrap;
    cursor: pointer;
    transition: color var(--transition-fast);
  }
  button:hover:not(:disabled) {
    color: var(--color-text-primary);
  }
  button.on {
    color: var(--color-text-primary);
    border-image: var(--gradient-accent) 1;
  }
  button:disabled {
    color: var(--color-text-tertiary);
    cursor: not-allowed;
  }
  i {
    font-style: normal;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
</style>
