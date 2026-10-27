<script lang="ts">
  import { locale, t } from '$lib/i18n/index.js';
  import { OPEN_LICENSE_INFO, type OpenLicense } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import { formatWhen } from '$lib/utils/format.js';
  import { openPath, type OpenState } from '$lib/utils/open.js';

  let {
    open = $bindable(false),
    openState = $bindable(),
    trackId,
    trackName,
    isOwner,
    userId,
  }: {
    open: boolean;
    openState: OpenState;
    trackId: string;
    trackName: string;
    isOwner: boolean;
    userId: string;
  } = $props();

  let license = $state<OpenLicense>('cc-by-sa');
  let confirmed = $state(false);
  let saving = $state(false);
  let reminded = $state(new Set<string>());

  const pending = $derived(!!openState.license && !openState.openedAt);
  const waiting = $derived(openState.contributors.filter((p) => !p.consented));
  const me = $derived(openState.contributors.find((p) => p.id === userId));
  const requester = $derived(openState.contributors.find((p) => p.id === openState.requestedById));
  // A pending request shows its own license; choosing another one starts over
  const changed = $derived(pending && license !== openState.license);
  const publicUrl = $derived(typeof location === 'undefined' ? openPath(trackId) : `${location.origin}${openPath(trackId)}`);

  $effect(() => {
    if (open) {
      license = openState.license ?? openState.allowedLicenses[0];
      confirmed = false;
    }
  });

  async function run(request: () => Promise<{ open: OpenState }>) {
    saving = true;
    try {
      openState = (await request()).open;
      if (openState.openedAt) toastSuccess(t().guest.openModal.nowOpen(trackName));
    } catch {
      // The API client already showed the error
    } finally {
      saving = false;
    }
  }

  const submit = () => run(() => api.post(`/tracks/${trackId}/open`, { license, confirmRights: true }));
  const consent = () => run(() => api.post(`/tracks/${trackId}/open/consent`));

  async function close() {
    if (!confirm(openState.openedAt ? t().guest.openModal.confirmCloseOpen(trackName) : t().guest.openModal.confirmWithdraw)) return;
    await run(() => api.delete(`/tracks/${trackId}/open`));
    toastSuccess(openState.openedAt ? t().guest.openModal.closed : t().guest.openModal.withdrawn);
  }

  async function remind(id: string) {
    await api.post(`/tracks/${trackId}/open/remind/${id}`);
    reminded = new Set([...reminded, id]);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(publicUrl);
    toastSuccess(t().guest.openModal.linkCopied);
  }
</script>

