<script lang="ts">
  import { onMount } from 'svelte';
  import { SUPPORTED_EXTENSIONS } from '@music-hub/shared';
  import { MAX_FILE_SIZE_LABEL, byFileName, checkAudioFiles, unreadableFiles, uploadVersion } from '$lib/audio/upload.js';
  import { toast } from '$lib/stores/toast.js';
  import Icon from '$lib/components/ui/Icon.svelte';

  let {
    trackId,
    nextVersionNumber = 1,
    parentVersionId = null,
    branchLabel = null,
    initialFiles = [],
    onUploaded,
    onRegistering = () => {},
  }: {
    trackId: string;
    nextVersionNumber?: number;
    parentVersionId?: string | null;
    branchLabel?: string | null;
    /** Picked before the zone opened, they start uploading right away */
    initialFiles?: File[];
    onUploaded: (count: number) => void;
    onRegistering?: (saving: boolean) => void;
  } = $props();

  let dragOver = $state(false);
  let uploading = $state(false);
  let progress = $state(0);
  let current = $state(0);
  let total = $state(0);
  let error = $state('');
  let label = $state('');
  let files = $state<File[]>([]);
  let loaded = $state(0);
  let firstNumber = $state(1);
  const mb = (bytes: number) => (bytes / 1024 ** 2).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // The close button cancels the upload, so nothing turns up as a version later.
  // Plain variables: state read while the zone is being removed can still hold an old value.
  const abort = new AbortController();
  let inFlight = false;
  export function cancel() {
    if (!inFlight) return;
    abort.abort();
    toast('Upload abgebrochen');
  }

  onMount(() => {
    if (initialFiles.length > 0) uploadFiles(initialFiles);
  });

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (uploading) return;
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0) uploadFiles(Array.from(dropped));
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) uploadFiles(Array.from(input.files));
    input.value = '';
  }

  async function uploadFiles(selected: File[]) {
    error = checkAudioFiles(selected) ?? '';
    if (error) return;

    selected.sort(byFileName);
    files = selected;
    firstNumber = nextVersionNumber;
    uploading = true;
    inFlight = true;
    total = selected.length;

    try {
      const unreadable = await unreadableFiles(selected);
      if (unreadable.length > 0) {
        error = `Der Browser konnte ${unreadable.length === 1 ? 'diese Datei' : 'diese Dateien'} nicht lesen: ${unreadable.map((f) => f.name).join(', ')}. Es wurde nichts hochgeladen.`;
        return;
      }

      // One after another: the API assigns version numbers as max + 1
      for (const [i, file] of selected.entries()) {
        current = i + 1;
        progress = 0;
        loaded = 0;
        const done = await uploadVersion(trackId, file, {
          label,
          parentVersionId,
          branchLabel,
          onProgress: (p) => (progress = p),
          onBytes: (bytes) => (loaded = bytes),
          onRegister: () => onRegistering(true),
          signal: abort.signal,
        });
        onRegistering(false);
        if (!done) return;
      }

      label = '';
      inFlight = false;
      onUploaded(total);
    } catch (err) {
      if (abort.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Upload fehlgeschlagen';
      error =
        total > 1
          ? `${selected[current - 1].name}: ${message} (${current - 1} von ${total} hochgeladen)`
          : message;
    } finally {
      onRegistering(false);
      inFlight = false;
      uploading = false;
      progress = 0;
    }
  }
</script>

<svelte:window onbeforeunload={(e) => uploading && e.preventDefault()} />

<div class="upload-section">
  <div class="label-input">
    <input
      type="text"
      bind:value={label}
      aria-label="Versionsbezeichnung"
      placeholder="Versionsbezeichnung, z. B. „Rough Mix“"
      disabled={uploading}
    />
  </div>

  <div
    class="dropzone"
    class:dragover={dragOver}
    class:uploading
    role="button"
    tabindex="0"
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    onclick={() => !uploading && document.getElementById(`file-input-${trackId}`)?.click()}
    onkeydown={(e) => e.key === 'Enter' && !uploading && document.getElementById(`file-input-${trackId}`)?.click()}
  >
    <input
      id="file-input-{trackId}"
      type="file"
      accept={SUPPORTED_EXTENSIONS.join(',')}
      multiple
      onchange={handleFileSelect}
      hidden
    />

    {#if uploading}
      <div class="upload-files" aria-live="polite">
        {#if total > 1}<b>Datei {current || 1} von {total}</b>{/if}
        {#each files as file, i}
          <div class="upload-file">
            <b>{file.name}</b>
            <span>{mb(file.size)} MB · wird V{firstNumber + i}</span>
            {#if i + 1 === current}
              <div class="progress-container" role="progressbar" aria-label={file.name} aria-valuenow={progress} aria-valuemin="0" aria-valuemax="100">
                <div class="progress-bar" style="width: {progress}%"></div>
                <span class="progress-text">{mb(loaded)} von {mb(file.size)} MB</span>
              </div>
            {:else}<small>{i + 1 < current ? 'Hochgeladen' : 'Wartet'}</small>{/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="dropzone-content">
        <span class="dropzone-icon"><Icon name="upload" size={28} /></span>
        <p><span class="mouse">Audio-Dateien hierher ziehen oder klicken</span><span class="touch">Tippen, um Audio-Dateien auszuwählen</span></p>
        <span class="formats">WAV, MP3, FLAC, AIFF — max. {MAX_FILE_SIZE_LABEL}</span>
      </div>
    {/if}
  </div>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</div>

<style>
  .upload-files { display: grid; gap: var(--space-3); text-align: left; width: 100%; }
  .upload-file { display: grid; gap: var(--space-2); overflow-wrap: anywhere; }
  .upload-file span, .upload-file small { color: var(--color-text-secondary); font-size: var(--text-sm); }
  .upload-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .label-input input {
    width: 100%;
    padding: 0.6rem 1rem;
    border-radius: 8px;
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-size: 0.9rem;
  }

  .dropzone {
    border: 2px dashed var(--color-border-hover);
    border-radius: 12px;
    padding: 2rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: var(--color-bg-base);
  }

  .dropzone:hover,
  .dropzone.dragover {
    border-color: var(--color-accent);
    background: var(--color-accent-subtle);
  }

  .dropzone.uploading {
    cursor: default;
    border-color: var(--color-border-hover);
  }

  .dropzone-content p {
    margin: 0.5rem 0 0.25rem;
    color: var(--color-text-primary);
  }

  .dropzone-icon {
    color: var(--color-text-tertiary);
    display: inline-flex;
    margin-bottom: var(--space-2);
  }

  .formats {
    font-size: 0.8rem;
    color: var(--color-text-tertiary);
  }

  .progress-container {
    position: relative;
    height: 40px;
    background: var(--color-bg-overlay);
    border-radius: 8px;
    overflow: hidden;
  }

  /* Progress carries the gradient as a line, the number stays readable on the neutral ground */
  .progress-bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 4px;
    background: var(--gradient-accent);
    transition: width 0.2s;
  }

  .progress-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: var(--color-text-primary);
    font-weight: 500;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
  }

  .error {
    color: var(--color-error);
    font-size: 0.9rem;
  }
</style>
