<script lang="ts">
  import { tick } from 'svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { formatTime } from '$lib/utils/format.js';
  import type { ReviewVerdict } from '$lib/utils/track.js';

  let {
    open = $bindable(false),
    title = null,
    versionNumber,
    uploaderName,
    canApprove = false,
    guest = false,
    pass,
    onSubmit,
  }: {
    open: boolean;
    /** Defaults to "Fertig mit V4"; guests see no version numbers */
    title?: string | null;
    versionNumber: number;
    uploaderName: string;
    canApprove?: boolean;
    /** A guest on a share link: no approving, and the wording names no account */
    guest?: boolean;
    pass: { body: string; timestampSeconds: number | null }[];
    onSubmit: (verdict: ReviewVerdict, note: string) => Promise<void>;
  } = $props();

  let verdict = $state<ReviewVerdict | null>(null);
  let note = $state('');
  let sending = $state(false);
  let list = $state<HTMLElement>();
  const name = `verdict-${Math.random().toString(36).slice(2)}`;

  // Each opening starts over, with the focus on the first choice instead of the page behind
  $effect(() => {
    if (open) {
      verdict = null;
      note = '';
      void tick().then(() => list?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus());
    }
  });

  // Who may approve decides with "Freigeben" or "Änderungen nötig"; everyone else gives an opinion
  const options = $derived<{ value: ReviewVerdict; title: string; text: string; disabled?: boolean }[]>([
    canApprove
      ? { value: 'approve', title: 'Freigeben', text: `V${versionNumber} ist so fertig.` }
      : { value: 'approve', title: 'Freigeben', text: guest ? 'Freigeben können nur Projektmitglieder mit Freigaberecht.' : 'Nur mit Freigaberecht.', disabled: true },
    ...(canApprove ? [] : [{ value: 'fine' as const, title: 'Passt für mich', text: 'Von meiner Seite kann es so bleiben.' }]),
    {
      value: 'changes',
      title: 'Änderungen nötig',
      text: canApprove
        ? `V${versionNumber} gilt als abgelehnt, ${uploaderName} setzt die Anmerkungen um.`
        : `${uploaderName} soll die Anmerkungen umsetzen, bevor es weitergeht.`,
    },
    { value: 'notes', title: 'Nur Anmerkungen', text: 'Kein Urteil, nur Hinweise.' },
  ]);

  const summary = $derived(
    pass.length === 0
      ? 'Keine neuen Anmerkungen, dein Urteil reicht.'
      : `${pass.length === 1 ? 'Eine Anmerkung geht' : `${pass.length} Anmerkungen gehen`} gesammelt an ${uploaderName}.${guest ? ' Andere mit dem Link können sie schon lesen.' : ''}`,
  );

  async function send() {
    if (!verdict) return;
    sending = true;
    try {
      await onSubmit(verdict, note.trim());
      open = false;
    } catch {
      // The API client already showed the error
    } finally {
      sending = false;
    }
  }
</script>

<Modal bind:open title={title ?? `Fertig mit V${versionNumber}`}>
  <p class="sub">{summary}</p>
  {#if pass.length > 0}
    <ul class="pass">
      {#each pass as item}
        <li>
          {#if item.timestampSeconds !== null}<span class="ts">{formatTime(item.timestampSeconds)}</span>{/if}
          <span>{item.body}</span>
        </li>
      {/each}
    </ul>
  {/if}
  <fieldset class="verdicts" bind:this={list}>
    <legend class="sr-only">Urteil</legend>
    {#each options as option (option.value + option.title)}
      <label class="verdict" class:on={verdict === option.value && !option.disabled} class:disabled={option.disabled}>
        <input type="radio" {name} value={option.value} bind:group={verdict} disabled={option.disabled} />
        <span class="dot" aria-hidden="true"></span>
        <span><b>{option.title}</b><small>{option.text}</small></span>
      </label>
    {/each}
  </fieldset>
  <textarea bind:value={note} rows="3" maxlength="2000" placeholder="Gesamteindruck (optional)" aria-label="Gesamteindruck"></textarea>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (open = false)}>Weiter hören</Button>
    <Button onclick={send} loading={sending} disabled={!verdict}>Abschicken</Button>
  {/snippet}
</Modal>

<style>
  .sub {
    margin: 0 0 var(--space-3);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .pass {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    max-height: 132px;
    overflow: auto;
    background: var(--color-bg-raised);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .pass li {
    display: flex;
    gap: var(--space-2);
    padding: 2px 0;
  }

  .ts {
    font-variant-numeric: tabular-nums;
    color: var(--color-accent);
  }

  .verdicts {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
  }

  .sr-only,
  .verdict input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .verdict {
    position: relative;
    display: grid;
    grid-template-columns: 20px 1fr;
    gap: var(--space-3);
    padding: var(--space-3);
    text-align: left;
    font: inherit;
    color: inherit;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .verdict:hover:not(.disabled) {
    border-color: var(--color-text-tertiary);
  }

  .verdict:has(input:focus-visible) {
    outline: 2px solid var(--color-border-focus, var(--color-accent));
    outline-offset: 2px;
  }

  .verdict.on {
    border-color: var(--color-accent);
    background: var(--color-accent-subtle);
  }

  .verdict.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .verdict b {
    display: block;
    font-weight: 600;
  }

  .verdict small {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }

  .dot {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    border-radius: 50%;
    border: 2px solid var(--color-border-hover);
  }

  .verdict.on .dot {
    border: 5px solid var(--color-accent);
  }

  textarea {
    width: 100%;
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    color: var(--color-text-primary);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    resize: vertical;
  }
</style>
