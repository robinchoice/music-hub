<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { OPEN_LICENSE_INFO, type OpenLicense } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { user, authLoading, checkAuth } from '$lib/stores/auth.js';
  import { toastError, toastSuccess } from '$lib/stores/toast.js';
  import WaveformPlayer from '$lib/components/audio/WaveformPlayer.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import PleasanceFooter from '$lib/components/PleasanceFooter.svelte';
  import OpenHeader from '$lib/components/open/OpenHeader.svelte';
  import { formatFileSize } from '$lib/utils/format.js';

  type Remix = { id: string; name: string; artist: string };
  type OpenTrack = {
    track: { id: string; name: string; description: string | null; credit: string | null; forkedFromId: string | null };
    artist: string;
    people: { id: string; name: string; avatarUrl: string | null }[];
    license: OpenLicense;
    credit: string;
    coverUrl: string | null;
    version: { duration: number | null };
    streamUrl: string;
    waveformUrl: string | null;
    stems: { id: string; name: string; fileSize: number }[];
    remixes: { count: number; open: (Remix & { remixes: Remix[] })[] };
  };
  type Project = { project: { id: string; name: string }; role: string };

  const trackId = ($page.params as Record<string, string>).trackId;
  let data = $state<OpenTrack | null>(null);
  let peaks = $state<number[]>([]);
  let error = $state('');

  let forkOpen = $state(false);
  let projects = $state<Project[]>([]);
  let target = $state('');
  let forking = $state(false);

  let reportOpen = $state(false);
  let reason = $state('');
  let contact = $state('');
  let reporting = $state(false);

  const info = $derived(data ? OPEN_LICENSE_INFO[data.license] : null);
  const totalSize = $derived(data?.stems.reduce((sum, s) => sum + s.fileSize, 0) ?? 0);

  onMount(async () => {
    const res = await fetch(`/api/v1/open/${trackId}`).catch(() => null);
    if (!res?.ok) {
      error = (await res?.json().catch(() => null))?.error ?? 'Diese Seite ist nicht (mehr) offen.';
      return;
    }
    const open: OpenTrack = await res.json();
    peaks = open.waveformUrl ? await fetch(open.waveformUrl).then((r) => (r.ok ? r.json() : [])).catch(() => []) : [];
    data = open;
    // Back from logging in to remix
    if ($page.url.searchParams.has('remix')) void startFork();
  });

  async function download(path: string) {
    const res = await fetch(`/api/v1/open/${trackId}/${path}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toastError(body.error ?? 'Download fehlgeschlagen');
    location.href = body.url;
  }

  async function copyCredit() {
    await navigator.clipboard.writeText(data!.credit);
    toastSuccess('Credit kopiert');
  }

  async function startFork() {
    if ($authLoading) await checkAuth();
    if (!$user) return goto(`/login?next=${encodeURIComponent(`/offen/${trackId}?remix=1`)}`);
    const res = await api.get<{ projects: Project[] }>('/projects');
    projects = res.projects.filter((p) => p.role === 'owner' || p.role.includes('engineer'));
    target = projects[0]?.project.id ?? 'new';
    forkOpen = true;
  }

  async function fork() {
    forking = true;
    try {
      const projectId = target === 'new' ? (await api.post<{ project: { id: string } }>('/projects', { name: 'Remixe' })).project.id : target;
      const { track } = await api.post<{ track: { id: string; projectId: string } }>(`/open/${trackId}/fork`, { projectId });
      await goto(`/projects/${track.projectId}/tracks/${track.id}`);
    } finally {
      forking = false;
    }
  }

  async function report() {
    reporting = true;
    try {
      const res = await fetch(`/api/v1/open/${trackId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, email: contact.trim() || undefined }),
      });
      if (!res.ok) return toastError((await res.json().catch(() => ({}))).error ?? 'Meldung fehlgeschlagen');
      reportOpen = false;
      reason = '';
      toastSuccess('Danke, wir sehen uns das an');
    } finally {
      reporting = false;
    }
  }
</script>

<svelte:head>
  <title>{data ? `${data.track.name} — ${data.artist}` : 'Offene Musik — Music Hub'}</title>
</svelte:head>

