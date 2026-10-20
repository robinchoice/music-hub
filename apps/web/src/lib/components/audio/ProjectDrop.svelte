<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { SUPPORTED_EXTENSIONS } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { byFileName, checkAudioFiles, trackNameFromFile, unreadableFiles, uploadAudioFile, registerVersion } from '$lib/audio/upload.js';
  import { toast } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';

  let {
    projectId,
    tracks = [],
    big = false,
    onDone,
    onEmptyTrack,
  }: {
    projectId: string;
    tracks?: { id: string; name: string }[];
    /** The project has no tracks yet: the zone is the way in */
    big?: boolean;
    onDone: () => void;
    /** Stems first: a track without a mix */
    onEmptyTrack?: () => void;
  } = $props();

  type Row = {
    name: string; file: string; size: number; loaded: number; progress: number;
    state: 'wartet' | 'lädt hoch' | 'speichert' | 'fertig' | 'fehler' | 'abgebrochen';
    matchId: string | null; newTrack: boolean; locked: boolean; number: number; matchedNumber: number; abort: AbortController; error?: string;
  };
  const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
  const mb = (bytes: number) => (bytes / 1024 ** 2).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  let input = $state<HTMLInputElement>();
  let rows = $state<Row[]>([]);
  let dragOver = $state(false);
  let error = $state('');
  let preparing = $state(false);
  let transferring = $state(false);
  const busy = $derived(preparing || transferring);

  onDestroy(() => rows.forEach((row) => { if (row.state === 'wartet' || row.state === 'lädt hoch') row.abort.abort(); }));

  export function pick() {
    input?.click();
  }

  export async function add(files: File[]) {
    if (busy || !files.length) return;
    error = checkAudioFiles(files) ?? '';
    if (error) return;
    preparing = true;
    const unreadable = await unreadableFiles(files);
    if (unreadable.length > 0) {
      preparing = false;
      error = `Der Browser konnte ${unreadable.length === 1 ? 'diese Datei' : 'diese Dateien'} nicht lesen: ${unreadable.map((f) => f.name).join(', ')}. Es wurde nichts hochgeladen.`;
      return;
    }

    files.sort(byFileName);
    const known = [...tracks];
    const counts = new Map<string, number>();
    rows = files.map((f) => {
      const name = trackNameFromFile(f.name);
      const matches = known.filter((t) => normalize(t.name) === normalize(name));
      return { name, file: f.name, size: f.size, loaded: 0, progress: 0, state: 'wartet', matchId: matches.length === 1 ? matches[0].id : null, newTrack: false, locked: false, matchedNumber: 0, abort: new AbortController(), number: matches.length === 1 ? 0 : 1 };
    });
    transferring = true;
    preparing = false;
    let lastTrackId = '';
    for (const [i, file] of files.entries()) {
      const row = rows[i];
      if (row.abort.signal.aborted) continue;
      row.state = 'lädt hoch';
      try {
        const matches = known.filter((t) => normalize(t.name) === normalize(row.name));
        row.matchId = matches.length === 1 ? matches[0].id : null;
        if (row.matchId && !counts.has(row.matchId)) {
          const res = await api.get<{ versions: { versionNumber: number }[] }>(`/versions/track/${row.matchId}`);
          counts.set(row.matchId, Math.max(0, ...res.versions.map((v) => v.versionNumber)));
        }
        row.matchedNumber = row.matchId ? (counts.get(row.matchId) ?? 0) + 1 : 1;
        if (!row.newTrack) row.number = row.matchedNumber;
        const fileKey = await uploadAudioFile(`/versions/project/${projectId}/upload-url`, file, {
          onProgress: (p) => (row.progress = p),
          onBytes: (bytes) => (row.loaded = bytes),
          signal: row.abort.signal,
        });
        if (!fileKey) { row.state = 'abgebrochen'; continue; }
        row.locked = true;
        row.state = 'speichert';
        let targetId = row.newTrack ? null : row.matchId;
        if (!targetId) {
          const { track } = await api.post<{ track: { id: string } }>(`/tracks/${projectId}`, { name: row.name });
          targetId = track.id;
          known.push({ id: targetId, name: row.name });
        }
        row.number = (counts.get(targetId) ?? 0) + 1;
        await registerVersion(targetId, file, fileKey);
        counts.set(targetId, row.number);
        lastTrackId = targetId;
        row.state = 'fertig';
      } catch (err) {
        if (row.abort.signal.aborted) { row.state = 'abgebrochen'; continue; }
        row.state = 'fehler';
        row.error = err instanceof Error ? err.message : 'Upload fehlgeschlagen';
      }
    }
    onDone();
    const ok = rows.filter((r) => r.state === 'fertig').length;
    if (files.length === 1 && ok === 1) {
      transferring = false;
      goto(`/projects/${projectId}/tracks/${lastTrackId}`);
      return;
    }
    if (ok) toast(`${ok} ${ok === 1 ? 'Datei hochgeladen' : 'Dateien hochgeladen'} · wird verarbeitet`);
    rows = rows.filter((r) => r.state === 'fehler' || r.state === 'abgebrochen');
    transferring = false;
  }

  function cancel(row: Row) {
    row.abort.abort();
    row.state = 'abgebrochen';
    toast('Upload abgebrochen');
  }

  function toggleTarget(row: Row) {
    row.newTrack = !row.newTrack;
    row.number = row.newTrack ? 1 : row.matchedNumber;
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
    <p>Den Track erkennen wir am Dateinamen. Weitere Mixe desselben Songs werden neue Versionen.</p>
    <Button onclick={pick}>Dateien auswählen</Button>
    <span class="formats">WAV, MP3, FLAC, AIFF · max. 500 MB</span>
  </div>
  {#if onEmptyTrack}
    <p class="empty-track">Nur Spuren, noch kein Mix? <button type="button" onclick={onEmptyTrack}>Leeren Track anlegen</button></p>
  {/if}
{/if}

{#if error}
  <p class="error" role="alert">{error}</p>
{/if}

{#if rows.length}
  <ul class="rows" aria-live="polite">
    {#each rows as row}
      <li class="row">
        <div>
          <b>{row.name}</b>
          <small>{row.file} · {mb(row.size)} MB</small>
          <small class="target">{#if row.matchId && !row.newTrack}wird {row.number ? `V${row.number}` : 'eine neue Version'} von „{row.name}“{:else}Neuer Track · wird V1{/if}</small>
          {#if row.matchId && !row.locked && (row.state === 'wartet' || row.state === 'lädt hoch')}
            <button type="button" class="switch-target" onclick={() => toggleTarget(row)}>{row.newTrack ? 'Stattdessen als neue Version anhängen' : 'Stattdessen neuer Track'}</button>
          {/if}
          {#if row.state === 'lädt hoch'}
            <span class="bar" role="progressbar" aria-label={row.file} aria-valuenow={row.progress} aria-valuemin="0" aria-valuemax="100"><i style="width: {row.progress}%"></i></span>
            <small>{mb(row.loaded)} von {mb(row.size)} MB</small>
          {/if}
          {#if row.error}<small class="row-error" role="alert">{row.error}</small>{/if}
        </div>
        {#if row.state === 'wartet' || row.state === 'lädt hoch'}
          <button type="button" class="switch-target" aria-label={`Upload von ${row.file} abbrechen`} onclick={() => cancel(row)}>Abbrechen</button>
        {/if}
        <span class="state" class:bad={row.state === 'fehler'}>
          {row.state === 'lädt hoch' ? `${row.progress} %` : row.state === 'fehler' ? 'Fehler' : row.state}
        </span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .switch-target { justify-self: start; background: none; border: 0; padding: 4px 0; color: var(--color-text-primary); text-decoration: underline; cursor: pointer; font: inherit; font-size: var(--text-xs); text-align: left; }
  .row b { overflow-wrap: anywhere; }
  .row .target { white-space: normal; color: var(--color-text-primary); }
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
