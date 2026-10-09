<script lang="ts">
  import { onMount } from 'svelte';
  import { OPEN_LICENSE_INFO, type OpenLicense } from '@music-hub/shared';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import PleasanceFooter from '$lib/components/PleasanceFooter.svelte';
  import OpenHeader from '$lib/components/open/OpenHeader.svelte';
  import { formatTime } from '$lib/utils/format.js';

  type OpenTrack = {
    id: string;
    name: string;
    artist: string;
    coverUrl: string | null;
    license: OpenLicense;
    duration: number | null;
    stemCount: number;
    remixCount: number;
  };

  let tracks = $state<OpenTrack[] | null>(null);

  onMount(async () => {
    tracks = await fetch('/api/v1/open')
      .then((r) => (r.ok ? r.json() : { tracks: [] }))
      .then((r) => r.tracks)
      .catch(() => []);
  });
</script>

<svelte:head>
  <title>Offene Musik — Music Hub</title>
</svelte:head>

<div class="shell">
  <div class="page">
    <OpenHeader />

    <section class="intro">
      <h1>Offene Musik</h1>
      <p>
        Mixe und Spuren, die ihre Künstler zum Remixen freigegeben haben, unter Creative-Commons-Lizenzen.
        Lade sie herunter oder fang mit einem Klick deinen eigenen Remix in Music Hub an.
      </p>
    </section>

    {#if tracks === null}
      <p class="faint">Lädt…</p>
    {:else if tracks.length === 0}
      <p class="faint">Noch ist nichts offen. In Music Hub stellst du einen freigegebenen Track über „Offen stellen“ zur Verfügung.</p>
    {:else}
      <ul class="list">
        {#each tracks as t (t.id)}
          <li>
            <a href="/offen/{t.id}">
              <CoverImage src={t.coverUrl} name={t.name} size="md" rounded="md" />
              <span class="text">
                <b>{t.name}</b>
                <span class="faint">{t.artist}</span>
              </span>
              <span class="meta faint">
                {#if t.duration}{formatTime(t.duration)} · {/if}{t.stemCount === 1 ? '1 Spur' : `${t.stemCount} Spuren`}{#if t.remixCount} · {t.remixCount === 1 ? '1 Remix' : `${t.remixCount} Remixe`}{/if}
              </span>
              <span class="license">{OPEN_LICENSE_INFO[t.license].label}</span>
            </a>
          </li>
        {/each}
      </ul>
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
  .page {
    flex: 1;
    width: 100%;
    max-width: 880px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  h1 {
    margin: 0 0 var(--space-3);
    font-family: var(--font-display);
    font-size: clamp(2.6rem, 9vw, 4.5rem);
    font-weight: 800;
    font-stretch: 75%;
    line-height: 0.9;
  }
  .intro p {
    margin: 0;
    max-width: 640px;
    color: var(--color-text-secondary);
    line-height: 1.55;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .list a {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
  }
  .list a:hover {
    border-color: var(--color-border-hover);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .faint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .license {
    padding: 3px 10px;
    border-radius: var(--radius-full);
    background: var(--spectrum);
    color: var(--color-on-accent);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
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
  @media (max-width: 560px) {
    .meta {
      display: none;
    }
  }
</style>
