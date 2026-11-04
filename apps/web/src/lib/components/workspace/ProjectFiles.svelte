<script lang="ts" module>
  export type ProjectFile = {
    id: string;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
    trackId: string | null;
    createdByName: string;
    createdAt: string;
    playable: boolean;
    canChange: boolean;
  };
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { isAudioFile } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { t } from '$lib/i18n/index.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import { formatDate, formatFileSize } from '$lib/utils/format.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';

  let {
    projectId,
    files,
    canDownload,
    tracks,
    onChange,
  }: {
    projectId: string;
    files: ProjectFile[];
    canDownload: boolean;
    tracks: { id: string; name: string }[];
    /** Files went to the trash or became stems; tracks: a track was created or got stems */
    onChange: (opts?: { tracks?: boolean }) => void;
  } = $props();

  const NEW = 'new';
  let selected = $state<string[]>([]);
  let playing = $state<string | null>(null);
  let audio: HTMLAudioElement | undefined;
  let moveOpen = $state(false);
  let moveTrack = $state(NEW);
  let newName = $state('');
  let mix = $state(true);
  let moving = $state(false);

  const trackName = (id: string | null) => tracks.find((tr) => tr.id === id)?.name;
  const chosen = $derived(files.filter((f) => selected.includes(f.id)));
  const movable = $derived(chosen.length > 0 && chosen.every((f) => f.canChange && isAudioFile(f.originalFileName, f.mimeType)));
  const anyChangeable = $derived(files.some((f) => f.canChange));

  onDestroy(() => audio?.pause());

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
  }

  async function play(file: ProjectFile) {
    audio?.pause();
    if (playing === file.id) {
      playing = null;
      return;
    }
    const { url } = await api.get<{ url: string }>(`/files/${file.id}/stream-url`);
    audio = new Audio(url);
    audio.onended = () => (playing = null);
    playing = file.id;
    await audio.play().catch(() => (playing = null));
  }

  async function download(file: ProjectFile) {
    const { url } = await api.get<{ url: string }>(`/files/${file.id}/download-url`);
    window.location.href = url;
  }

  async function remove(file: ProjectFile) {
    if (playing === file.id) audio?.pause();
    await api.delete(`/files/${file.id}`);
    selected = selected.filter((id) => id !== file.id);
    toastSuccess(t().workspace.files.trashed(file.originalFileName));
    onChange();
  }

  function openMove() {
    moveTrack = NEW;
    newName = '';
    mix = chosen.length > 1;
    moveOpen = true;
  }

  async function move() {
    moving = true;
    try {
      let trackId = moveTrack;
      if (trackId === NEW) {
        const { track } = await api.post<{ track: { id: string } }>(`/tracks/${projectId}`, { name: newName.trim() || t().track.drop.newSongName });
        trackId = track.id;
      }
      for (const file of chosen) await api.post(`/files/${file.id}/stem`, { trackId, mix });
      toastSuccess(t().workspace.files.moved(chosen.length));
      selected = [];
      moveOpen = false;
      onChange({ tracks: true });
    } catch {
      // The API client already showed the error
    } finally {
      moving = false;
    }
  }
</script>

{#if !files.length}
  <p class="empty">{t().workspace.files.empty}</p>
{:else}
  <ul class="files">
    {#each files as file (file.id)}
      <li class:sel={selected.includes(file.id)}>
        {#if anyChangeable}
          <input type="checkbox" checked={selected.includes(file.id)} disabled={!file.canChange} onchange={() => toggle(file.id)} aria-label={t().workspace.files.select(file.originalFileName)} />
        {/if}
        {#if file.playable}
          <button type="button" class="play" onclick={() => play(file)} aria-label={playing === file.id ? t().workspace.files.pause(file.originalFileName) : t().workspace.files.play(file.originalFileName)}>
            <Icon name={playing === file.id ? 'pause' : 'play'} size={14} />
          </button>
        {:else}
          <span class="icon"><Icon name="layers" size={16} /></span>
        {/if}
        <div class="text">
          <b>{file.originalFileName}</b>
          <small>
            {formatFileSize(file.fileSize)} · {file.createdByName} · {formatDate(file.createdAt)}{#if trackName(file.trackId)} · {t().workspace.files.with(trackName(file.trackId)!)}{/if}
          </small>
        </div>
        {#if canDownload}
          <Button variant="ghost" size="sm" onclick={() => download(file)} title={t().workspace.files.download(file.originalFileName)}><Icon name="download" size={14} /></Button>
        {/if}
        {#if file.canChange}
          <Button variant="ghost" size="sm" onclick={() => remove(file)} title={t().workspace.files.remove(file.originalFileName)}><Icon name="trash" size={14} /></Button>
        {/if}
      </li>
    {/each}
  </ul>
  {#if selected.length}
    <div class="bar" role="region" aria-label={t().workspace.files.selection}>
      <span>{t().workspace.files.selected(selected.length)}</span>
      <Button size="sm" disabled={!movable} onclick={openMove}>{t().workspace.files.toStems}</Button>
      <Button variant="ghost" size="sm" onclick={() => (selected = [])}>{t().common.cancel}</Button>
    </div>
    {#if !movable}<p class="hint">{t().workspace.files.onlyAudio}</p>{/if}
  {/if}
{/if}

<Modal bind:open={moveOpen} title={t().workspace.files.toStems}>
  <div class="move">
    <label>
      <span>{t().workspace.files.song}</span>
      <select bind:value={moveTrack}>
        <option value={NEW}>{t().workspace.files.newSong}</option>
        {#each tracks as track (track.id)}<option value={track.id}>{track.name}</option>{/each}
      </select>
    </label>
    {#if moveTrack === NEW}
      <label>
        <span>{t().workspace.files.songName}</span>
        <input bind:value={newName} placeholder={t().track.drop.newSongName} />
      </label>
    {/if}
    <label class="check">
      <input type="checkbox" bind:checked={mix} />
      <span>{t().track.drop.choiceMix}<small>{t().workspace.files.mixHint}</small></span>
    </label>
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (moveOpen = false)}>{t().common.cancel}</Button>
    <Button loading={moving} onclick={move}>{t().workspace.files.moveConfirm(chosen.length)}</Button>
  {/snippet}
</Modal>

<style>
  .empty {
    color: var(--color-text-secondary);
    margin: var(--space-4) 0;
  }
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-raised);
  }
  li.sel {
    border-color: var(--color-accent);
    background: var(--color-accent-subtle);
  }
  input[type='checkbox'] {
    width: 18px;
    height: 18px;
    accent-color: var(--color-accent);
    flex: none;
  }
  .play,
  .icon {
    width: 32px;
    height: 32px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
  }
  .play {
    border: 0;
    background: var(--color-text-primary);
    color: var(--color-bg-base);
    cursor: pointer;
  }
  .icon {
    border-radius: var(--radius-sm);
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .text b {
    overflow-wrap: anywhere;
    font-weight: 500;
  }
  .text small {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }
  .bar {
    position: sticky;
    bottom: var(--space-4);
    margin-top: var(--space-4);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-lg);
    background: var(--color-bg-overlay);
    box-shadow: var(--shadow-md);
  }
  .bar span {
    margin-right: auto;
    color: var(--color-text-secondary);
  }
  .hint {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .move {
    display: grid;
    gap: var(--space-4);
  }
  .move label {
    display: grid;
    gap: var(--space-1);
  }
  .move label > span {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .move select,
  .move input:not([type='checkbox']) {
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: 16px;
  }
  .move .check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .move .check span {
    color: var(--color-text-primary);
    display: grid;
    gap: 2px;
  }
  .move .check small {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
</style>
