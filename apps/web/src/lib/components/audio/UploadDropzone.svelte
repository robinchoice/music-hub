<script lang="ts">
  import { SUPPORTED_EXTENSIONS, MAX_FILE_SIZE } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';

  let {
    trackId,
    onUploaded,
  }: {
    trackId: string;
    onUploaded: () => void;
  } = $props();

  let dragOver = $state(false);
  let uploading = $state(false);
  let progress = $state(0);
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
    const file = e.dataTransfer?.files[0];
    if (file) uploadFile(file);
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) uploadFile(file);
    input.value = '';
  }

  async function uploadFile(file: File) {
    error = '';

    if (file.size > MAX_FILE_SIZE) {
      error = 'File too large (max 500 MB)';
      return;
    }

    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext as any)) {
      error = `Unsupported format. Use: ${SUPPORTED_EXTENSIONS.join(', ')}`;
      return;
    }

    uploading = true;
    progress = 0;

    try {
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
      });

      label = '';
      onUploaded();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Upload failed';
    } finally {
      uploading = false;
      progress = 0;
    }
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
      placeholder="Version label (e.g. 'Mix V2', 'Master Final')"
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
      accept=".wav,.mp3,.flac,.aiff,.aif"
      onchange={handleFileSelect}
      hidden
    />

    {#if uploading}
      <div class="progress-container">
        <div class="progress-bar" style="width: {progress}%"></div>
        <span class="progress-text">{progress}%</span>
      </div>
    {:else}
      <div class="dropzone-content">
        <span class="dropzone-icon">🎵</span>
        <p>Drop audio file here or click to browse</p>
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
    border: 1px solid #333;
    background: #0a0a0a;
    color: #e0e0e0;
    font-size: 0.9rem;
  }

  .dropzone {
    border: 2px dashed #333;
    border-radius: 12px;
    padding: 2rem;
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
    border-color: #6366f1;
  }

  .dropzone-content p {
    margin: 0.5rem 0 0.25rem;
    color: #ccc;
  }

  .dropzone-icon {
    font-size: 2rem;
  }

  .formats {
    font-size: 0.8rem;
    color: #666;
  }

  .progress-container {
    position: relative;
    height: 40px;
    background: #222;
    border-radius: 8px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: #6366f1;
    transition: width 0.2s;
    border-radius: 8px;
  }

  .progress-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #fff;
    font-weight: 500;
    font-size: 0.9rem;
  }

  .error {
    color: #ef4444;
    font-size: 0.9rem;
  }
</style>