<Modal bind:open title={openState.openedAt ? t().guest.openModal.titleOpen(trackName) : t().guest.openModal.titleOpenUp(trackName)}>
  {#if openState.openedAt}
    <div class="body">
      <p class="muted">
        {t().guest.openModal.since(formatWhen(openState.openedAt))}
        <a href={OPEN_LICENSE_INFO[locale()][openState.license!].url} target="_blank" rel="noopener">{OPEN_LICENSE_INFO[locale()][openState.license!].label}</a>.
        {t().guest.openModal.newStaysPrivate}
      </p>
      <div class="link-row">
        <a class="url" href={openPath(trackId)} target="_blank" rel="noopener">{publicUrl}</a>
        <Button size="sm" variant="secondary" onclick={copyLink}>{t().common.copy}</Button>
      </div>
      {#if isOwner}
        <p class="hint">{t().guest.openModal.closeHint}</p>
      {/if}
    </div>
  {:else if !openState.versionId}
    <p class="muted">{t().guest.openModal.approveFirst}</p>
  {:else}
    <div class="body">
      <p class="muted">
        {t().guest.openModal.becomesPublic}
        {#if pending && requester}<b>{requester.name}</b> {t().guest.openModal.requestedBy}{/if}
      </p>

      {#if isOwner}
        <div class="q">
          <b>{t().guest.openModal.remixOpenQuestion}</b>
          <div class="opts">
            <button class="opt" class:on={license === 'cc-by-sa'} onclick={() => (license = 'cc-by-sa')} disabled={!openState.allowedLicenses.includes('cc-by-sa')}>
              {t().guest.openModal.yesPassOn}<small>{t().guest.openModal.yesPassOnHint}</small>
            </button>
            <button class="opt" class:on={license === 'cc-by'} onclick={() => (license = 'cc-by')} disabled={!openState.allowedLicenses.includes('cc-by')}>
              {t().guest.openModal.noFree}<small>{t().guest.openModal.noFreeHint}</small>
            </button>
          </div>
          {#if openState.allowedLicenses.includes('cc0')}
            <label class="check">
              <input type="checkbox" checked={license === 'cc0'} onchange={(e) => (license = e.currentTarget.checked ? 'cc0' : 'cc-by-sa')} />
              {t().guest.openModal.waiveCredit}
            </label>
          {/if}
          {#if openState.allowedLicenses.length < 3}
            <p class="hint">{t().guest.openModal.originalLimits}</p>
          {/if}
        </div>
      {/if}

      <div class="lic">
        <a class="badge" href={OPEN_LICENSE_INFO[locale()][license].url} target="_blank" rel="noopener">{OPEN_LICENSE_INFO[locale()][license].label}</a>
        <span class="muted">{OPEN_LICENSE_INFO[locale()][license].summary}</span>
      </div>

      {#if openState.contributors.length > 1 || pending}
        <div class="q">
          <b>{t().guest.openModal.allAgree}</b>
          {#each openState.contributors as p (p.id)}
            <div class="person">
              <Avatar src={p.avatarUrl} name={p.name} size="sm" />
              <span class="grow">{p.name}</span>
              <span class="hint">{t().common.stems(p.stemCount)}</span>
              {#if pending && p.consented && !changed}
                <span class="ok">{t().guest.openModal.consented}</span>
              {:else if pending && isOwner && !changed && p.id !== userId}
                <Button size="sm" variant="secondary" disabled={reminded.has(p.id)} onclick={() => remind(p.id)}>
                  {reminded.has(p.id) ? t().guest.openModal.reminded : t().guest.openModal.remind}
                </Button>
              {:else}
                <span class="hint">{pending && !changed ? t().guest.openModal.waits : ''}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if isOwner && (!pending || changed)}
        <label class="check">
          <input type="checkbox" bind:checked={confirmed} />
          {t().guest.openModal.confirmRights}
        </label>
      {:else if me && !me.consented}
        <p class="hint">{t().guest.openModal.consentHint}</p>
      {/if}
      <p class="hint">{t().guest.openModal.permanent}</p>
    </div>
  {/if}

  {#snippet actions()}
    {#if openState.openedAt}
      {#if isOwner}<Button variant="ghost" onclick={close} loading={saving}>{t().guest.openModal.closePage}</Button>{/if}
      <Button href={openPath(trackId)}>{t().guest.openModal.viewPage}</Button>
    {:else if openState.versionId}
      {#if pending && isOwner && !changed}
        <Button variant="ghost" onclick={close} loading={saving}>{t().guest.openModal.withdraw}</Button>
      {/if}
      {#if isOwner && (!pending || changed)}
        <Button onclick={submit} loading={saving} disabled={!confirmed}>
          {openState.contributors.length > 1 ? t().guest.openModal.askConsent : t().guest.openModal.openUp}
        </Button>
      {:else if me && !me.consented}
        <Button onclick={consent} loading={saving}>{t().guest.openModal.consent}</Button>
      {:else if pending}
        <Button disabled>{waiting.length === 1 ? t().guest.openModal.waitingFor(waiting[0].name) : t().guest.openModal.waitingForN(waiting.length)}</Button>
      {/if}
    {/if}
  {/snippet}
</Modal>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .muted {
    margin: 0;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  .muted b {
    color: var(--color-text-primary);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    line-height: 1.45;
  }
  .q {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .opts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .opt {
    text-align: left;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    font: inherit;
    line-height: 1.4;
    cursor: pointer;
  }
  .opt small {
    display: block;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }
  .opt.on {
    border-color: var(--color-accent);
    background: var(--color-accent-subtle);
  }
  .opt:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .check {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.45;
    cursor: pointer;
  }
  .check input {
    margin-top: 3px;
    accent-color: var(--color-accent);
  }
  .lic {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    font-size: var(--text-sm);
  }
  .badge {
    font-family: var(--font-display);
    font-stretch: 78%;
    font-weight: 800;
    font-size: 1.15rem;
    white-space: nowrap;
    color: var(--color-text-primary);
  }
  .person {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
  .grow {
    flex: 1;
  }
  .ok {
    font-size: var(--text-xs);
    color: var(--color-success);
  }
  .link-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
  }
  @media (max-width: 480px) {
    .opts {
      grid-template-columns: 1fr;
    }
  }
</style>
