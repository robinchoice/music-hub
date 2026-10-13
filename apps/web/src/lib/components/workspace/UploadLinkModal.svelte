<script lang="ts">
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import { formatDate } from '$lib/utils/format.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';

  type Link = { token: string; createdAt: string; createdByName: string };

  let { open = $bindable(false), projectId }: { open: boolean; projectId: string } = $props();

  let link = $state<Link | null>(null);
  let loading = $state(true);
  let busy = $state(false);

  const url = $derived(link ? `${window.location.origin}/upload/${link.token}` : '');

  $effect(() => {
    if (!open) return;
    loading = true;
    api
      .get<{ link: Link | null }>(`/upload-links/project/${projectId}`)
      .then((res) => (link = res.link))
      .finally(() => (loading = false));
  });

  async function create() {
    busy = true;
    try {
      link = (await api.post<{ link: Link }>(`/upload-links/project/${projectId}`)).link;
    } finally {
      busy = false;
    }
  }

  async function renew() {
    if (!confirm('Neuen Link erzeugen? Der bisherige funktioniert dann nicht mehr.')) return;
    await create();
    toastSuccess('Neuer Link erstellt');
  }

  async function switchOff() {
    if (!confirm('Upload-Link ausschalten? Niemand kann darüber mehr Dateien schicken.')) return;
    await api.delete(`/upload-links/project/${projectId}`);
    link = null;
    toastSuccess('Upload-Link ausgeschaltet');
  }

  async function copy() {
    await navigator.clipboard.writeText(url);
    toastSuccess('Link kopiert');
  }
</script>

<Modal bind:open title="Upload-Link">
  <p class="intro">
    Wer diesen Link hat, kann ohne Konto Spuren in dieses Projekt laden: zu einem bestehenden Song oder als neuen Song. Die Dateien zählen zum Speicher der Person, die den Link erstellt hat.
  </p>
  {#if loading}
    <p class="muted">Lädt…</p>
  {:else if link}
    <div class="url-row">
      <input type="text" readonly value={url} onclick={(e) => (e.target as HTMLInputElement).select()} aria-label="Upload-Link" />
      <Button size="sm" onclick={copy}>Kopieren</Button>
    </div>
    <p class="muted">Erstellt von {link.createdByName} am {formatDate(link.createdAt)}</p>
  {:else}
    <Button onclick={create} loading={busy}>Link erstellen</Button>
  {/if}
  {#snippet actions()}
    {#if link}
      <Button variant="ghost" size="sm" onclick={renew} loading={busy}>Neuer Link</Button>
      <Button variant="danger" size="sm" onclick={switchOff}>Ausschalten</Button>
    {/if}
    <Button variant="secondary" size="sm" onclick={() => (open = false)}>Schließen</Button>
  {/snippet}
</Modal>

<style>
  .intro {
    margin: 0 0 var(--space-4);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .url-row {
    display: flex;
    gap: var(--space-2);
  }
  .url-row input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }
  .muted {
    margin: var(--space-2) 0 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
</style>
