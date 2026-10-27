<script lang="ts">
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { api } from '$lib/api/client.js';
  import { t } from '$lib/i18n/index.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import { timeAgo } from '$lib/utils/format.js';
  import AnalyticsPanel from './AnalyticsPanel.svelte';
  import type { ShareFollows } from '@music-hub/shared';

  type ShareLink = {
    id: string;
    token: string;
    expiresAt: string | null;
    allowComments: boolean;
    allowDownload: boolean;
    hasPassword: boolean;
    /** Missing from an older API */
    follows?: ShareFollows;
    createdAt: string;
  };

  let {
    open = $bindable(false),
    versionId,
    versionNumber,
    hasApproved,
    canComment = true,
    canDownload = true,
  }: {
    open: boolean;
    versionId: string;
    versionNumber: number;
    /** Whether the track has an approved version a link could follow */
    hasApproved: boolean;
    /** A link grants at most what its creator may; the API clamps it the same way */
    canComment?: boolean;
    canDownload?: boolean;
  } = $props();

  let tab = $state<'create' | 'manage'>('create');
  let follows = $state<ShareFollows>('version');
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
          follows,
          allowComments: allowComments && canComment,
          allowDownload: allowDownload && canDownload,
          password: password || undefined,
        },
      );
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      createdUrl = `${origin}/listen/${res.link.token}`;
    } catch {
      // The API client already showed the error
    } finally {
      creating = false;
    }
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    toastSuccess(t().track.invite.linkCopied);
  }

  async function revoke(linkId: string) {
    if (!confirm(t().track.share.confirmRevoke)) return;
    await api.delete(`/share/${linkId}`);
    toastSuccess(t().track.share.revoked);
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

<Modal bind:open title={t().track.share.title}>
  <div class="tabs">
    <button class:active={tab === 'create'} onclick={() => (tab = 'create')}>{t().track.share.newLink}</button>
    <button class:active={tab === 'manage'} onclick={() => (tab = 'manage')}>{t().track.share.activeLinks}</button>
  </div>

  {#if tab === 'create'}
    {#if !createdUrl}
      <div class="form">
        <fieldset class="follows">
          <legend>{t().track.share.linkPlays}</legend>
          <label class="row">
            <input type="radio" bind:group={follows} value="version" />
            <span>{t().track.share.thisVersion(versionNumber)}</span>
          </label>
          <label class="row">
            <input type="radio" bind:group={follows} value="latest" />
            <span>{t().track.share.alwaysLatest}</span>
          </label>
          <label class="row">
            <input type="radio" bind:group={follows} value="approved" />
            <span>{t().track.share.alwaysApproved}</span>
          </label>
          {#if follows === 'latest'}
            <p class="hint">{t().track.share.latestHint}</p>
          {:else if follows === 'approved'}
            <p class="hint">
              {t().track.share.approvedHint}{#if !hasApproved}{' '}{t().track.share.approvedHintEmpty}{/if}
            </p>
          {/if}
        </fieldset>
        {#if canComment}
          <label class="row">
            <input type="checkbox" bind:checked={allowComments} />
            <span>{t().track.share.allowComments}</span>
          </label>
        {/if}
        {#if canDownload}
          <label class="row">
            <input type="checkbox" bind:checked={allowDownload} />
            <span>{t().track.share.allowDownload}</span>
          </label>
        {/if}
        <label class="field">
          <span>{t().track.share.passwordOptional}</span>
          <input type="text" bind:value={password} placeholder={t().track.share.passwordPlaceholder} />
        </label>
      </div>
    {:else}
      <div class="result">
        <p>{t().track.share.created}</p>
        <input type="text" readonly value={createdUrl} onclick={(e) => (e.target as HTMLInputElement).select()} />
        <Button size="sm" onclick={() => copy(createdUrl)}>{t().common.copy}</Button>
      </div>
    {/if}
  {:else}
    {#if loadingLinks}
      <p class="muted">{t().track.analytics.loading}</p>
    {:else if links.length === 0}
      <p class="muted">{t().track.share.noLinks}</p>
    {:else}
      <ul class="link-list">
        {#each links as link}
          <li>
            <div class="link-meta">
              <span class="token">/listen/{link.token.slice(0, 12)}…</span>
              <div class="flags">
                {#if link.follows && link.follows !== 'version'}<span class="flag">{t().track.share.followsFlag[link.follows]}</span>{/if}
                {#if link.hasPassword}<span class="flag"><Icon name="lock" size={11} /> {t().common.password}</span>{/if}
                {#if link.allowComments}<span class="flag">{t().track.share.comments}</span>{/if}
                {#if link.allowDownload}<span class="flag">{t().track.share.download}</span>{/if}
                <span class="flag age">{t().track.share.createdAgo(timeAgo(link.createdAt))}</span>
                {#if link.expiresAt}<span class="flag expire">{t().track.share.expiresAgo(timeAgo(link.expiresAt))}</span>{/if}
              </div>
            </div>
            <div class="link-actions">
              <button class="icon-btn" onclick={() => copy(urlFor(link.token))} title={t().track.invite.copyLink} aria-label={t().common.copy}>
                <Icon name="link" size={14} />
              </button>
              <button class="icon-btn danger" onclick={() => revoke(link.id)} title={t().track.share.revoke} aria-label={t().track.share.revoke}>
                <Icon name="x" size={14} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
    <section class="listeners">
      <h3>{t().track.share.listeners}</h3>
      <AnalyticsPanel {versionId} />
    </section>
  {/if}

  {#snippet actions()}
    {#if tab === 'create'}
      {#if !createdUrl}
        <Button variant="ghost" onclick={() => (open = false)}>{t().common.cancel}</Button>
        <Button loading={creating} onclick={create}>{t().track.share.generate}</Button>
      {:else}
        <Button variant="ghost" onclick={reset}>{t().track.share.generateAnother}</Button>
        <Button onclick={() => { open = false; reset(); }}>{t().track.share.done}</Button>
      {/if}
    {:else}
      <Button onclick={() => (open = false)}>{t().common.close}</Button>
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
    border-image: var(--gradient-accent) 1;
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
  .follows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0 0 var(--space-3);
    border: none;
    border-bottom: 1px solid var(--color-border);
  }
  .follows legend {
    padding: 0;
    margin-bottom: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
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
    color: var(--color-text-secondary);
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

  .listeners {
    margin-top: var(--space-5);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .listeners h3 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
  }
</style>
