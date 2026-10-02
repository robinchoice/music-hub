<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api/client.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';

  // The plugin opens this page with its code already filled in
  let code = $state($page.url.searchParams.get('code') ?? '');
  let client = $state<string | null>(null);
  let found = $state(false);
  let approved = $state(false);
  let loading = $state(false);
  let error = $state('');

  async function lookup() {
    error = '';
    loading = true;
    try {
      const res = await api.get<{ client: string | null }>(
        `/auth/device/${encodeURIComponent(code.trim())}`,
        true,
      );
      client = res.client;
      found = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Code ungültig';
    } finally {
      loading = false;
    }
  }

  async function approve() {
    error = '';
    loading = true;
    try {
      await api.post('/auth/device/approve', { userCode: code.trim() }, true);
      approved = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Freigabe fehlgeschlagen';
    } finally {
      loading = false;
    }
  }

  function reset() {
    found = false;
    client = null;
    code = '';
    error = '';
  }

  onMount(() => {
    if (code) lookup();
  });
</script>

<TopBar crumbs={[{ label: 'Gerät verbinden' }]} />

<div class="page">
  <section class="card">
    <h1>Gerät verbinden</h1>
    {#if approved}
      <p class="done">Verbunden. Du kannst zurück zu {client ?? 'deinem Plugin'} wechseln.</p>
    {:else if found}
      <p class="hint">{client ?? 'Ein Plugin'} möchte sich mit deinem Konto verbinden.</p>
      <p class="code">{code}</p>
      {#if error}
        <p class="error">{error}</p>
      {/if}
      <div class="actions">
        <Button size="lg" onclick={approve} {loading}>Verbinden</Button>
        <Button variant="ghost" onclick={reset}>Anderer Code</Button>
      </div>
    {:else}
      <form onsubmit={(e) => { e.preventDefault(); lookup(); }}>
        <p class="hint">Gib den Code ein, den dir das Plugin anzeigt.</p>
        <Input bind:value={code} placeholder="XXXX-XXXX" label="Code" {error} autofocus />
        <Button type="submit" size="lg" {loading} disabled={!code.trim()}>Weiter</Button>
      </form>
    {/if}
  </section>
</div>

<style>
  .page {
    padding: var(--space-6);
    max-width: 480px;
  }
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4);
    }
  }
  .card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }
  h1 {
    margin: 0 0 var(--space-4);
    font-size: var(--text-2xl);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .hint {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }
  .code {
    font-size: var(--text-2xl);
    font-weight: 600;
    letter-spacing: 0.15em;
    margin: var(--space-4) 0;
  }
  .error {
    color: var(--color-error);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-3);
  }
  .done {
    margin: 0;
  }
  .actions {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }
</style>
