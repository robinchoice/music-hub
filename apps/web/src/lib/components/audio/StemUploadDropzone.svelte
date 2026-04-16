<script lang="ts">
  import { MAX_FILE_SIZE } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import Icon from '$lib/components/ui/Icon.svelte';

  let { trackId, onUploaded }: { trackId: string; onUploaded: () => void } = $props();

  let dragOver = $state(false);
  let files = $state<{ name: string; progress: number; error: string }[]>([]);
  let uploading = $state(false);
  let globalError = $state('');

  function stemNameFromFile(fileName: string) {
    return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }

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
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0) uploadFiles(Array.from(dropped));
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) uploadFiles(Array.from(input.files));
    input.value = '';
  }

  async function uploadFiles(selected: File[]) {
    globalError = '';
    const tooBig = selected.filter((f) => f.size > MAX_FILE_SIZE);
    if (tooBig.length > 0) {
      globalError = `${tooBig.map((f) => f.name).join(', ')} zu groß (max 500 MB)`;
      return;
    }

    uploading = true;
    files = selected.map((f) => ({ name: f.name, progress: 0, error: '' }));

    // Upload in batches of 3
    for (let i = 0; i < selected.length; i += 3) {
      const batch = selected.slice(i, i + 3);
      await Promise.all(batch.map((file, j) => uploadOne(file, i + j)));
    }

    uploading = false;
    const anyError = files.some((f) => f.error);
    if (!anyError) {
      files = [];
      onUploaded();
    }
  }

  async function uploadOne(file: File, idx: number) {
    let step = 'URL';
    try {
      const mimeType = file.type || 'audio/wav';
      const { uploadUrl, fileKey } = await api.post<{ uploadUrl: string; fileKey: string }>(
        `/stems/track/${trackId}/upload-url`,
        { fileName: file.name, mimeType, fileSize: file.size },
      );

      step = 'S3';
      await uploadWithProgress(uploadUrl, file, mimeType, (p) => {
        files[idx].progress = p;
      });

      step = 'DB';
      await api.post(`/stems/track/${trackId}`, {
        fileKey,
        name: stemNameFromFile(file.name),
        originalFileName: file.name,
        mimeType,
        fileSize: file.size,
      });

      files[idx] = { ...files[idx], progress: 100 };
    } catch (err) {
      files[idx] = { ...files[idx], error: `[${step}] ${err instanceof Error ? err.message : 'Fehler'}` };
    }
  }

  function uploadWithProgress(url: string, file: File, mimeType: string, onProgress: (p: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', mimeType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
      xhr.onerror = () => reject(new Error('Upload fehlgeschlagen'));
      xhr.send(file);
    });
  }
</script>

<div class="stem-upload">
  <div
    class="dropzone"
    class:dragover={dragOver}
    class:uploading
    role="button"
    tabindex="0"
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    onclick={() => !uploading && document.getElementById(`stem-input-${trackId}`)?.click()}
    onkeydown={(e) => e.key === 'Enter' && !uploading && document.getElementById(`stem-input-${trackId}`)?.click()}
  >
    <input
      id="stem-input-{trackId}"
      type="file"
      accept="audio/*"
      multiple
      onchange={handleFileSelect}
      style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;"
    />
    <div class="dropzone-content">
      <span class="icon"><Icon name="upload" size={24} /></span>
      <p>STEMs hier ablegen oder klicken</p>
      <span class="hint">Mehrere Dateien gleichzeitig möglich · WAV, MP3, FLAC, AIFF · max 500 MB</span>
    </div>
  </div>

  {#if files.length > 0}
    <div class="file-list">
      {#each files as f}
        <div class="file-row" class:done={f.progress === 100} class:error={!!f.error}>
          <span class="file-name">{f.name}</span>
          {#if f.error}
            <span class="file-error">{f.error}</span>
          {:else}
            <div class="file-progress">
              <div class="file-bar" style="width: {f.progress}%"></div>
            </div>
            <span class="file-pct">{f.progress}%</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if globalError}
    <p class="error">{globalError}</p>
  {/if}
</div>

<style>
  .stem-upload {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .dropzone {
    border: 2px dashed #333;
    border-radius: 12px;
    padding: 1.5rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: #111;
  }

  .dropzone:hover,
  .dropzone.dragover {
    border-color: #6366f1;
    background: #1a1a2e;
  }

  .dropzone.uploading {
    cursor: default;
    pointer-events: none;
  }

  .dropzone-content p {
    margin: 0.4rem 0 0.2rem;
    color: #ccc;
    font-size: 0.9rem;
  }

  .icon {
    color: var(--color-text-tertiary);
    display: inline-flex;
  }

  .hint {
    font-size: 0.78rem;
    color: #666;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.82rem;
  }

  .file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
  }

  .file-progress {
    width: 80px;
    height: 4px;
    background: #222;
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .file-bar {
    height: 100%;
    background: #6366f1;
    transition: width 0.2s;
  }

  .file-row.done .file-bar {
    background: #22c55e;
  }

  .file-pct {
    width: 30px;
    text-align: right;
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .file-error {
    color: #ef4444;
    font-size: 0.78rem;
  }

  .error {
    color: #ef4444;
    font-size: 0.85rem;
  }
</style>
