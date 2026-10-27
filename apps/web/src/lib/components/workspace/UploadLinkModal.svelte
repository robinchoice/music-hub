<script lang="ts">
  import { t } from '$lib/i18n/index.js';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import { formatDate } from '$lib/utils/format.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';

  type Link = { token: string; createdAt: string; createdByName: string; paused: boolean };

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
    if (!confirm(t().workspace.uploadLink.confirmRenew)) return;
    await create();
    toastSuccess(t().workspace.uploadLink.renewed);
  }

  async function switchOff() {
    if (!confirm(t().workspace.uploadLink.confirmSwitchOff)) return;
    await api.delete(`/upload-links/project/${projectId}`);
    link = null;
    toastSuccess(t().workspace.uploadLink.switchedOff);
  }

  async function copy() {
    await navigator.clipboard.writeText(url);
    toastSuccess(t().workspace.uploadLink.copied);
  }
</script>

<Modal bind:open title={t().workspace.uploadLink.title}>
  <p class="intro">
    {t().workspace.uploadLink.introBefore} <a href="/account#gaeste">{t().workspace.uploadLink.introLink}</a>{t().workspace.uploadLink.introAfter}
  </p>
  {#if loading}
    <p class="muted">{t().workspace.loading}</p>
  {:else if link}
    <div class="url-row">
      <input type="text" readonly value={url} onclick={(e) => (e.target as HTMLInputElement).select()} aria-label={t().workspace.uploadLink.title} />
      <Button size="sm" onclick={copy}>{t().common.copy}</Button>
    </div>
    <p class="muted">{t().workspace.uploadLink.createdBy(link.createdByName, formatDate(link.createdAt))}</p>
    {#if link.paused}
      <p class="paused">{t().workspace.uploadLink.paused(link.createdByName)}</p>
    {/if}
  {:else}
    <Button onclick={create} loading={busy}>{t().workspace.uploadLink.create}</Button>
  {/if}
  {#snippet actions()}
    {#if link}
      <Button variant="ghost" size="sm" onclick={renew} loading={busy}>{t().workspace.uploadLink.renew}</Button>
      <Button variant="danger" size="sm" onclick={switchOff}>{t().workspace.uploadLink.switchOff}</Button>
    {/if}
    <Button variant="secondary" size="sm" onclick={() => (open = false)}>{t().common.close}</Button>
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
  .paused {
    margin: var(--space-3) 0 0;
    color: var(--color-warning);
    font-size: var(--text-sm);
  }
  .muted {
    margin: var(--space-2) 0 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
</style>
