<script lang="ts">
  import { locale, t } from '$lib/i18n/index.js';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { MAX_REQUEST_LENGTH, OPEN_LICENSE_INFO, type OpenLicense } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { user, authLoading, checkAuth } from '$lib/stores/auth.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import PleasanceFooter from '$lib/components/PleasanceFooter.svelte';
  import OpenHeader from '$lib/components/open/OpenHeader.svelte';
  import PushPrompt from '$lib/components/PushPrompt.svelte';

  type Track = {
    id: string;
    name: string;
    forkedFromId: string | null;
    license: OpenLicense;
    artistOrProject: string;
    stemCount: number;
    remixCount: number;
    stars: number;
    starred: boolean;
    coverUrl: string | null;
  };
  type Contact = 'login' | 'self' | 'allowed' | 'connected' | 'sent' | 'needs-open' | 'closed';
  type Profile = {
    profile: { handle: string; name: string; avatarUrl: string | null; bio: string | null; links: string[]; artists: string[] };
    stats: { tracks: number; stars: number; remixes: number; downloads: number } | null;
    tracks: Track[];
    contact: Contact;
    sharedProjectId: string | null;
  };

  const handle = ($page.params as Record<string, string>).handle.slice(1);
  let data = $state<Profile | null>(null);
  let error = $state('');
  let tab = $state<'own' | 'remixes'>('own');

  let requestOpen = $state(false);
  let message = $state('');
  let about = $state('');
  let sending = $state(false);

  const own = $derived(data?.tracks.filter((t) => !t.forkedFromId) ?? []);
  const remixes = $derived(data?.tracks.filter((t) => t.forkedFromId) ?? []);
  const shown = $derived(tab === 'own' ? own : remixes);

  async function load() {
    const res = await fetch(`/api/v1/profiles/${handle}`).catch(() => null);
    if (!res?.ok) {
      error = (await res?.json().catch(() => null))?.error ?? t().guest.profile.notFound;
      return;
    }
    data = await res.json();
    if (!own.length && remixes.length) tab = 'remixes';
  }

  onMount(async () => {
    await load();
    // Back from logging in to send a request
    if ($page.url.searchParams.has('anfrage') && data?.contact === 'allowed') requestOpen = true;
  });

  // Shows a link without the protocol: "https://diespaetzles.lol/" → "diespaetzles.lol"
  const linkLabel = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

  async function startRequest() {
    if ($authLoading) await checkAuth();
    if (!$user) return goto(`/login?next=${encodeURIComponent(`/@${handle}?anfrage=1`)}`);
    requestOpen = true;
  }

  async function send() {
    sending = true;
    try {
      await api.post(`/profiles/${handle}/requests`, { message: message.trim(), trackId: about || null });
      requestOpen = false;
      message = '';
      data!.contact = 'sent';
      toastSuccess(t().guest.profile.requestSent(data!.profile.name));
    } catch {
      // The API client already showed the error
    } finally {
      sending = false;
    }
  }

  async function toggleStar(t: Track) {
    if ($authLoading) await checkAuth();
    if (!$user) return goto(`/login?next=${encodeURIComponent(`/@${handle}`)}`);
    const on = !t.starred;
    t.starred = on;
    t.stars += on ? 1 : -1;
    try {
      await (on ? api.put(`/open/${t.id}/star`) : api.delete(`/open/${t.id}/star`));
    } catch {
      t.starred = !on;
      t.stars += on ? -1 : 1;
    }
  }
</script>

<svelte:head>
  <title>{data ? `${data.profile.name} — ${t().guest.openHeader.openMusic}` : t().guest.openList.title}</title>
</svelte:head>

