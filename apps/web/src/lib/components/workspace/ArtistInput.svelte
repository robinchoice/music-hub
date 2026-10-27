<script lang="ts">
  import { t } from '$lib/i18n/index.js';
  import Input from '$lib/components/ui/Input.svelte';
  import { overviewIndex } from '$lib/stores/overview.js';
  import { artistNames } from '$lib/utils/overview.js';

  let { value = $bindable('') }: { value?: string } = $props();

  let open = $state(false);
  let active = $state(-1);

  const names = $derived($overviewIndex ? artistNames($overviewIndex) : []);
  const typed = $derived(value.trim().toLowerCase());
  const match = $derived(names.find((n) => n.toLowerCase() === typed));
  // While typing only the artists that fit, a chosen one shows all to switch
  const shown = $derived(match || !typed ? names : names.filter((n) => n.toLowerCase().includes(typed)));

  function pick(name: string) {
    value = name;
    open = false;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open = true;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + shown.length) % shown.length;
    } else if (e.key === 'Enter' && open && shown[active]) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      open = false;
    }
  }
</script>

<div class="artist">
  <!-- Focus and keys come from the field inside -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="combo"
    onfocusin={() => (open = true)}
    onfocusout={() => (open = false)}
    oninput={() => ((open = true), (active = -1))}
    {onkeydown}
  >
    <Input label={t().workspace.artistInput.label} bind:value placeholder={t().workspace.artistInput.placeholder} autocomplete="off" />
    {#if open && shown.length}
      <ul role="listbox" aria-label={t().workspace.artistInput.existing}>
        {#each shown as name, i (name)}
          <!-- pointerdown keeps the focus in the field, the keyboard works through the field -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
          <li
            role="option"
            aria-selected={name === match}
            class:active={i === active}
            onpointerdown={(e) => e.preventDefault()}
            onclick={() => pick(name)}
          >
            {name}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  {#if typed && !match}
    <span class="hint">{t().workspace.artistInput.isNew}</span>
  {/if}
</div>

<style>
  .artist {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .combo {
    position: relative;
  }
  ul {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 5;
    margin: 0;
    padding: 4px;
    list-style: none;
    max-height: 240px;
    overflow-y: auto;
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }
  li {
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  li:hover,
  li.active {
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
  }
  li[aria-selected='true'] {
    color: var(--color-accent);
  }
  .hint {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
</style>
