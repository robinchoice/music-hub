<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import ListenTrack from '$lib/components/listen/ListenTrack.svelte';
  import PleasanceFooter from '$lib/components/PleasanceFooter.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Tile from '$lib/components/ui/Tile.svelte';
  import { formatTime } from '$lib/utils/format.js';

  type Album = {
    project: { name: string; artist: string | null; coverUrl: string | null };
    allowComments: boolean;
    tracks: {
      id: string;
      name: string;
      /** The track's own share link, which plays and takes the comments */
      token: string;
      coverUrl: string | null;
      version: { id: string; versionNumber: number; label: string | null; duration: number | null };
      comments: number;
    }[];
  };

  const token = ($page.params as Record<string, string>).token;
  let album = $state<Album | null>(null);
  let loading = $state(true);
  let error = $state('');
  let passwordRequired = $state(false);
  let password = $state('');
  let current = $state(0);
  // Playback starts on its own only after the guest pressed play once
  let playing = $state(false);

  const track = $derived(album?.tracks[current]);
  const total = $derived(album?.tracks.reduce((s, t) => s + (t.version.duration ?? 0), 0) ?? 0);

  async function load() {
    loading = !album;
    error = '';
    try {
      const res = await fetch(`/api/v1/share/project/public/${token}`, {
        headers: password ? { 'X-Share-Password': password } : {},
      });
      if (res.status === 401) {
        passwordRequired = true;
        error = password ? 'Das Passwort ist nicht richtig. Bitte versuche es erneut.' : '';
        return;
      }
      if (!res.ok) {
        error = res.status === 404 ? 'Dieser Link wurde nicht gefunden.'
          : res.status === 410 ? 'Dieser Link ist gerade nicht verfügbar.'
          : res.status === 429 ? 'Zu viele Versuche. Bitte warte etwas und versuche es erneut.'
          : 'Der Link konnte nicht geladen werden. Bitte versuche es erneut.';
        return;
      }
      album = await res.json();
      passwordRequired = false;
    } catch {
      error = 'Keine Verbindung. Bitte prüfe dein Internet und versuche es erneut.';
    } finally {
      loading = false;
    }
  }

  let listen = $state<ListenTrack>();

  function play(i: number) {
    if (i === current) listen?.play();
    current = i;
    playing = true;
  }

  onMount(load);
</script>

<svelte:head>
  <title>{album ? album.project.name : 'Music Hub'}</title>
</svelte:head>

<div class="shell">
  <div class="album-page">
    <a class="sender" href="/"><Tile size={26} /> Music Hub</a>

    {#if loading && !passwordRequired}
      <p class="muted">Lädt…</p>
    {:else if passwordRequired}
      <form class="password-gate" onsubmit={(e) => { e.preventDefault(); load(); }}>
        <h1>🔒 Geschützter Link</h1>
        <p>Bitte Passwort eingeben:</p>
        <input type="password" bind:value={password} placeholder="Passwort" aria-label="Passwort" autocomplete="current-password" required />
        <Button type="submit" {loading}>Öffnen</Button>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </form>
    {:else if error}
      <p class="error" role="alert">{error}</p>
      <Button onclick={load}>Erneut versuchen</Button>
    {:else if album}
      <header class="hero">
        <div class="cover"><CoverImage src={album.project.coverUrl} name={album.project.name} size="fill" rounded="lg" /></div>
        <div class="hero-text">
          <h1>{album.project.name}</h1>
          <p class="meta">
            {[album.project.artist, `${album.tracks.length} ${album.tracks.length === 1 ? 'Song' : 'Songs'}`, total ? formatTime(total) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {#if album.tracks.length > 0}
            <Button onclick={() => play(0)}><Icon name="play" size={14} /> Alles abspielen</Button>
          {/if}
        </div>
      </header>

      {#if album.tracks.length === 0}
        <p class="muted">Hier ist noch nichts zu hören.</p>
      {:else}
        <ol class="tracklist">
          {#each album.tracks as t, i (t.id)}
            <li>
              <button class="row" class:active={i === current} aria-current={i === current} onclick={() => play(i)}>
                <span class="n">{#if i === current}<Icon name="play" size={12} />{:else}{i + 1}{/if}</span>
                <CoverImage src={t.coverUrl ?? album.project.coverUrl} name={t.name} size="sm" rounded="sm" />
                <span class="name">
                  <b>{t.name}</b>
                  <small>V{t.version.versionNumber}{t.version.label ? ` · ${t.version.label}` : ''}</small>
                </span>
                {#if album.allowComments && t.comments > 0}
                  <span class="count" title="Kommentare"><Icon name="comment" size={12} /> {t.comments}</span>
                {/if}
                <span class="dur">{t.version.duration ? formatTime(t.version.duration) : ''}</span>
              </button>
            </li>
          {/each}
        </ol>

        {#if track}
          {#key track.token}
            <ListenTrack
              bind:this={listen}
              token={track.token}
              {password}
              inAlbum
              autoPlay={playing}
              previous={current > 0 ? () => play(current - 1) : undefined}
              next={current < album.tracks.length - 1 ? () => play(current + 1) : undefined}
            />
          {/key}
        {/if}
      {/if}
    {/if}
    <p class="legal"><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></p>
  </div>
  <PleasanceFooter />
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .album-page {
    flex: 1;
    width: 100%;
    max-width: 820px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  .sender {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    align-self: flex-start;
    color: var(--color-text-primary);
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    font-stretch: 76%;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .sender:hover { color: var(--color-text-primary); }

  .hero {
    display: flex;
    gap: var(--space-6);
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .cover {
    width: min(220px, 45vw);
    aspect-ratio: 1;
    flex: none;
  }
  .hero-text {
    flex: 1 1 16rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .hero h1 {
    margin: 0;
    font-size: clamp(2.75rem, 9vw, 4rem);
    font-weight: 800;
    font-stretch: 75%;
    line-height: 0.95;
  }
  .meta { margin: 0; color: var(--color-text-secondary); }

  .tracklist {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .tracklist li + li { border-top: 1px solid var(--color-border); }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover { background: var(--color-bg-raised); }
  .row.active { background: var(--color-accent-subtle); }
  .row.active b { color: var(--color-accent); }
  .n {
    width: 1.5rem;
    text-align: center;
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    flex: none;
  }
  .row.active .n { color: var(--color-accent); }
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name b {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name small { color: var(--color-text-tertiary); font-size: var(--text-xs); }
  .count, .dur {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }

  .password-gate {
    text-align: center;
    padding: var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: center;
  }
  .password-gate input {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    width: 100%;
  }
  .muted { color: var(--color-text-tertiary); font-size: var(--text-sm); }
  .error { color: var(--color-error); }
  .legal {
    margin: var(--space-4) 0 0;
    text-align: center;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .legal a { color: var(--color-text-tertiary); }
  .legal a:hover { color: var(--color-text-primary); }

  @media (max-width: 640px) {
    .hero { gap: var(--space-4); }
  }
</style>
