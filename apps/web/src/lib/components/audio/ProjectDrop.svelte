<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { planDrop } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import {
    byFileName, checkFileSize, describeDrop, isVersionable, mimeOf, trackNameFromFile, unreadableFiles, uploadAudioFile, uploadToProject, registerVersion,
  } from '$lib/audio/upload.js';
  import { dateLocale, t } from '$lib/i18n/index.js';
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
    /** How many files went into the project's files, and how many into tracks */
    onDone: (result: { files: number; tracks: number }) => void;
    /** Stems first: a track without a mix */
    onEmptyTrack?: (() => void) | undefined;
  } = $props();

  // mix: one file becomes a version. stems: files of equal length become the stems of one song, with a mix
  // unless the choice says otherwise. file: anything else goes into the project's files.
  type Choice = 'mix' | 'nomix' | 'files';
  type Row = {
    kind: 'mix' | 'stems' | 'file';
    name: string; file: string; files: File[]; size: number; loaded: number; progress: number;
    state: 'wartet' | 'lädt hoch' | 'speichert' | 'fertig' | 'fehler' | 'abgebrochen';
    matchId: string | null; newTrack: boolean; locked: boolean; number: number; matchedNumber: number; abort: AbortController; error?: string;
    // stems: a finished mix that came along and becomes the version, and how long the stems are
    bounce: File | null; duration: number; choice: Choice;
  };
  const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase(dateLocale());
  const mb = (bytes: number) => (bytes / 1024 ** 2).toLocaleString(dateLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  // Names a DAW gives every export, which say nothing about the song
  const GENERIC = /^(audio|track|spur|stem|stems|untitled|unbenannt|bounce|export)?$/i;

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

  const newRow = (kind: Row['kind'], name: string, files: File[], matchId: string | null, extra: Partial<Row> = {}): Row => ({
    kind, name, file: files.map((f) => f.name).join(', '), files, size: files.reduce((sum, f) => sum + f.size, 0), loaded: 0, progress: 0,
    state: 'wartet', matchId, newTrack: false, locked: false, matchedNumber: 0, abort: new AbortController(), number: matchId ? 0 : 1,
    bounce: null, duration: 0, choice: 'mix', ...extra,
  });

  /** trackId: dropped on a track, so its mixes and stems belong to it */
  export async function add(files: File[], trackId?: string) {
    if (!files.length) return;
    if (busy) {
      toast(t().track.drop.busy, 'warning');
      return;
    }
    error = checkFileSize(files) ?? '';
    if (error) return;
    preparing = true;
    const unreadable = await unreadableFiles(files);
    if (unreadable.length > 0) {
      preparing = false;
      error = t().track.drop.unreadable(unreadable.length, unreadable.map((f) => f.name).join(', '));
      return;
    }

    files.sort(byFileName);
    let described: Awaited<ReturnType<typeof describeDrop>>;
    let plan: ReturnType<typeof planDrop>;
    try {
      described = await describeDrop(files);
      plan = planDrop(described);
    } catch {
      preparing = false;
      error = t().track.drop.failed;
      return;
    }
    const known = [...tracks];
    const matchOf = (name: string) => {
      if (trackId) return trackId;
      const matches = known.filter((t) => normalize(t.name) === normalize(name));
      return matches.length === 1 ? matches[0].id : null;
    };
    rows = [
      ...plan.groups.map((g) => {
        const stems = g.stems.map((i) => files[i]);
        const name = GENERIC.test(g.name) ? t().track.drop.newSongName : trackNameFromFile(g.name);
        return newRow('stems', name, g.mix === null ? stems : [files[g.mix], ...stems], matchOf(name), {
          bounce: g.mix === null ? null : files[g.mix],
          duration: described[g.stems[0]].duration ?? 0,
        });
      }),
      ...plan.mixes.map((i) => {
        const name = trackNameFromFile(files[i].name);
        return newRow('mix', name, [files[i]], matchOf(name));
      }),
      ...plan.files.map((i) => newRow('file', files[i].name, [files[i]], null, { choice: 'files' })),
    ];
    // The song a row would go to: a file row switched to a version is named after its file
    const songOf = (row: Row) => (row.kind === 'file' ? trackNameFromFile(row.files[0].name) : row.name);
    const resolve = async (row: Row) => {
      if (!trackId) {
        const matches = known.filter((t) => normalize(t.name) === normalize(songOf(row)));
        row.matchId = matches.length === 1 ? matches[0].id : null;
      }
      if (row.matchId && !counts.has(row.matchId)) {
        const res = await api.get<{ versions: { versionNumber: number }[] }>(`/versions/track/${row.matchId}`);
        counts.set(row.matchId, Math.max(0, ...res.versions.map((v) => v.versionNumber)));
      }
      row.matchedNumber = row.matchId ? (counts.get(row.matchId) ?? 0) + 1 : 1;
      if (!row.newTrack) row.number = row.matchedNumber;
    };
    transferring = true;
    preparing = false;
    const counts = new Map<string, number>();
    let lastTrackId = '';
    for (const row of rows) {
      if (row.abort.signal.aborted) continue;
      row.state = 'lädt hoch';
      try {
        if (row.choice !== 'files') await resolve(row);
        const keys = await transfer(row);
        if (!keys) { row.state = 'abgebrochen'; continue; }
        row.locked = true;
        row.state = 'speichert';
        if (row.choice === 'files') {
          for (const [i, file] of row.files.entries()) {
            await api.post(`/files/project/${projectId}`, { fileKey: keys[i], originalFileName: file.name, mimeType: mimeOf(file), trackId: trackId ?? null });
          }
          row.state = 'fertig';
          continue;
        }
        // The choice may have changed during the transfer
        await resolve(row);
        let targetId = row.newTrack ? null : row.matchId;
        if (!targetId) {
          const { track } = await api.post<{ track: { id: string } }>(`/tracks/${projectId}`, { name: songOf(row) });
          targetId = track.id;
          known.push({ id: targetId, name: songOf(row) });
        }
        row.number = (counts.get(targetId) ?? 0) + 1;
        if (row.kind !== 'stems') {
          await registerVersion(targetId, row.files[0], keys[0]);
          counts.set(targetId, row.number);
        } else {
          await registerStems(row, targetId, keys);
          if (row.bounce || row.choice === 'mix') counts.set(targetId, row.number);
        }
        lastTrackId = targetId;
        row.state = 'fertig';
      } catch (err) {
        if (row.abort.signal.aborted) { row.state = 'abgebrochen'; continue; }
        row.state = 'fehler';
        row.error = err instanceof Error ? err.message : t().track.drop.failed;
      }
    }
    const done = rows.filter((r) => r.state === 'fertig');
    const filed = done.filter((r) => r.choice === 'files').reduce((n, r) => n + r.files.length, 0);
    const uploaded = done.reduce((n, r) => n + r.files.length, 0);
    onDone({ files: filed, tracks: uploaded - filed });
    if (rows.length === 1 && done.length === 1 && lastTrackId) {
      transferring = false;
      goto(`/projects/${projectId}/tracks/${lastTrackId}`);
      return;
    }
    if (uploaded) toast(filed === uploaded ? t().track.drop.filed(filed) : t().track.drop.uploaded(uploaded));
    rows = rows.filter((r) => r.state === 'fehler' || r.state === 'abgebrochen');
    transferring = false;
  }

  // Every file of the row into the bucket. A single mix goes the way it always went, everything else through the
  // project's upload URL, so the row can still switch between stems and files until it is registered.
  async function transfer(row: Row) {
    if (row.kind === 'mix') {
      const key = await uploadAudioFile(`/versions/project/${projectId}/upload-url`, row.files[0], {
        onProgress: (p) => (row.progress = p),
        onBytes: (bytes) => (row.loaded = bytes),
        signal: row.abort.signal,
      });
      return key ? [key] : null;
    }
    const keys: string[] = [];
    let before = 0;
    for (const file of row.files) {
      const key = await uploadToProject(projectId, file, {
        onBytes: (bytes) => {
          row.loaded = before + bytes;
          row.progress = Math.round((row.loaded / Math.max(1, row.size)) * 100);
        },
        signal: row.abort.signal,
      });
      if (!key) return null;
      keys.push(key);
      before += file.size;
    }
    return keys;
  }

  // "Kreise_Kick.wav" of "Kreise" → "Kick"
  const stemName = (file: string, song: string) => {
    const base = file.replace(/\.[^.]+$/, '');
    const rest = base.toLowerCase().startsWith(song.toLowerCase()) ? base.slice(song.length).replace(/^[\s_\-–—.]+/, '') : '';
    return (rest || base).slice(0, 255);
  };

  async function registerStems(row: Row, trackId: string, keys: string[]) {
    let start = 0;
    if (row.bounce) {
      await registerVersion(trackId, row.bounce, keys[0]);
      start = 1;
    }
    // With a bounce of its own the song needs no mix from the stems
    const mix = !row.bounce && row.choice === 'mix';
    for (let i = start; i < row.files.length; i++) {
      const file = row.files[i];
      await api.post(`/stems/track/${trackId}`, {
        fileKey: keys[i], name: stemName(file.name, row.name), originalFileName: file.name, mimeType: mimeOf(file), fileSize: file.size, mix,
      });
    }
  }

  function cancel(row: Row) {
    row.abort.abort();
    row.state = 'abgebrochen';
    toast(t().track.upload.aborted);
  }

  function toggleTarget(row: Row) {
    row.newTrack = !row.newTrack;
    row.number = row.newTrack ? 1 : row.matchedNumber;
  }

  function target(row: Row) {
    const d = t().track.drop;
    if (row.choice === 'files') return d.toFiles;
    const existing = row.matchId && !row.newTrack;
    if (row.kind === 'stems' && !row.bounce && row.choice === 'nomix') return existing ? d.stemsOf(row.name) : d.newTrackStems;
    return existing ? d.becomes(row.number, row.name) : d.newTrack;
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

<input bind:this={input} type="file" multiple hidden onchange={handlePick} />

{#if big && !busy}
  <div
    class="zone"
    class:over={dragOver}
    role="region"
    aria-label={t().track.drop.uploadMix}
    ondragover={(e) => {
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={() => (dragOver = false)}
    ondrop={handleDrop}
  >
    <span class="icon"><Icon name="upload" size={22} /></span>
    <h2>{t().track.drop.dropMix}</h2>
    <p>{t().track.drop.hint}</p>
    <Button onclick={pick}>{t().track.drop.chooseFiles}</Button>
    <span class="formats">{t().track.drop.formats}</span>
  </div>
  {#if onEmptyTrack}
    <p class="empty-track">{t().track.drop.onlyStems} <button type="button" onclick={onEmptyTrack}>{t().track.drop.createEmpty}</button></p>
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
          {#if row.kind === 'stems'}
            <small>{t().track.drop.stemsRow(row.files.length - (row.bounce ? 1 : 0), minutes(row.duration))} · {mb(row.size)} MB</small>
            <small class="names">{row.file}</small>
          {:else}
            <small>{row.file} · {mb(row.size)} MB</small>
          {/if}
          <small class="target">{target(row)}</small>
          {#if row.bounce && row.choice !== 'files'}<small>{t().track.drop.withBounce(row.bounce.name)}</small>{/if}
          {#if row.kind === 'stems' && !row.locked && (row.state === 'wartet' || row.state === 'lädt hoch')}
            <select class="choice" aria-label={t().track.drop.choiceLabel(row.name)} bind:value={row.choice}>
              {#if !row.bounce}
                <option value="mix">{t().track.drop.choiceMix}</option>
                <option value="nomix">{t().track.drop.choiceNoMix}</option>
              {:else}
                <option value="mix">{t().track.drop.choiceSong}</option>
              {/if}
              <option value="files">{t().track.drop.choiceFiles}</option>
            </select>
          {/if}
          {#if row.kind !== 'stems' && (row.kind === 'mix' || isVersionable(row.file)) && !row.locked && (row.state === 'wartet' || row.state === 'lädt hoch')}
            <select class="choice" aria-label={t().track.drop.choiceLabel(row.file)} bind:value={row.choice}>
              <option value="mix">{t().track.drop.choiceVersion}</option>
              <option value="files">{t().track.drop.choiceFile}</option>
            </select>
          {/if}
          {#if row.kind !== 'file' && row.choice !== 'files' && row.matchId && !row.locked && (row.state === 'wartet' || row.state === 'lädt hoch')}
            <button type="button" class="switch-target" onclick={() => toggleTarget(row)}>{row.newTrack ? t().track.drop.attachInstead : t().track.drop.newTrackInstead}</button>
          {/if}
          {#if row.state === 'lädt hoch'}
            <span class="bar" role="progressbar" aria-label={row.file} aria-valuenow={row.progress} aria-valuemin="0" aria-valuemax="100"><i style="width: {row.progress}%"></i></span>
            <small>{t().track.drop.loadedOf(mb(row.loaded), mb(row.size))}</small>
          {/if}
          {#if row.error}<small class="row-error" role="alert">{row.error}</small>{/if}
        </div>
        {#if row.state === 'wartet' || row.state === 'lädt hoch'}
          <button type="button" class="switch-target" aria-label={t().track.drop.cancelUpload(row.file)} onclick={() => cancel(row)}>{t().common.cancel}</button>
        {/if}
        <span class="state" class:bad={row.state === 'fehler'}>
          {row.state === 'lädt hoch' ? `${row.progress} %` : row.state === 'fehler' ? t().track.drop.error : t().track.drop.states[row.state]}
        </span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .switch-target { justify-self: start; background: none; border: 0; padding: 4px 0; color: var(--color-text-primary); text-decoration: underline; cursor: pointer; font: inherit; font-size: var(--text-xs); text-align: left; }
  .row b { overflow-wrap: anywhere; }
  .row .target { white-space: normal; color: var(--color-text-primary); }
  .row .names { white-space: normal; }
  .choice { justify-self: start; margin-top: 4px; max-width: 100%; background: var(--color-bg-subtle); color: var(--color-text-primary); border: 1px solid var(--color-border-hover); border-radius: var(--radius-sm); padding: 4px 8px; font: inherit; font-size: var(--text-xs); }
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
