<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/index.js';
  import { api } from '$lib/api/client.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Tile from '$lib/components/ui/Tile.svelte';
  import PleasanceFooter from '$lib/components/PleasanceFooter.svelte';
  import StemUploadDropzone from '$lib/components/audio/StemUploadDropzone.svelte';

  type Track = { id: string; name: string };
  type LinkData = { project: { name: string; artist: string | null }; invitedBy: string; tracks: Track[] };

  const token = ($page.params as Record<string, string>).token;
  const base = `/upload-links/public/${token}`;

  let data = $state<LinkData | null>(null);
  let loading = $state(true);
  let error = $state('');

  let guestName = $state('');
  let songName = $state('');
  let note = $state('');
  let target = $state<Track | null>(null);
  let starting = $state(false);
  // While files go up the song stays, so they are reported for the right one
  let uploading = $state(false);
  // Songs that got files in this visit
  let sent = $state<string[]>([]);

  // An existing song with that name gets the files, otherwise a new one is created
  const existing = $derived(data?.tracks.find((track) => track.name.trim().toLowerCase() === songName.trim().toLowerCase()) ?? null);

  onMount(async () => {
    guestName = localStorage.getItem('listenName') ?? '';
    try {
      data = await api.get<LinkData>(base, true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  });

  async function start(e: Event) {
    e.preventDefault();
    if (!guestName.trim() || !songName.trim()) return;
    localStorage.setItem('listenName', guestName.trim());
    starting = true;
    try {
      let track = existing;
      if (!track) {
        track = (await api.post<{ track: Track }>(`${base}/tracks`, { name: songName.trim() })).track;
        data!.tracks = [...data!.tracks, track];
      }
      if (note.trim()) {
        await api.post(`${base}/track/${track.id}/note`, { guestName: guestName.trim(), body: note.trim() });
        note = '';
      }
      target = track;
    } finally {
      starting = false;
    }
  }

  function uploaded() {
    if (target && !sent.includes(target.name)) sent = [...sent, target.name];
  }

  function otherSong() {
    target = null;
    songName = '';
  }
</script>

<svelte:head>
  <title>{data ? t().guest.upload.title(data.project.name) : 'Music Hub'}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="shell">
  <div class="upload-page">
    <a class="sender" href="/"><Tile size={26} /> Music Hub</a>

    {#if loading}
      <p class="muted">{t().guest.listenTrack.loading}</p>
    {:else if error || !data}
      <div class="gone">
        <h1>{t().guest.upload.unavailable}</h1>
        <p class="muted">{error || t().guest.upload.noLongerValid} {t().guest.upload.askForNew}</p>
      </div>
    {:else}
      <header>
        <p class="project">{data.project.artist ? `${data.project.artist} · ` : ''}{data.project.name}</p>
        <h1>{t().guest.upload.heading}</h1>
        <p class="lead">{t().guest.upload.lead(data.invitedBy)}</p>
      </header>

      {#if !target}
        <form class="card" onsubmit={start}>
          <Input label={t().guest.upload.yourName} bind:value={guestName} placeholder={t().guest.upload.namePlaceholder} autofocus={!guestName} />
          <Input label={t().guest.upload.whichSong} bind:value={songName} placeholder={t().guest.upload.songPlaceholder} list="songs" />
          <datalist id="songs">
            {#each data.tracks as track (track.id)}<option value={track.name}></option>{/each}
          </datalist>
          {#if songName.trim()}
            <p class="hint">
              {existing ? t().guest.upload.toExisting(existing.name) : t().guest.upload.newSong(songName.trim())}
            </p>
          {:else if data.tracks.length}
            <p class="hint">{t().guest.upload.alreadyThere(data.tracks.map((track) => track.name).join(', '))}</p>
          {/if}
          <label class="note">
            <span class="input-label">{t().guest.upload.noteTo(data.invitedBy)}</span>
            <textarea bind:value={note} rows="3" maxlength="2000" placeholder={t().guest.upload.notePlaceholder}></textarea>
          </label>
          <Button type="submit" loading={starting} disabled={!guestName.trim() || !songName.trim()}>{t().guest.upload.next}</Button>
        </form>
      {:else}
        <section class="card">
          <div class="target">
            <span><Icon name="music" size={14} /> <b>{target.name}</b></span>
            <button class="link" onclick={otherSong} disabled={uploading}>{t().guest.upload.otherSong}</button>
          </div>
          {#key target.id}
            <StemUploadDropzone trackId={target.id} base="{base}/track/{target.id}" extra={{ guestName: guestName.trim() }} onUploaded={uploaded} bind:uploading />
          {/key}
        </section>
      {/if}

      {#if sent.length}
        <p class="done"><Icon name="check" size={14} /> {t().guest.upload.arrived(sent.join(', '))}</p>
      {/if}
    {/if}

    <p class="legal"><a href="/impressum">{t().common.imprint}</a> · <a href="/datenschutz">{t().common.privacy}</a></p>
  </div>
  <PleasanceFooter />
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .upload-page {
    flex: 1;
    width: 100%;
    max-width: 560px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
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
  .sender:hover {
    color: var(--color-text-primary);
  }
  .project {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  h1 {
    margin: var(--space-1) 0 var(--space-2);
    font-size: clamp(2.5rem, 10vw, 3.5rem);
    font-weight: 800;
    font-stretch: 75%;
    line-height: 0.95;
  }
  .lead {
    margin: 0;
    color: var(--color-text-secondary);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-raised);
  }
  .hint {
    margin: calc(-1 * var(--space-2)) 0 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  .note {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .note textarea {
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
    resize: vertical;
  }
  .note textarea:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 4px var(--color-accent-subtle);
  }
  .target {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .target span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--color-accent);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    white-space: nowrap;
  }
  .link:disabled {
    color: var(--color-text-tertiary);
    cursor: default;
  }
  .done {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    margin: 0;
    color: var(--color-success);
    font-size: var(--text-sm);
  }
  .muted {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  .legal {
    margin-top: auto;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
</style>
