<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/index.js';
  import { api } from '$lib/api/client.js';
  import Button from '$lib/components/ui/Button.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';

  const request = Object.fromEntries($page.url.searchParams);
  let accountId = $state('');
  let accountEmail = $state('');
  let client = $state('');
  let redirectUri = $state('');
  let error = $state('');
  let loading = $state(false);

  onMount(async () => {
    try {
      const result = await api.get<{ client: string; redirectUri: string; account: { id: string; email: string } }>(`/oauth/request?${$page.url.searchParams}`, true);
      accountId = result.account.id;
      accountEmail = result.account.email;
      client = result.client;
      redirectUri = result.redirectUri;
    } catch { error = t().mcp.invalid; }
  });

  async function consent(allow: boolean) {
    loading = true;
    try {
      const result = await api.post<{ redirect: string }>('/oauth/authorize', { request, allow, accountId }, true);
      window.location.assign(result.redirect);
    } catch { error = t().mcp.invalid; loading = false; }
  }
</script>

<svelte:head><title>{t().mcp.consent} — Music Hub</title><meta name="referrer" content="no-referrer" /></svelte:head>
<TopBar crumbs={[{ label: t().mcp.consent }]} />
<div class="consent">
  <h1>{t().mcp.consent}</h1>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if client}
    <p><strong>{client}</strong> {t().mcp.wants}</p>
    <p>{accountEmail}</p>
    <p>{t().mcp.rights}</p>
    <p>{t().mcp.privacy}</p>
    <p class="callback">{t().mcp.callback}: {redirectUri}</p>
    <div class="actions">
      <Button onclick={() => consent(true)} {loading} disabled={!!error}>{t().mcp.connect}</Button>
      <Button variant="ghost" onclick={() => consent(false)} disabled={loading}>{t().mcp.deny}</Button>
    </div>
  {/if}
</div>
<style>
  .consent { max-width: 640px; padding: var(--space-6); overflow-wrap: anywhere; }
  h1 { font-size: var(--text-2xl); }
  .callback { overflow-wrap: anywhere; font-size: var(--text-sm); }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
  [role='alert'] { color: var(--color-error); }
  @media (max-width: 640px) { .consent { padding: var(--space-4); } }
</style>
