<script lang="ts">
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
  type Contact = 'login' | 'self' | 'allowed' | 'sent' | 'needs-open' | 'closed';
  type Profile = {
    profile: { handle: string; name: string; avatarUrl: string | null; bio: string | null; links: string[]; artists: string[] };
    stats: { tracks: number; stars: number; remixes: number; downloads: number } | null;
    tracks: Track[];
    contact: Contact;
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
      error = (await res?.json().catch(() => null))?.error ?? 'Dieses Profil gibt es nicht.';
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
      toastSuccess(`Anfrage an ${data!.profile.name} geschickt`);
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
  <title>{data ? `${data.profile.name} — Offene Musik` : 'Offene Musik — Music Hub'}</title>
</svelte:head>

<div class="shell">
  <div class="page">
    <OpenHeader />

    {#if error}
      <div class="gone">
        <p>{error}</p>
        <Button variant="secondary" href="/offen">Offene Musik entdecken</Button>
      </div>
    {:else if data}
      {@const p = data.profile}
      <section class="hero">
        <Avatar src={p.avatarUrl} name={p.name} size="xl" />
        <div class="who">
          <h1>{p.name}</h1>
          {#if p.bio || p.artists.length}
            <p class="bio">
              {p.bio ?? ''}{p.bio && p.artists.length ? ' · ' : ''}{#if p.artists.length}spielt in {#each p.artists as a, i (a)}{i ? (i === p.artists.length - 1 ? ' und ' : ', ') : ''}<b>{a}</b>{/each}{/if}
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
            <Button variant="secondary" href="/account#profil"><Icon name="edit" size={14} /> Profil bearbeiten</Button>
          {:else if data.contact === 'sent'}
            <Button variant="secondary" disabled><Icon name="check" size={14} /> Anfrage geschickt</Button>
          {:else if data.contact === 'needs-open'}
            <Button variant="secondary" disabled>Anfrage schicken</Button>
            <p class="hint">{p.name} nimmt Anfragen von Leuten mit eigenem offenen Track an.</p>
          {:else if data.contact !== 'closed'}
            <Button onclick={startRequest}><Icon name="mail" size={14} /> Anfrage schicken</Button>
          {/if}
        </div>
      </section>

      {#if data.stats}
        <dl class="stats">
          <div><dt>offene Tracks</dt><dd>{data.stats.tracks}</dd></div>
          <div><dt>Stars</dt><dd>{data.stats.stars}</dd></div>
          <div><dt>Remixe von anderen</dt><dd>{data.stats.remixes}</dd></div>
          <div><dt>Downloads</dt><dd>{data.stats.downloads}</dd></div>
        </dl>
      {/if}

      {#if data.tracks.length}
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'own'} class:on={tab === 'own'} onclick={() => (tab = 'own')}>Offene Tracks <span>{own.length}</span></button>
          <button role="tab" aria-selected={tab === 'remixes'} class:on={tab === 'remixes'} onclick={() => (tab = 'remixes')}>Remixe von {p.name} <span>{remixes.length}</span></button>
        </div>
        <ul class="rows">
          {#each shown as t (t.id)}
            <li>
              <a class="row" href="/offen/{t.id}">
                <CoverImage src={t.coverUrl} name={t.name} size="sm" rounded="md" />
                <span class="grow">
                  <b>{t.name}</b>
                  <span class="faint">{t.artistOrProject} · {OPEN_LICENSE_INFO[t.license].label} · {t.stemCount === 1 ? '1 Spur' : `${t.stemCount} Spuren`}</span>
                </span>
                {#if t.remixCount}<span class="faint remixes">{t.remixCount === 1 ? '1 Remix' : `${t.remixCount} Remixe`}</span>{/if}
              </a>
              <button class="star" class:on={t.starred} onclick={() => toggleStar(t)} aria-pressed={t.starred} title={t.starred ? 'Stern zurücknehmen' : 'Stern geben'}>
                <Icon name="star" size={13} /> {t.stars}
              </button>
            </li>
          {:else}
            <li class="faint empty">Hier ist noch nichts offen.</li>
          {/each}
        </ul>
      {:else}
        <p class="faint empty">{p.name} hat noch keinen Track offen gestellt.</p>
      {/if}
    {/if}
    <p class="legal"><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></p>
  </div>
  <PleasanceFooter />
</div>

{#if data}
  <Modal bind:open={requestOpen} title="Anfrage an {data.profile.name}">
    <div class="form">
      {#if data.tracks.length}
        <label>
          Worum geht es?
          <select bind:value={about}>
            <option value="">Allgemein</option>
            {#each data.tracks as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label>
        Deine Nachricht
        <textarea bind:value={message} rows="5" maxlength={MAX_REQUEST_LENGTH} placeholder="Wer bist du, und was möchtest du zusammen machen?"></textarea>
        <span class="counter">{message.length} / {MAX_REQUEST_LENGTH}</span>
      </label>
      <p class="faint">{data.profile.name} sieht deinen Namen, dein Profil und diese Nachricht. Weiter schreibt ihr erst, wenn {data.profile.name} annimmt: Dann landet ihr in einem gemeinsamen Projekt.</p>
    </div>
    {#snippet actions()}
      <Button variant="ghost" onclick={() => (requestOpen = false)}>Abbrechen</Button>
      <Button onclick={send} loading={sending} disabled={!message.trim()}>Schicken</Button>
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
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    text-align: right;
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
    .hint {
      text-align: left;
    }
    .remixes {
      display: none;
    }
  }
</style>
