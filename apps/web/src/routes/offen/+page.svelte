<script lang="ts">
  import { locale, t } from '$lib/i18n/index.js';
  import { onMount } from 'svelte';
  import { OPEN_LICENSE_INFO, type OpenLicense } from '@music-hub/shared';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import PleasanceFooter from '$lib/components/PleasanceFooter.svelte';
  import OpenHeader from '$lib/components/open/OpenHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { user } from '$lib/stores/auth.js';
  import { OPEN_EXAMPLE_ID } from '$lib/demo/mode.js';
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

  // Shown while nothing is open; the page behind it shows demoOpenTrack() from $lib/demo/backend
  const example: OpenTrack = {
    id: OPEN_EXAMPLE_ID,
    name: 'Nachtbus',
    artist: 'Fernlicht',
    coverUrl: '/demo/nachtbus-cover.svg',
    license: 'cc-by',
    duration: 155,
    stemCount: 12,
    remixCount: 0,
  };

  const metaOf = (track: OpenTrack) =>
    [
      track.duration ? formatTime(track.duration) : '',
      t().common.stems(track.stemCount),
      track.remixCount ? t().guest.openList.remixes(track.remixCount) : '',
    ]
      .filter(Boolean)
      .join(' · ');

  // The rules of lib/open.ts in the API
  const steps = $derived(t().guest.openList.steps);

  onMount(async () => {
    tracks = await fetch('/api/v1/open')
      .then((r) => (r.ok ? r.json() : { tracks: [] }))
      .then((r) => r.tracks)
      .catch(() => []);
  });
</script>

<svelte:head>
  <title>{t().guest.openList.title}</title>
</svelte:head>

<div class="shell">
  <div class="page">
    <OpenHeader />

    <section class="intro">
      <h1>{t().guest.openList.heading}</h1>
      <p>{t().guest.openList.intro}</p>
    </section>

    <ol class="steps">
      {#each steps as step, i (step.title)}
        <li>
          <span class="n">{i + 1}</span>
          <b>{step.title}</b>
          <span>{step.text}</span>
        </li>
      {/each}
    </ol>

    {#if tracks === null}
      <p class="faint">{t().guest.listenTrack.loading}</p>
    {:else}
      <div class="tracks">
        <ul class="list">
          {#each tracks.length ? tracks : [example] as track (track.id)}
            <li>
              <a href="/offen/{track.id}">
                <CoverImage src={track.coverUrl} name={track.name} size="md" rounded="md" />
                <span class="text">
                  <b>{track.name}</b>
                  <span class="faint">{track.artist}</span>
                </span>
                <span class="meta faint">{metaOf(track)}</span>
                <span class="license">{OPEN_LICENSE_INFO[locale()][track.license].label}</span>
                {#if track.id === OPEN_EXAMPLE_ID}<span class="tag">{t().guest.openList.example}</span>{/if}
              </a>
            </li>
          {/each}
        </ul>
        {#if !tracks.length}
          <p class="faint">{t().guest.openList.noneYet}</p>
        {/if}
      </div>
    {/if}

    <section class="cta">
      {#if $user}
        <Button size="lg" href="/dashboard">{t().guest.openList.toDashboard}</Button>
        <span class="hint">{t().guest.openList.dashboardHint}</span>
      {:else}
        <Button size="lg" href="/register">{t().guest.openList.registerAndOpen}</Button>
        <a class="textlink" href="/login?next=%2Foffen">{t().guest.openList.alreadyMember}</a>
      {/if}
    </section>

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
  .page {
    flex: 1;
    width: 100%;
    max-width: 980px;
    margin: 0 auto;
    padding: 0 var(--space-10) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }
  .intro {
    padding-top: 40px;
    max-width: 680px;
  }
  h1 {
    margin: 0 0 var(--space-4);
    font-family: var(--font-display);
    font-size: clamp(52px, 7vw, 88px);
    font-weight: 800;
    font-stretch: 75%;
    letter-spacing: -0.03em;
    line-height: 0.9;
  }
  .intro p {
    margin: 0;
    font-size: 19px;
    line-height: 1.55;
    color: #b5b3bb;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .steps li {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .steps b {
    color: var(--color-text-primary);
    font-size: var(--text-base);
  }
  .n {
    font-family: var(--font-display);
    font-size: 28px;
    font-weight: 800;
    font-stretch: 76%;
    line-height: 1;
    background: var(--spectrum);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    align-self: flex-start;
  }
  .tracks {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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
  .tag {
    padding: 1px 8px;
    border: 1px dashed var(--color-border-hover);
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .cta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  .textlink {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .textlink:hover {
    color: var(--color-text-primary);
  }
  .hint {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
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
  @media (max-width: 759px) {
    .page {
      padding: 0 var(--space-5) var(--space-6);
    }
    .intro {
      padding-top: 16px;
    }
    h1 {
      font-size: 46px;
    }
    .intro p {
      font-size: 17px;
    }
    .steps {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 560px) {
    .meta {
      display: none;
    }
  }
</style>