<div class="shell">
  <div class="page">
    <OpenHeader />

    {#if error}
      <div class="gone">
        <p>{error}</p>
        <Button variant="secondary" href="/offen">{t().guest.openTrack.discover}</Button>
      </div>
    {:else if data}
      {@const p = data.profile}
      <section class="hero">
        <Avatar src={p.avatarUrl} name={p.name} size="xl" />
        <div class="who">
          <h1>{p.name}</h1>
          {#if p.bio || p.artists.length}
            <p class="bio">
              {p.bio ?? ''}{p.bio && p.artists.length ? ' · ' : ''}{#if p.artists.length}{t().guest.profile.playsIn} {#each p.artists as a, i (a)}{i ? (i === p.artists.length - 1 ? ` ${t().guest.profile.and} ` : ', ') : ''}<b>{a}</b>{/each}{/if}
            </p>
          {/if}
          {#if p.links.length}
            <div class="links">
              {#each p.links as l (l)}<a class="chip" href={l} target="_blank" rel="noopener nofollow ugc">{linkLabel(l)}</a>{/each}
            </div>
          {/if}
        </div>
        <div class="cta">
          {#if data.contact === 'self'}
            <Button variant="secondary" href="/account#profil"><Icon name="edit" size={14} /> {t().guest.profile.editProfile}</Button>
          {:else if data.contact === 'connected'}
            <Button variant="secondary" href="/projects/{data.sharedProjectId}">{t().guest.profile.openSharedProject}</Button>
          {:else if data.contact === 'sent'}
            <Button variant="secondary" disabled><Icon name="check" size={14} /> {t().guest.profile.requestSentButton}</Button>
          {:else if data.contact === 'needs-open'}
            <Button variant="secondary" disabled>{t().guest.profile.sendRequest}</Button>
          {:else if data.contact !== 'closed'}
            <Button onclick={startRequest}><Icon name="mail" size={14} /> {t().guest.profile.sendRequest}</Button>
          {/if}
        </div>
      </section>

      {#if data.contact === 'sent'}
        <PushPrompt text={t().guest.profile.pushText(p.name)} />
      {/if}

      {#if data.contact === 'needs-open'}
        <p class="note">
          {t().guest.profile.needsOpen(p.name)}
          <a href="/dashboard">{t().guest.profile.toProjects}</a>
        </p>
      {:else if data.contact === 'closed'}
        <p class="note">{t().guest.profile.closed(p.name)}</p>
      {/if}

      {#if data.stats}
        <dl class="stats">
          <div><dt>{data.stats.tracks === 1 ? t().guest.profile.openTrackOne : t().guest.profile.openTrackMany}</dt><dd>{data.stats.tracks}</dd></div>
          <div><dt>{t().guest.profile.stars}</dt><dd>{data.stats.stars}</dd></div>
          <div><dt>{t().guest.profile.remixesByOthers}</dt><dd>{data.stats.remixes}</dd></div>
          <div><dt>{t().guest.profile.downloads}</dt><dd>{data.stats.downloads}</dd></div>
        </dl>
      {/if}

      {#if data.tracks.length}
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'own'} class:on={tab === 'own'} onclick={() => (tab = 'own')}>{t().guest.profile.tabOpenTracks} <span>{own.length}</span></button>
          <button role="tab" aria-selected={tab === 'remixes'} class:on={tab === 'remixes'} onclick={() => (tab = 'remixes')}>{t().guest.profile.tabRemixes(p.name)} <span>{remixes.length}</span></button>
        </div>
        <ul class="rows">
          {#each shown as tr (tr.id)}
            <li>
              <a class="row" href="/offen/{tr.id}">
                <CoverImage src={tr.coverUrl} name={tr.name} size="sm" rounded="md" />
                <span class="grow">
                  <b>{tr.name}</b>
                  <span class="faint">{tr.artistOrProject} · {OPEN_LICENSE_INFO[locale()][tr.license].label} · {t().common.stems(tr.stemCount)}</span>
                </span>
                {#if tr.remixCount}<span class="faint remixes">{t().guest.openList.remixes(tr.remixCount)}</span>{/if}
              </a>
              <button class="star" class:on={tr.starred} onclick={() => toggleStar(tr)} aria-pressed={tr.starred} title={tr.starred ? t().guest.profile.unstar : t().guest.profile.star}>
                <Icon name="star" size={13} /> {tr.stars}
              </button>
            </li>
          {:else}
            <li class="faint empty">{tab === 'own' ? t().guest.profile.noOwnOpen : t().guest.profile.noRemixOpen}</li>
          {/each}
        </ul>
      {:else}
        <p class="faint empty">{t().guest.profile.noneOpen(p.name)}</p>
      {/if}
    {/if}
    <p class="legal"><a href="/impressum">{t().common.imprint}</a> · <a href="/datenschutz">{t().common.privacy}</a></p>
  </div>
  <PleasanceFooter />
</div>

{#if data}
  <Modal bind:open={requestOpen} title={t().guest.profile.requestTo(data.profile.name)}>
    <div class="form">
      {#if data.tracks.length}
        <label>
          {t().guest.profile.about}
          <select bind:value={about}>
            <option value="">{t().guest.profile.general}</option>
            {#each data.tracks as tr (tr.id)}<option value={tr.id}>{tr.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label>
        {t().guest.profile.yourMessage}
        <textarea bind:value={message} rows="5" maxlength={MAX_REQUEST_LENGTH} placeholder={t().guest.profile.messagePlaceholder}></textarea>
        <span class="counter">{message.length} / {MAX_REQUEST_LENGTH}</span>
      </label>
      <p class="faint">{t().guest.profile.requestInfo(data.profile.name)}</p>
    </div>
    {#snippet actions()}
      <Button variant="ghost" onclick={() => (requestOpen = false)}>{t().common.cancel}</Button>
      <Button onclick={send} loading={sending} disabled={!message.trim()}>{t().guest.profile.send}</Button>
    {/snippet}
  </Modal>
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .page {
    flex: 1;
    width: 100%;
    max-width: 980px;
    margin: 0 auto;
    padding: 0 var(--space-10) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  .gone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-16) 0;
    color: var(--color-text-secondary);
  }
  .hero {
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 8vw, 3.6rem);
    font-weight: 800;
    font-stretch: 75%;
    line-height: 0.95;
    overflow-wrap: anywhere;
  }
  .bio {
    margin: 0;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  .bio b {
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    padding: 2px 10px;
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    text-decoration: none;
  }
  .chip:hover {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  .cta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
    max-width: 240px;
  }
  .note {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border: 1px dashed var(--color-border-hover);
    border-radius: var(--radius-lg);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  .note a {
    color: var(--color-text-primary);
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
    margin: 0;
  }
  .stats div {
    display: flex;
    flex-direction: column-reverse;
  }
  .stats dd {
    margin: 0;
    color: var(--color-text-primary);
    font-family: var(--font-display);
    font-size: 1.75rem;
    font-weight: 800;
    font-stretch: 75%;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .stats dt {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .tabs {
    display: flex;
    gap: var(--space-5);
    border-bottom: 1px solid var(--color-border);
  }
  .tabs button {
    padding: var(--space-2) 0;
    border: 0;
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .tabs button span {
    color: var(--color-text-tertiary);
  }
  .tabs button.on {
    color: var(--color-text-primary);
    box-shadow: inset 0 -2px 0 var(--color-accent);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
  }
  .rows li.empty {
    background: none;
    border: 0;
    padding: 0;
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: inherit;
    text-decoration: none;
  }
  .row:hover b {
    color: var(--color-accent);
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .grow b {
    font-weight: 600;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .faint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    line-height: 1.5;
  }
  .remixes {
    white-space: nowrap;
  }
  .star {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-hover);
    background: none;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .star:hover {
    border-color: var(--color-accent);
  }
  .star.on {
    color: var(--color-accent);
    border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
    background: var(--color-accent-subtle);
  }
  .star.on :global(svg) {
    fill: currentColor;
  }
  .legal {
    margin: 0;
    text-align: center;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .legal a {
    color: var(--color-text-tertiary);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .form label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .form select,
  .form textarea {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }
  .counter {
    align-self: flex-end;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  @media (max-width: 720px) {
    .page {
      padding: 0 var(--space-5) var(--space-6);
    }
    .hero {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-4);
    }
    .cta {
      align-items: flex-start;
      max-width: none;
    }
    .remixes {
      display: none;
    }
    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
