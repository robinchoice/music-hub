<script lang="ts">
  import { goto } from '$app/navigation';
  import { SUPPORTED_EXTENSIONS } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { checkAudioFiles, trackNameFromFile, unreadableFiles, uploadVersion } from '$lib/audio/upload.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';

  // Files dropped on a project become tracks, each with the file as V1. The name comes from the file name.
  let {
    projectId,
    big = false,
    onDone,
    onEmptyTrack,
  }: {
    projectId: string;
    /** The project has no tracks yet: the zone is the way in */
    big?: boolean;
    onDone: () => void;
    /** Stems first: a track without a mix */
    onEmptyTrack?: () => void;
  } = $props();

  type Row = { name: string; file: string; progress: number; state: 'wartet' | 'lädt hoch' | 'fertig' | 'fehler'; error?: string };

  let input = $state<HTMLInputElement>();
  let rows = $state<Row[]>([]);
  let dragOver = $state(false);
  let error = $state('');
  const busy = $derived(rows.some((r) => r.state === 'wartet' || r.state === 'lädt hoch'));

  export function pick() {
    input?.click();
  }

  export async function add(files: File[]) {
    if (busy || !files.length) return;
    error = checkAudioFiles(files) ?? '';
    if (error) return;
    const unreadable = await unreadableFiles(files);
    if (unreadable.length > 0) {
      error = `Der Browser konnte ${unreadable.length === 1 ? 'diese Datei' : 'diese Dateien'} nicht lesen: ${unreadable.map((f) => f.name).join(', ')}. Es wurde nichts hochgeladen.`;
      return;
    }

    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    rows = files.map((f) => ({ name: trackNameFromFile(f.name), file: f.name, progress: 0, state: 'wartet' }));
    let lastTrackId = '';
    for (const [i, file] of files.entries()) {
      rows[i].state = 'lädt hoch';
      try {
        const { track } = await api.post<{ track: { id: string } }>(`/tracks/${projectId}`, { name: rows[i].name });
        lastTrackId = track.id;
        await uploadVersion(track.id, file, { onProgress: (p) => (rows[i].progress = p) });
        rows[i].state = 'fertig';
      } catch (err) {
        rows[i] = { ...rows[i], state: 'fehler', error: err instanceof Error ? err.message : 'Upload fehlgeschlagen' };
      }
    }

    onDone();
    const ok = rows.filter((r) => r.state === 'fertig').length;
    if (files.length === 1 && ok === 1) {
      // One mix: straight into its track, where the waveform turns up
      goto(`/projects/${projectId}/tracks/${lastTrackId}`);
      return;
    }
    if (ok) toastSuccess(ok === 1 ? '1 Track angelegt' : `${ok} Tracks angelegt`);
    // Failed rows stay, so it's clear which file to try again
    rows = rows.filter((r) => r.state === 'fehler');
  }

  function handlePick(e: Event) {
    const el = e.target as HTMLInputElement;
    const files = Array.from(el.files ?? []);
    el.value = '';
    void add(files);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    void add(Array.from(e.dataTransfer?.files ?? []));
  }
</script>

<svelte:window onbeforeunload={(e) => busy && e.preventDefault()} />

<input bind:this={input} type="file" accept={SUPPORTED_EXTENSIONS.join(',')} multiple hidden onchange={handlePick} />

{#if big && !busy}
  <div
    class="zone"
    class:over={dragOver}
    role="region"
    aria-label="Mix hochladen"
    ondragover={(e) => {
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={() => (dragOver = false)}
    ondrop={handleDrop}
  >
    <span class="icon"><Icon name="upload" size={22} /></span>
    <h2>Mix hier ablegen</h2>
    <p>Jede Datei wird ein Track mit V1. Den Namen nehmen wir aus dem Dateinamen.</p>
    <Button onclick={pick}>Dateien auswählen</Button>
    <span class="formats">WAV, MP3, FLAC, AIFF · max. 500 MB</span>
  </div>
  {#if onEmptyTrack}
    <p class="empty-track">Nur Spuren, noch kein Mix? <button type="button" onclick={onEmptyTrack}>Leeren Track anlegen</button></p>
  {/if}
{/if}

{#if error}
  <p class="error">{error}</p>
{/if}

{#if rows.length}
  <ul class="rows" aria-live="polite">
    {#each rows as row (row.file)}
      <li class="row">
        <div>
          <b>{row.name}</b>
          <small>V1 · {row.file}</small>
          {#if row.state === 'lädt hoch'}
            <span class="bar"><i style="width: {row.progress}%"></i></span>
          {/if}
          {#if row.error}<small class="row-error">{row.error}</small>{/if}
        </div>
        <span class="state" class:bad={row.state === 'fehler'}>
          {row.state === 'lädt hoch' ? `${row.progress} %` : row.state === 'fehler' ? 'Fehler' : row.state}
        </span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .zone {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    padding: var(--space-8) var(--space-5);
    margin-bottom: var(--space-4);
    border: 1.5px dashed var(--color-border-hover);
    border-radius: var(--radius-lg);
    text-align: center;
    transition:
      border-color 0.2s,
      background 0.2s;
  }
  .zone.over {
    border-color: var(--color-accent);
    background: var(--color-accent-subtle);
  }
  .icon {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--gradient-accent);
    color: #17171a;
  }
  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.6rem;
    font-weight: 800;
    font-stretch: 78%;
    letter-spacing: -0.02em;
  }
  p {
    margin: 0;
    color: var(--color-text-secondary);
  }
  .formats {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .empty-track {
    margin: 0 0 var(--space-6);
    text-align: center;
    font-size: var(--text-sm);
  }
  .empty-track button {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--color-text-primary);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .error {
    color: var(--color-error);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-4);
  }
  .rows {
    list-style: none;
    margin: 0 0 var(--space-5);
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-raised);
  }
  .row > div {
    display: grid;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .row small {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row .row-error {
    color: var(--color-error);
    white-space: normal;
  }
  .bar {
    height: 4px;
    margin-top: 6px;
    border-radius: 4px;
    background: var(--color-bg-subtle);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--gradient-accent);
    transition: width 0.2s;
  }
  .state {
    flex-shrink: 0;
    font-size: var(--text-xs);
    padding: 2px 9px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-hover);
    color: var(--color-text-secondary);
  }
  .state.bad {
    color: var(--color-error);
  }
</style>
