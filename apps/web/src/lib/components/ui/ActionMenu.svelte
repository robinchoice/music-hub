<script lang="ts" module>
  import type { ComponentProps } from 'svelte';
  import type IconType from './Icon.svelte';

  type IconName = ComponentProps<typeof IconType>['name'];

  export type MenuEntry =
    | { label: string; icon?: IconName; run: () => void; danger?: boolean; checked?: boolean; hint?: string }
    | { label: string; icon?: IconName; items: MenuEntry[] }
    | 'separator';
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';

  // A menu of actions like a drive's right click: at the pointer on wide screens,
  // as a sheet from below on phones and touch screens. A group (e.g. sections) opens in place.
  let {
    open = $bindable(false),
    at = null,
    title,
    items,
  }: {
    open: boolean;
    /** Where the pointer or the "⋯" button was, in viewport pixels */
    at?: { x: number; y: number } | null;
    title: string;
    items: MenuEntry[];
  } = $props();

  let menu = $state<HTMLDivElement>();
  let pos = $state({ x: 0, y: 0 });
  let unfolded = $state<string | null>(null);
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;

  $effect(() => {
    if (!open || narrow) return;
    pos = { x: at?.x ?? window.innerWidth / 2, y: at?.y ?? window.innerHeight / 3 };
    unfolded = null;
    void tick().then(() => {
      place();
      menu?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });
  });

  // Inside the window, also once a group has opened
  function place() {
    if (!menu) return;
    const r = menu.getBoundingClientRect();
    pos = {
      x: Math.max(8, Math.min(pos.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(pos.y, window.innerHeight - r.height - 8)),
    };
  }

  function choose(run: () => void) {
    open = false;
    run();
  }

  async function toggle(label: string) {
    unfolded = unfolded === label ? null : label;
    await tick();
    place();
  }

  function keydown(e: KeyboardEvent) {
    if (!open || narrow) return;
    if (e.key === 'Escape') {
      open = false;
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [...(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    e.preventDefault();
  }

  function pointerdown(e: PointerEvent) {
    if (open && !narrow && menu && !menu.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onkeydown={keydown} onpointerdown={pointerdown} onresize={() => (open = narrow ? open : false)} />

{#snippet entries(list: MenuEntry[], nested: boolean)}
  {#each list as entry, i (typeof entry === 'string' ? `sep-${i}` : entry.label)}
    {#if entry === 'separator'}
      <hr />
    {:else if 'items' in entry}
      <button type="button" role="menuitem" aria-expanded={unfolded === entry.label} onclick={() => toggle(entry.label)}>
        {#if entry.icon}<Icon name={entry.icon} size={narrow ? 18 : 14} />{/if}
        <span class="label">{entry.label}</span>
        <Icon name={unfolded === entry.label ? 'chevron-down' : 'chevron-right'} size={13} />
      </button>
      {#if unfolded === entry.label}
        <div class="group" role="group" aria-label={entry.label}>{@render entries(entry.items, true)}</div>
      {/if}
    {:else}
      <button type="button" role={entry.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={entry.checked} class:danger={entry.danger} class:nested onclick={() => choose(entry.run)}>
        {#if entry.checked !== undefined}
          <span class="check">{#if entry.checked}<Icon name="check" size={13} />{/if}</span>
        {:else if entry.icon}
          <Icon name={entry.icon} size={narrow ? 18 : 14} />
        {/if}
        <span class="label">{entry.label}{#if entry.hint}<small>{entry.hint}</small>{/if}</span>
      </button>
    {/if}
  {/each}
{/snippet}

{#if narrow}
  <Sheet bind:open {title}>
    <div class="sheet-list" role="menu" aria-label={title}>
      <p class="sheet-title">{title}</p>
      {@render entries(items, false)}
    </div>
  </Sheet>
{:else if open}
  <div class="menu" role="menu" aria-label={title} bind:this={menu} style="left: {pos.x}px; top: {pos.y}px">
    {@render entries(items, false)}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: var(--z-dropdown);
    min-width: 240px;
    max-width: min(340px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 6px;
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
  }
  button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    background: var(--color-bg-subtle);
    outline: none;
  }
  button.danger {
    color: var(--color-error);
  }
  .label {
    flex: 1;
    min-width: 0;
    display: grid;
    overflow-wrap: anywhere;
  }
  .label small {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
  .check {
    width: 14px;
    display: grid;
    place-items: center;
    color: var(--color-accent);
  }
  .group {
    padding-left: 18px;
  }
  hr {
    border: none;
    border-top: 1px solid var(--color-border-hover);
    margin: 5px 4px;
  }
  .sheet-list {
    display: flex;
    flex-direction: column;
  }
  .sheet-title {
    margin: 0 0 var(--space-2);
    padding: 0 var(--space-3);
    color: var(--color-text-primary);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .sheet-list button {
    min-height: 48px;
    font-size: var(--text-base);
  }
</style>
