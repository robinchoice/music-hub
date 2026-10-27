<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { HANDLE_PATTERN, type RequestsFrom } from '@music-hub/shared';
  import { t } from '$lib/i18n/index.js';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';

  type Profile = { handle: string; visible: boolean; bio: string | null; links: string[]; requestsFrom: RequestsFrom; showStats: boolean };

  const REQUESTS: RequestsFrom[] = ['everyone', 'open', 'nobody'];

  let saved = $state<Profile | null>(null);
  let loaded = $state(false);
  let handle = $state('');
  let visible = $state(false);
  let bio = $state('');
  let links = $state(['', '', '']);
  let requestsFrom = $state<RequestsFrom>('open');
  let showStats = $state(true);
  let saving = $state(false);

  const handleOk = $derived(HANDLE_PATTERN.test(handle));
  const linksOk = $derived(links.every((l) => !l.trim() || /^https?:\/\/\S+\.\S+/.test(l.trim())));

  onMount(async () => {
    const res = await api.get<{ profile: Profile | null; suggestedHandle?: string }>('/profiles/me').catch(() => null);
    if (!res) return;
    if (res.profile) fill(res.profile);
    else handle = res.suggestedHandle ?? '';
    loaded = true;
    // "Profil bearbeiten" on the profile page links here; the anchor only exists once loaded
    await tick();
    if (location.hash === '#profil') document.getElementById('profil')?.scrollIntoView();
  });

  function fill(p: Profile) {
    saved = p;
    handle = p.handle;
    visible = p.visible;
    bio = p.bio ?? '';
    links = [...p.links, '', '', ''].slice(0, 3);
    requestsFrom = p.requestsFrom;
    showStats = p.showStats;
  }

  async function save() {
    saving = true;
    try {
      const res = await api.put<{ profile: Profile }>('/profiles/me', {
        handle,
        visible,
        bio: bio.trim() || null,
        links: links.map((l) => l.trim()).filter(Boolean),
        requestsFrom,
        showStats,
      });
      fill(res.profile);
      toastSuccess(visible ? t().guest.profileSettings.public : t().guest.profileSettings.saved);
    } catch {
      // The API client already showed the error
    } finally {
      saving = false;
    }
  }
</script>

<section class="card" id="profil">
  <h2>{t().guest.profileSettings.heading}</h2>
  {#if loaded}
    <label class="toggle">
      <input type="checkbox" bind:checked={visible} />
      <span>
        <b>{t().guest.profileSettings.show}</b>
        <small>{t().guest.profileSettings.showHint}</small>
      </span>
    </label>

    <label class="field">
      {t().guest.profileSettings.address}
      <span class="prefix"><span>{location.host}/@</span><input bind:value={handle} maxlength="30" autocapitalize="off" spellcheck="false" /></span>
      {#if !handleOk}<small class="error">{t().guest.profileSettings.handleRule}</small>{/if}
    </label>

    <label class="field">
      {t().guest.profileSettings.aboutYou}
      <input bind:value={bio} maxlength="200" placeholder={t().guest.profileSettings.aboutPlaceholder} />
    </label>

    <div class="field">
      {t().guest.profileSettings.links}
      {#each links as _, i (i)}
        <input bind:value={links[i]} type="url" placeholder="https://…" aria-label={t().guest.profileSettings.link(i + 1)} />
      {/each}
      {#if !linksOk}<small class="error">{t().guest.profileSettings.linksRule}</small>{/if}
    </div>

    <fieldset class="field">
      <legend>{t().guest.profileSettings.allowRequestsFrom}</legend>
      {#each REQUESTS as r (r)}
        <label class="choice"><input type="radio" bind:group={requestsFrom} value={r} /> {t().guest.profileSettings.requests[r]}</label>
      {/each}
      <small>{t().guest.profileSettings.requestsHint}</small>
    </fieldset>

    <label class="toggle">
      <input type="checkbox" bind:checked={showStats} />
      <span>
        <b>{t().guest.profileSettings.showNumbers}</b>
        <small>{t().guest.profileSettings.showNumbersHint}</small>
      </span>
    </label>

    <div class="row">
      <Button onclick={save} loading={saving} disabled={!handleOk || !linksOk}>{t().common.save}</Button>
      {#if saved?.visible}<a href="/@{saved.handle}">{t().guest.profileSettings.viewProfile}</a>{/if}
    </div>
  {/if}
</section>

<style>
  .card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    margin-top: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .toggle {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    cursor: pointer;
  }
  .toggle input,
  .choice input {
    accent-color: var(--color-accent);
    margin-top: 3px;
  }
  .toggle span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .toggle b {
    font-weight: 500;
    font-size: var(--text-sm);
  }
  small {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    line-height: 1.5;
  }
  .error {
    color: var(--color-error);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    border: 0;
    margin: 0;
    padding: 0;
  }
  legend {
    padding: 0;
    margin-bottom: var(--space-2);
  }
  .field input:not([type='radio']),
  .prefix {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }
  .prefix {
    display: flex;
    align-items: center;
  }
  .prefix span {
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
  .prefix input {
    flex: 1;
    min-width: 0;
    border: 0 !important;
    padding: 0 !important;
    background: none !important;
    outline: none;
  }
  .prefix:focus-within {
    border-color: var(--color-accent);
  }
  .choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .choice input {
    margin-top: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--text-sm);
  }
</style>
