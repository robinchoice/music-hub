<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';

  let name = $state('');
  let artist = $state('');
  let description = $state('');
  let loading = $state(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    loading = true;
    try {
      const res = await api.post<{ project: { id: string } }>('/projects', {
        name,
        artist: artist.trim() || null,
        description: description || undefined,
      });
      toastSuccess('Projekt erstellt');
      goto(`/projects/${res.project.id}`);
    } finally {
      loading = false;
    }
  }
</script>

<TopBar
  crumbs={[
    { label: 'Projekte', href: '/dashboard' },
    { label: 'Neues Projekt' },
  ]}
/>

<div class="page">
  <div class="card">
    <h1>Neues Projekt</h1>

    <form onsubmit={handleSubmit}>
      <Input label="Artist" bind:value={artist} placeholder="z.B. Anna Berger (optional)" />
      <Input label="Name" bind:value={name} placeholder="Mein Album" />

      <div class="textarea-group">
        <label class="textarea-label">Beschreibung (optional)</label>
        <textarea bind:value={description} placeholder="Worum geht's in diesem Projekt?" rows="3"></textarea>
      </div>

      <div class="actions">
        <Button variant="secondary" href="/dashboard">Abbrechen</Button>
        <Button type="submit" {loading}>Anlegen</Button>
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

  .textarea-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .textarea-label {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
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
