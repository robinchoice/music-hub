<script lang="ts">
  import { t } from '$lib/i18n/index.js';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import { mimeOf, uploadToProject } from '$lib/audio/upload.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import ProjectFiles, { type ProjectFile } from '$lib/components/workspace/ProjectFiles.svelte';

  // Files of the project filed next to this track: DAW sessions, lyrics, references.
  // They are files of the project with trackId set, so the project's "Dateien" lists them too.
  let {
    projectId,
    trackId,
    files,
    tracks,
    canUpload,
    canDownload,
    onChange,
  }: {
    projectId: string;
    trackId: string;
    files: ProjectFile[];
    tracks: { id: string; name: string }[];
    canUpload: boolean;
    canDownload: boolean;
    onChange: (opts?: { tracks?: boolean }) => void;
  } = $props();

  let input = $state<HTMLInputElement>();
  let uploading = $state(false);

  async function upload(e: Event) {
    const picked = Array.from((e.target as HTMLInputElement).files ?? []);
    (e.target as HTMLInputElement).value = '';
    if (!picked.length) return;
    uploading = true;
    try {
      for (const file of picked) {
        const fileKey = await uploadToProject(projectId, file);
        if (!fileKey) continue;
        await api.post(`/files/project/${projectId}`, { fileKey, originalFileName: file.name, mimeType: mimeOf(file), trackId });
      }
      toastSuccess(t().track.files.uploaded(picked.length));
    } catch {
      // The API client already showed the error
    } finally {
      uploading = false;
      onChange();
    }
  }
</script>

<div class="track-files">
  <p class="hint">{t().track.files.hint}</p>
  {#if canUpload}
    <input bind:this={input} type="file" multiple hidden onchange={upload} />
    <Button variant="secondary" size="sm" loading={uploading} onclick={() => input?.click()}>
      <Icon name="upload" size={14} /> {t().track.files.upload}
    </Button>
  {/if}
  <ProjectFiles {projectId} {files} {canDownload} {tracks} here={trackId} compact {onChange} />
</div>

<style>
  .track-files {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
  }
  .track-files > :global(*) {
    width: 100%;
  }
  .track-files > :global(button) {
    width: auto;
  }
  .hint {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
</style>
