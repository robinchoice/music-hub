<script lang="ts">
  import { onMount } from 'svelte';
  import { dateLocale, t } from '$lib/i18n/index.js';
  import { api } from '$lib/api/client.js';
  import Button from '$lib/components/ui/Button.svelte';

  let connections = $state<{ id: string; client: string; expiresAt: string }[]>([]);
  let loaded = $state(false);
  let error = $state('');
  let revoking = $state('');
  onMount(async () => {
    try {
      connections = (await api.get<{ connections: typeof connections }>('/mcp/connections', true)).connections;
      loaded = true;
    } catch (err) { error = err instanceof Error ? err.message : t().common.failed; }
  });
  async function revoke(id: string) {
    revoking = id;
    try {
      await api.delete(`/mcp/connections/${id}`);
      connections = connections.filter((c) => c.id !== id);
    } catch {
      // The API client already showed the error.
    } finally { revoking = ''; }
  }
</script>
<section>
  <h2>{t().mcp.title}</h2>
  <p>{t().mcp.hint}</p>
  <p>{t().mcp.privacy}</p>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if loaded && !connections.length}<p>{t().mcp.none}</p>{/if}
  {#each connections as connection (connection.id)}
    <div class="connection">
      <div><strong>{connection.client}</strong><p>{t().mcp.expires}: {new Date(connection.expiresAt).toLocaleDateString(dateLocale())}</p></div>
      <Button variant="ghost" onclick={() => revoke(connection.id)} loading={revoking === connection.id} disabled={!!revoking}>{t().mcp.revoke}</Button>
    </div>
  {/each}
</section>
<style>
  section { margin-bottom: var(--space-6); padding: var(--space-6); background: var(--color-bg-raised); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
  h2 { margin: 0 0 var(--space-4); font-size: var(--text-lg); }
  p { font-size: var(--text-sm); }
  .connection { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-4); }
  strong { overflow-wrap: anywhere; }
  [role='alert'] { color: var(--color-error); }
</style>
