<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';

  let {
    open = $bindable(false),
    versionId,
  }: {
    open: boolean;
    versionId: string;
  } = $props();

  let allowComments = $state(true);
  let allowDownload = $state(false);
  let password = $state('');
  let creating = $state(false);
  let createdUrl = $state('');

  async function create() {
    creating = true;
    try {
      const res = await api.post<{ link: { token: string } }>(
        `/share/version/${versionId}`,
        {
          allowComments,
          allowDownload,
          password: password || undefined,
        },
      );
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      createdUrl = `${origin}/listen/${res.link.token}`;
    } finally {
      creating = false;
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(createdUrl);
    toastSuccess('Link kopiert');
  }

  function reset() {
    createdUrl = '';
    password = '';
  }
</script>

<Modal bind:open title="Link teilen">
  {#if !createdUrl}
    <div class="form">
      <label class="row">
        <input type="checkbox" bind:checked={allowComments} />
        <span>Kommentare erlauben (auch ohne Account)</span>
      </label>
      <label class="row">
        <input type="checkbox" bind:checked={allowDownload} />
        <span>Download des Originals erlauben</span>
      </label>
      <label class="field">
        <span>Passwort (optional)</span>
        <input type="text" bind:value={password} placeholder="leer = kein Passwort" />
      </label>
    </div>
  {:else}
    <div class="result">
      <p>Link erstellt:</p>
      <input type="text" readonly value={createdUrl} onclick={(e) => (e.target as HTMLInputElement).select()} />
      <Button size="sm" onclick={copy}>Kopieren</Button>
    </div>
  {/if}

  {#snippet actions()}
    {#if !createdUrl}
      <Button variant="ghost" onclick={() => (open = false)}>Abbrechen</Button>
      <Button loading={creating} onclick={create}>Link erzeugen</Button>
    {:else}
      <Button variant="ghost" onclick={reset}>Weiteren erzeugen</Button>
      <Button onclick={() => { open = false; reset(); }}>Fertig</Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .field input,
  .result input {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    width: 100%;
  }
  .result {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .result p {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
</style>
