<script lang="ts">
  import { api } from '$lib/api/client.js';
  import { toastError } from '$lib/stores/toast.js';
  import CoverImage from './CoverImage.svelte';
  import Icon from './Icon.svelte';

  let {
    currentUrl = null,
    name = '',
    onChange,
  }: {
    currentUrl?: string | null;
    name?: string;
    // A new cover key with its file, or null when the cover is removed
    onChange: (key: string | null, file?: File) => void | Promise<void>;
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
      await onChange(key, file);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Upload fehlgeschlagen');
    } finally {
      uploading = false;
    }
  }

  async function remove() {
    uploading = true;
    try {
      await onChange(null);
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

<div class="cover-field">
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
      <span class="hint">{currentUrl ? 'Bild ändern' : 'Cover hinzufügen'}</span>
    {/if}
  </div>
</label>
{#if currentUrl}
  <button type="button" class="remove" onclick={remove} disabled={uploading}>Cover entfernen</button>
{/if}
</div>

<style>
  .cover-field {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }
  .remove {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-xs);
  }
  .remove:hover:not(:disabled) {
    color: var(--color-text-primary);
    text-decoration: underline;
  }
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
