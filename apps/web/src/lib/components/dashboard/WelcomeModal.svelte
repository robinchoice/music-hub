<script lang="ts">
  import { goto } from '$app/navigation';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { api } from '$lib/api/client.js';
  import { toastSuccess, toastError } from '$lib/stores/toast.js';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let loading = $state(false);

  async function loadDemo() {
    loading = true;
    try {
      const res = await api.post<{ projectId: string }>('/onboarding/seed-demo');
      toastSuccess('Demo-Projekt erstellt');
      open = false;
      await goto(`/projects/${res.projectId}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Konnte Demo nicht laden');
    } finally {
      loading = false;
    }
  }

  function startBlank() {
    open = false;
    goto('/projects/new');
  }
</script>

<Modal bind:open title="Willkommen bei Music Hub">
  <div class="welcome">
    <p class="lede">
      Starte mit einem <strong>Demo-Projekt</strong> um sofort zu sehen wie alles funktioniert —
      mit Versionen, Comments, Wellenform-Player und Share-Link.
    </p>
    <p class="lede">
      Oder leg gleich dein <strong>eigenes erstes Projekt</strong> an.
    </p>
    <ul class="features">
      <li>Du kannst das Demo jederzeit löschen</li>
      <li>Beide Wege bringen dich direkt ins Werkzeug</li>
    </ul>
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={startBlank}>Eigenes Projekt starten</Button>
    <Button onclick={loadDemo} {loading}>Demo laden</Button>
  {/snippet}
</Modal>

<style>
  .welcome {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .lede {
    margin: 0;
    color: var(--color-text-secondary);
    line-height: 1.55;
    font-size: var(--text-sm);
  }
  .lede strong {
    color: var(--color-text-primary);
  }
  .features {
    list-style: none;
    padding: 0;
    margin: var(--space-2) 0 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
  .features li {
    padding-left: 1em;
    position: relative;
  }
  .features li::before {
    content: '·';
    position: absolute;
    left: 0;
  }
</style>
