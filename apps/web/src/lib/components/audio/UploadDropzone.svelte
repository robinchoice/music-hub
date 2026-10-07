<script lang="ts">
  import { SUPPORTED_EXTENSIONS, MAX_FILE_SIZE } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import Icon from '$lib/components/ui/Icon.svelte';

  let {
    trackId,
    parentVersionId = null,
    branchLabel = null,
    onUploaded,
  }: {
    trackId: string;
    parentVersionId?: string | null;
    branchLabel?: string | null;
    onUploaded: (count: number) => void;
  } = $props();

  let dragOver = $state(false);
  let uploading = $state(false);
  let progress = $state(0);
  let current = $state(0);
  let total = $state(0);
  let error = $state('');
  let label = $state('');

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
    error = '';

    const tooBig = selected.filter((f) => f.size > MAX_FILE_SIZE);
    if (tooBig.length > 0) {
      error = `${tooBig.map((f) => f.name).join(', ')} zu groß (max 500 MB)`;
      return;
    }

    const unsupported = selected.filter(
      (f) => !SUPPORTED_EXTENSIONS.includes(('.' + f.name.split('.').pop()?.toLowerCase()) as any),
    );
    if (unsupported.length > 0) {
      error = `${unsupported.map((f) => f.name).join(', ')}: Format nicht unterstützt. Erlaubt: ${SUPPORTED_EXTENSIONS.join(', ')}`;
      return;
    }

    selected.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    uploading = true;
    total = selected.length;

    try {
      const readable = await Promise.all(selected.map((f) => f.slice(0, 1).arrayBuffer().then(() => true, () => false)));
      const unreadable = selected.filter((_, i) => !readable[i]);
      if (unreadable.length > 0) {
        error = `Der Browser konnte ${unreadable.length === 1 ? 'diese Datei' : 'diese Dateien'} nicht lesen: ${unreadable.map((f) => f.name).join(', ')}. Es wurde nichts hochgeladen.`;
        return;
      }

      // One after another: the API assigns version numbers as max + 1
      for (const [i, file] of selected.entries()) {
        current = i + 1;
        progress = 0;
        await uploadFile(file);
      }

      label = '';
      onUploaded(total);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload fehlgeschlagen';
      error =
        total > 1
          ? `${selected[current - 1].name}: ${message} (${current - 1} von ${total} hochgeladen)`
          : message;
    } finally {
      uploading = false;
      progress = 0;
    }
  }

  async function uploadFile(file: File) {
    // 1. Get presigned upload URL
    const { uploadUrl, fileKey } = await api.post<{
      uploadUrl: string;
      fileKey: string;
      versionId: string;
    }>(`/versions/track/${trackId}/upload-url`, {
      fileName: file.name,
      mimeType: file.type || 'audio/wav',
      fileSize: file.size,
    });

    // 2. Upload directly to S3
    await uploadWithProgress(uploadUrl, file);

    // 3. Register version
    await api.post(`/versions/track/${trackId}`, {
      fileKey,
      label: label || undefined,
      originalFileName: file.name,
      mimeType: file.type || 'audio/wav',
      fileSize: file.size,
      parentVersionId: parentVersionId ?? undefined,
      branchLabel: branchLabel ?? undefined,
    });
  }

  function uploadWithProgress(url: string, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type || 'audio/wav');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          progress = Math.round((e.loaded / e.total) * 100);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed: ${xhr.status}`));
      };

      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(file);
    });
  }
</script>

<div class="upload-section">
  <div class="label-input">
    <input
      type="text"
      bind:value={label}
      placeholder="Versions-Bezeichnung (z.B. 'Mix V2', 'Final Master')"
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
      <div class="progress-container">
        <div class="progress-bar" style="width: {progress}%"></div>
        <span class="progress-text">{total > 1 ? `${current}/${total} · ` : ''}{progress}%</span>
      </div>
    {:else}
      <div class="dropzone-content">
        <span class="dropzone-icon"><Icon name="upload" size={28} /></span>
        <p>Audio-Dateien hier ablegen oder klicken zum Auswählen</p>
        <span class="formats">WAV, MP3, FLAC, AIFF — max 500 MB</span>
      </div>
    {/if}
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}
</div>

<style>
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
