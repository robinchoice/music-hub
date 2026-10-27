<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/index.js';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import CoverUpload from '$lib/components/ui/CoverUpload.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import { overviewIndex } from '$lib/stores/overview.js';
  import { artistNames, artistToSave } from '$lib/utils/overview.js';
  import ArtistInput from '$lib/components/workspace/ArtistInput.svelte';

  const reloadSidebar = getContext<(() => void) | undefined>('reloadSidebar');

  let name = $state('');
  // From "Neues Projekt" on an artist page
  let artist = $state($page.url.searchParams.get('artist') ?? '');
  let description = $state('');
  let loading = $state(false);
  let coverKey = $state<string | null>(null);
  // Local preview, the uploaded key only becomes readable once the project exists
  let coverPreview = $state<string | null>(null);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    loading = true;
    try {
      const res = await api.post<{ project: { id: string } }>('/projects', {
        name,
        artist: artistToSave($overviewIndex ? artistNames($overviewIndex) : [], artist),
        description: description || undefined,
        coverImageUrl: coverKey,
      });
      toastSuccess(t().workspace.newProject.created);
      reloadSidebar?.();
      goto(`/projects/${res.project.id}`);
    } catch {
      // The API client already showed the error
    } finally {
      loading = false;
    }
  }

  function setCover(key: string | null, file?: File) {
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    coverKey = key;
    coverPreview = file ? URL.createObjectURL(file) : null;
  }
</script>

<TopBar
  crumbs={[
    { label: t().workspace.nav.projects, href: '/dashboard' },
    { label: t().workspace.newProject.title },
  ]}
/>

<div class="page">
  <div class="card">
    <h1>{t().workspace.newProject.title}</h1>

    <form onsubmit={handleSubmit}>
      <ArtistInput bind:value={artist} />
      <Input label={t().common.name} bind:value={name} placeholder={t().workspace.newProject.namePlaceholder} />

      <label class="textarea-group">
        <span class="input-label">{t().workspace.newProject.description}</span>
        <textarea bind:value={description} placeholder={t().workspace.newProject.descriptionPlaceholder} rows="3"></textarea>
      </label>

      <div class="cover-group">
        <span class="input-label">{t().workspace.newProject.cover}</span>
        <CoverUpload currentUrl={coverPreview} {name} onChange={setCover} />
      </div>

      <div class="actions">
        <Button variant="secondary" href="/dashboard">{t().common.cancel}</Button>
        <Button type="submit" {loading} disabled={!name.trim()}>{t().workspace.newProject.create}</Button>
      </div>
    </form>
  </div>
</div>

<style>
  .page {
    display: flex;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
  }

  .card {
    background: var(--color-bg-overlay);
    border-radius: var(--radius-lg);
    padding: var(--space-8);
    width: 100%;
    max-width: 500px;
    border: 1px solid var(--color-border);
  }

  h1 {
    margin: 0 0 var(--space-6);
    font-size: var(--text-xl);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .cover-group,
  .textarea-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .cover-group {
    align-items: flex-start;
  }

  textarea {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-size: var(--text-base);
    font-family: inherit;
    resize: vertical;
  }

  textarea:focus {
    outline: none;
    border-color: var(--color-border-focus);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }
</style>
