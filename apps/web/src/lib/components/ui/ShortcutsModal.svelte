<script lang="ts">
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import { t } from '$lib/i18n/index.js';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const groups = $derived<{ title: string; rows: [string, string][] }[]>([
    {
      title: t().track.shortcuts.general,
      rows: [
        ['/', t().track.shortcuts.focusSearch],
        ['?', t().track.shortcuts.openOverview],
        ['Esc', t().track.shortcuts.closeCancel],
      ],
    },
    {
      title: t().track.shortcuts.player,
      rows: [
        ['Space', t().track.shortcuts.playPause],
        ['K', t().track.shortcuts.playPause],
        ['J', t().track.shortcuts.back10],
        ['L', t().track.shortcuts.forward10],
        ['C', t().track.shortcuts.commentHere],
        ['←  →', t().track.shortcuts.prevNext],
      ],
    },
  ]);
</script>

<Modal bind:open title={t().track.shortcuts.title}>
  <div class="shortcuts">
    {#each groups as group}
      <div class="group">
        <h3>{group.title}</h3>
        <table>
          <tbody>
            {#each group.rows as [keys, label]}
              <tr>
                <td><kbd>{keys}</kbd></td>
                <td>{label}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/each}
  </div>
  {#snippet actions()}
    <Button onclick={() => (open = false)}>{t().common.close}</Button>
  {/snippet}
</Modal>

<style>
  .shortcuts {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .group h3 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-tertiary);
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    padding: var(--space-2) 0;
    font-size: var(--text-sm);
  }
  td:first-child {
    width: 100px;
  }
  td:last-child {
    color: var(--color-text-secondary);
  }
  kbd {
    display: inline-block;
    padding: 2px 8px;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border-hover);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1;
  }
</style>
