<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import { timeAgo } from '$lib/utils/format.js';

  type ShareLink = {
    id: string;
    token: string;
    expiresAt: string | null;
    allowComments: boolean;
    allowDownload: boolean;
    hasPassword: boolean;
    createdAt: string;
  };

  let {
    open = $bindable(false),
    versionId,
  }: {
    open: boolean;
    versionId: string;
  } = $props();

  let tab = $state<'create' | 'manage'>('create');
  let allowComments = $state(true);
  let allowDownload = $state(false);
  let password = $state('');
  let creating = $state(false);
  let createdUrl = $state('');

  let links = $state<ShareLink[]>([]);
  let loadingLinks = $state(false);

  $effect(() => {
    if (open && tab === 'manage') loadLinks();
  });

  async function loadLinks() {
    loadingLinks = true;
    try {
      const res = await api.get<{ links: ShareLink[] }>(`/share/version/${versionId}`);
      links = res.links;
    } finally {
      loadingLinks = false;
    }
  }

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

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    toastSuccess('Link kopiert');
  }

  async function revoke(linkId: string) {
    if (!confirm('Diesen Link wirklich widerrufen? Niemand kann ihn dann mehr öffnen.')) return;
    await api.delete(`/share/${linkId}`);
    toastSuccess('Link widerrufen');
    await loadLinks();
  }

  function reset() {
    createdUrl = '';
    password = '';
  }

  function urlFor(token: string) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/listen/${token}`;
  }
</script>

<Modal bind:open title="Teilen">
  <div class="tabs">
    <button class:active={tab === 'create'} onclick={() => (tab = 'create')}>Neuer Link</button>
    <button class:active={tab === 'manage'} onclick={() => (tab = 'manage')}>Aktive Links</button>
  </div>

  {#if tab === 'create'}
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
        <Button size="sm" onclick={() => copy(createdUrl)}>Kopieren</Button>
      </div>
    {/if}
  {:else}
    {#if loadingLinks}
      <p class="muted">Lädt…</p>
    {:else if links.length === 0}
      <p class="muted">Keine aktiven Links für diese Version.</p>
    {:else}
      <ul class="link-list">
        {#each links as link}
          <li>
            <div class="link-meta">
              <span class="token">/listen/{link.token.slice(0, 12)}…</span>
              <div class="flags">
                {#if link.hasPassword}<span class="flag"><Icon name="lock" size={11} /> Passwort</span>{/if}
                {#if link.allowComments}<span class="flag">Kommentare</span>{/if}
                {#if link.allowDownload}<span class="flag">Download</span>{/if}
                <span class="flag age">erstellt {timeAgo(link.createdAt)}</span>
                {#if link.expiresAt}<span class="flag expire">läuft {timeAgo(link.expiresAt)}</span>{/if}
              </div>
            </div>
            <div class="link-actions">
              <button class="icon-btn" onclick={() => copy(urlFor(link.token))} title="Link kopieren" aria-label="Kopieren">
                <Icon name="link" size={14} />
              </button>
              <button class="icon-btn danger" onclick={() => revoke(link.id)} title="Widerrufen" aria-label="Widerrufen">
                <Icon name="x" size={14} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#snippet actions()}
    {#if tab === 'create'}
      {#if !createdUrl}
        <Button variant="ghost" onclick={() => (open = false)}>Abbrechen</Button>
        <Button loading={creating} onclick={create}>Link erzeugen</Button>
      {:else}
        <Button variant="ghost" onclick={reset}>Weiteren erzeugen</Button>
        <Button onclick={() => { open = false; reset(); }}>Fertig</Button>
      {/if}
    {:else}
      <Button onclick={() => (open = false)}>Schließen</Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .tabs {
    display: flex;
    gap: var(--space-1);
    margin-bottom: var(--space-5);
    border-bottom: 1px solid var(--color-border);
  }
  .tabs button {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-sm);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: all var(--transition-fast);
  }
  .tabs button:hover {
    color: var(--color-text-primary);
  }
  .tabs button.active {
    color: var(--color-text-primary);
    border-bottom-color: var(--color-accent);
  }

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

  .muted {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    text-align: center;
    padding: var(--space-4) 0;
  }

  .link-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .link-list li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .link-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .token {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .flag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 6px;
    border-radius: var(--radius-full);
    background: var(--color-bg-subtle);
    color: var(--color-text-tertiary);
    font-size: 10px;
    border: 1px solid var(--color-border);
  }
  .flag.expire {
    color: var(--color-warning);
    border-color: rgba(251, 191, 36, 0.3);
  }
  .link-actions {
    display: flex;
    gap: 4px;
  }
  .icon-btn {
    background: none;
    border: 1px solid var(--color-border);
    color: var(--color-text-tertiary);
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-fast);
  }
  .icon-btn:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-hover);
  }
  .icon-btn.danger:hover {
    color: var(--color-error);
    border-color: var(--color-error);
  }
</style>