<div class="shell">
  <div class="page">
    <OpenHeader />

    {#if error}
      <div class="gone">
        <p>{error}</p>
        <Button variant="secondary" href="/offen">Offene Musik entdecken</Button>
      </div>
    {:else if data && info}
      <section class="hero">
        <CoverImage src={data.coverUrl} name={data.track.name} size="xl" rounded="lg" />
        <div class="title">
          <span class="eyebrow">Offene Spuren</span>
          <h1>{data.track.name}</h1>
          <div class="by">
            <span class="avatars">
              {#each data.people as p (p.id)}<Avatar src={p.avatarUrl} name={p.name} size="sm" />{/each}
            </span>
            <span>{data.artist}</span>
            <a class="license" href={info.url} target="_blank" rel="noopener">{info.label}</a>
          </div>
        </div>
        <Button onclick={startFork}><Icon name="git-branch" size={14} /> Remixen in Music Hub</Button>
      </section>

      {#if data.track.description}<p class="description">{data.track.description}</p>{/if}

      <WaveformPlayer url={data.streamUrl} {peaks} audioDuration={data.version.duration} />

      <p class="summary">{info.summary}</p>

      <div class="grid">
        <section class="card">
          <h2>
            Spuren <span class="count">{data.stems.length}</span>
            <span class="spacer"></span>
            <Button size="sm" variant="secondary" onclick={() => download('mix')}>Mix</Button>
            {#if data.stems.length}
              <Button size="sm" variant="secondary" href="/api/v1/open/{trackId}/zip">Alle · ZIP</Button>
            {/if}
          </h2>
          {#if data.stems.length}
            <ul class="list">
              {#each data.stems as s (s.id)}
                <li>
                  <span class="grow">{s.name}</span>
                  <span class="faint">{formatFileSize(s.fileSize)}</span>
                  <button class="icon" onclick={() => download(`stems/${s.id}`)} title="{s.name} laden" aria-label="{s.name} laden">
                    <Icon name="download" size={15} />
                  </button>
                </li>
              {/each}
            </ul>
            <p class="faint">Zusammen {formatFileSize(totalSize)}</p>
          {:else}
            <p class="faint">Zu diesem Track gibt es nur den Mix.</p>
          {/if}
        </section>

        <div class="side">
          <section class="card">
            <h2>So nennst du die Quelle <span class="spacer"></span><Button size="sm" variant="secondary" onclick={copyCredit}>Kopieren</Button></h2>
            <p class="credit">{data.credit}</p>
            {#if data.track.credit}
              <p class="faint">Dieser Track ist selbst ein Remix von {#if data.track.forkedFromId}<a href="/offen/{data.track.forkedFromId}">{data.track.credit}</a>{:else}{data.track.credit}{/if}</p>
            {/if}
          </section>

          <section class="card">
            <h2>Stammbaum <span class="count">{data.remixes.count === 1 ? '1 Remix' : `${data.remixes.count} Remixe`}</span></h2>
            <ul class="tree">
              <li class="node">{data.track.name} <span class="faint">Original</span></li>
              {#each data.remixes.open as r (r.id)}
                <li class="node l1"><a href="/offen/{r.id}">{r.name}</a> <span class="faint">{r.artist}</span></li>
                {#each r.remixes as rr (rr.id)}
                  <li class="node l2"><a href="/offen/{rr.id}">{rr.name}</a> <span class="faint">{rr.artist}</span></li>
                {/each}
              {/each}
            </ul>
            {#if data.remixes.count > data.remixes.open.length}
              <p class="faint">Offen sind nur die genannten, die anderen Remixe sind noch privat.</p>
            {:else if !data.remixes.count}
              <p class="faint">Noch kein Remix. Mach den ersten.</p>
            {/if}
          </section>
        </div>
      </div>

      <p class="legal">Verletzt diese Seite deine Rechte? <button class="link" onclick={() => (reportOpen = true)}>Melden</button></p>
    {/if}
    <p class="legal"><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></p>
  </div>
  <PleasanceFooter />
</div>

<Modal bind:open={forkOpen} title="Remix anlegen">
  <div class="form">
    <p class="faint">Die Spuren landen als neuer Track in deinem Projekt. Sie belegen keinen Speicher, erst was du selbst hochlädst.</p>
    {#each projects as p (p.project.id)}
      <label class="choice"><input type="radio" bind:group={target} value={p.project.id} /> {p.project.name}</label>
    {/each}
    <label class="choice"><input type="radio" bind:group={target} value="new" /> Neues Projekt „Remixe“</label>
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (forkOpen = false)}>Abbrechen</Button>
    <Button onclick={fork} loading={forking}>Remix anlegen</Button>
  {/snippet}
</Modal>

<Modal bind:open={reportOpen} title="Seite melden">
  <div class="form">
    <p class="faint">Zum Beispiel, wenn darin deine Musik oder fremde Samples stecken. Wir prüfen das und nehmen die Seite bei Bedarf offline.</p>
    <textarea bind:value={reason} rows="4" placeholder="Was ist das Problem?"></textarea>
    <input type="email" bind:value={contact} placeholder="Deine E-Mail für Rückfragen (optional)" />
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (reportOpen = false)}>Abbrechen</Button>
    <Button onclick={report} loading={reporting} disabled={!reason.trim()}>Melden</Button>
  {/snippet}
</Modal>

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
    padding: var(--space-6) var(--space-4);
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
    align-items: flex-end;
    gap: var(--space-6);
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  .eyebrow {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }
  h1 {
    margin: var(--space-1) 0 var(--space-3);
    font-family: var(--font-display);
    font-size: clamp(2.6rem, 9vw, 4.5rem);
    font-weight: 800;
    font-stretch: 75%;
    line-height: 0.9;
    overflow-wrap: anywhere;
  }
  .by {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    color: var(--color-text-secondary);
  }
  .avatars {
    display: flex;
    gap: 4px;
  }
  .license {
    padding: 3px 10px;
    border-radius: var(--radius-full);
    background: var(--spectrum);
    color: var(--color-on-accent);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .license:hover {
    color: var(--color-on-accent);
  }
  .description,
  .summary {
    margin: 0;
    color: var(--color-text-secondary);
    line-height: 1.55;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-5);
    align-items: start;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-width: 0;
  }
  .card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-secondary);
  }
  .count {
    color: var(--color-text-tertiary);
  }
  .spacer {
    flex: 1;
  }
  .list,
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 8px 0;
    border-top: 1px solid var(--color-border);
  }
  .list li:first-child {
    border-top: 0;
  }
  .grow {
    flex: 1;
    min-width: 0;
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
  .icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-overlay);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .icon:hover {
    color: var(--color-text-primary);
  }
  .credit {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    overflow-wrap: anywhere;
  }
  .tree {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .node {
    padding: 8px 10px;
    border-radius: var(--radius-md);
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    font-size: var(--text-sm);
  }
  .node.l1 {
    margin-left: 24px;
  }
  .node.l2 {
    margin-left: 48px;
  }
  .legal {
    margin: 0;
    text-align: center;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .legal a,
  .link {
    color: var(--color-text-tertiary);
    text-decoration: underline;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .choice input {
    accent-color: var(--color-accent);
  }
  .form textarea,
  .form input[type='email'] {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }
  @media (max-width: 720px) {
    .hero {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-4);
    }
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
