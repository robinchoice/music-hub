<script lang="ts">
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
      if (openState.openedAt) toastSuccess(`${trackName} ist jetzt offen`);
    } finally {
      saving = false;
    }
  }

  const submit = () => run(() => api.post(`/tracks/${trackId}/open`, { license, confirmRights: true }));
  const consent = () => run(() => api.post(`/tracks/${trackId}/open/consent`));

  async function close() {
    if (!confirm(openState.openedAt ? `${trackName} schließen? Wer die Spuren schon geladen hat, darf sie behalten.` : 'Anfrage zurückziehen?')) return;
    await run(() => api.delete(`/tracks/${trackId}/open`));
    toastSuccess(openState.openedAt ? 'Geschlossen' : 'Zurückgezogen');
  }

  async function remind(id: string) {
    await api.post(`/tracks/${trackId}/open/remind/${id}`);
    reminded = new Set([...reminded, id]);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(publicUrl);
    toastSuccess('Link kopiert');
  }
</script>

<Modal bind:open title={openState.openedAt ? `${trackName} ist offen` : `${trackName} offen stellen`}>
  {#if openState.openedAt}
    <div class="body">
      <p class="muted">
        Seit {formatWhen(openState.openedAt)} dürfen alle den freigegebenen Mix und die Spuren laden und remixen,
        unter <a href={OPEN_LICENSE_INFO[openState.license!].url} target="_blank" rel="noopener">{OPEN_LICENSE_INFO[openState.license!].label}</a>.
        Neue Versionen und Spuren bleiben privat.
      </p>
      <div class="link-row">
        <a class="url" href={openPath(trackId)} target="_blank" rel="noopener">{publicUrl}</a>
        <Button size="sm" variant="secondary" onclick={copyLink}>Kopieren</Button>
      </div>
      {#if isOwner}
        <p class="hint">Schließen nimmt die Seite offline. Wer die Spuren schon geladen hat, darf sie behalten, so will es die Lizenz.</p>
      {/if}
    </div>
  {:else if !openState.versionId}
    <p class="muted">Offen stellen lässt sich der freigegebene Mix mit seinen Spuren. Gib zuerst eine Version frei.</p>
  {:else}
    <div class="body">
      <p class="muted">
        Die freigegebene Version und alle Spuren werden öffentlich und dürfen geremixt werden.
        {#if pending && requester}<b>{requester.name}</b> hat das angefragt.{/if}
      </p>

      {#if isOwner}
        <div class="q">
          <b>Muss ein Remix wieder offen sein?</b>
          <div class="opts">
            <button class="opt" class:on={license === 'cc-by-sa'} onclick={() => (license = 'cc-by-sa')} disabled={!openState.allowedLicenses.includes('cc-by-sa')}>
              Ja, weitergeben<small>Was daraus entsteht, bleibt offen</small>
            </button>
            <button class="opt" class:on={license === 'cc-by'} onclick={() => (license = 'cc-by')} disabled={!openState.allowedLicenses.includes('cc-by')}>
              Nein, frei<small>Auch geschlossene Releases erlaubt</small>
            </button>
          </div>
          {#if openState.allowedLicenses.includes('cc0')}
            <label class="check">
              <input type="checkbox" checked={license === 'cc0'} onchange={(e) => (license = e.currentTarget.checked ? 'cc0' : 'cc-by-sa')} />
              Auf Namensnennung verzichten (gemeinfrei)
            </label>
          {/if}
          {#if openState.allowedLicenses.length < 3}
            <p class="hint">Das Original dieses Remixes erlaubt nur diese Lizenzen.</p>
          {/if}
        </div>
      {/if}

      <div class="lic">
        <a class="badge" href={OPEN_LICENSE_INFO[license].url} target="_blank" rel="noopener">{OPEN_LICENSE_INFO[license].label}</a>
        <span class="muted">{OPEN_LICENSE_INFO[license].summary}</span>
      </div>

      {#if openState.contributors.length > 1 || pending}
        <div class="q">
          <b>Alle Beteiligten stimmen zu</b>
          {#each openState.contributors as p (p.id)}
            <div class="person">
              <Avatar src={p.avatarUrl} name={p.name} size="sm" />
              <span class="grow">{p.name}</span>
              <span class="hint">{p.stemCount === 1 ? '1 Spur' : `${p.stemCount} Spuren`}</span>
              {#if pending && p.consented && !changed}
                <span class="ok">✓ zugestimmt</span>
              {:else if pending && isOwner && !changed && p.id !== userId}
                <Button size="sm" variant="secondary" disabled={reminded.has(p.id)} onclick={() => remind(p.id)}>
                  {reminded.has(p.id) ? 'Erinnert' : 'Erinnern'}
                </Button>
              {:else}
                <span class="hint">{pending && !changed ? 'wartet' : ''}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if isOwner && (!pending || changed)}
        <label class="check">
          <input type="checkbox" bind:checked={confirmed} />
          Alles in diesen Spuren stammt von uns oder steht selbst unter einer freien Lizenz. Keine fremden Samples.
        </label>
      {:else if me && !me.consented}
        <p class="hint">Mit deiner Zustimmung bestätigst du, dass deine Spuren keine fremden Samples enthalten.</p>
      {/if}
      <p class="hint">Offen heißt dauerhaft: Wer die Spuren geladen hat, darf sie behalten, auch wenn ihr die Seite später schließt.</p>
    </div>
  {/if}

  {#snippet actions()}
    {#if openState.openedAt}
      {#if isOwner}<Button variant="ghost" onclick={close} loading={saving}>Seite schließen</Button>{/if}
      <Button href={openPath(trackId)}>Seite ansehen</Button>
    {:else if openState.versionId}
      {#if pending && isOwner && !changed}
        <Button variant="ghost" onclick={close} loading={saving}>Zurückziehen</Button>
      {/if}
      {#if isOwner && (!pending || changed)}
        <Button onclick={submit} loading={saving} disabled={!confirmed}>
          {openState.contributors.length > 1 ? 'Zustimmung einholen' : 'Offen stellen'}
        </Button>
      {:else if me && !me.consented}
        <Button onclick={consent} loading={saving}>Zustimmen</Button>
      {:else if pending}
        <Button disabled>{waiting.length === 1 ? `Wartet auf ${waiting[0].name}` : `Wartet auf ${waiting.length} Personen`}</Button>
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
