<script lang="ts">
  import { api } from '$lib/api/client.js';
  import { toastError } from '$lib/stores/toast.js';
  import CoverImage from './CoverImage.svelte';
  import Icon from './Icon.svelte';

  let {
    currentUrl = null,
    name = '',
    onUploaded,
  }: {
    currentUrl?: string | null;
    name?: string;
    onUploaded: (key: string) => void | Promise<void>;
  } = $props();

  let uploading = $state(false);
  let dragOver = $state(false);
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX = 2 * 1024 * 1024;

  async function pickFile(file: File) {
    if (!ALLOWED.includes(file.type)) {
      toastError('Nur JPG, PNG oder WebP');
      return;
    }
    if (file.size > MAX) {
      toastError('Bild zu groß (max 2 MB)');
      return;
    }
    uploading = true;
    try {
      const { uploadUrl, key } = await api.post<{ uploadUrl: string; key: string }>(
        '/uploads/cover',
        { fileName: file.name, mimeType: file.type, fileSize: file.size },
      );
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      await onUploaded(key);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Upload fehlgeschlagen');
    } finally {
      uploading = false;
    }
  }

  function handleChange(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) pickFile(f);
    (e.target as HTMLInputElement).value = '';
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files[0];
    if (f) pickFile(f);
  }
</script>

<label
  class="cover-upload"
  class:drag={dragOver}
  ondragover={(e) => { e.preventDefault(); dragOver = true; }}
  ondragleave={() => (dragOver = false)}
  ondrop={handleDrop}
>
  <input type="file" accept="image/jpeg,image/png,image/webp" onchange={handleChange} hidden />
  <CoverImage src={currentUrl} {name} size="xl" rounded="lg" />
  <div class="overlay">
    {#if uploading}
      <span class="spinner"></span>
    {:else}
      <Icon name="upload" size={20} />
      <span class="hint">Bild ändern</span>
    {/if}
  </div>
</label>

<style>
  .cover-upload {
    position: relative;
    display: inline-block;
    cursor: pointer;
    border-radius: var(--radius-lg);
    overflow: hidden;
    isolation: isolate;
  }
  .overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    opacity: 0;
    transition: opacity var(--transition-fast);
  }
  .cover-upload:hover .overlay,
  .cover-upload.drag .overlay {
    opacity: 1;
  }
  .hint {
    font-size: var(--text-xs);
    font-weight: 500;
  }
  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
