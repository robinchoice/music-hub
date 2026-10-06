<script lang="ts">
  import { page } from '$app/stores';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import PersonView from '$lib/components/admin/PersonView.svelte';
</script>

<TopBar crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Nutzerliste', href: '/admin/users' }, { label: 'Person' }]} />

<div class="page">
  <div class="card">
    <PersonView userId={$page.params.userId!} />
  </div>
</div>

<style>
  .page {
    padding: var(--space-6);
    max-width: 1080px;
  }
  .card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
  }
</style>
