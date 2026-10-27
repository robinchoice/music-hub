<script lang="ts">
  import { page } from '$app/stores';
  import Button from '$lib/components/ui/Button.svelte';
  import { t } from '$lib/i18n/index.js';

  // ?liste=updates comes from the update mails, without it from the version mails
  const updates = $page.url.searchParams.get('liste') === 'updates';
  const token = encodeURIComponent($page.url.searchParams.get('t') ?? '');

  // A button instead of unsubscribing on load: mail scanners open links, but don't click
  let state = $state<'idle' | 'busy' | 'done' | 'error' | 'again'>('idle');

  async function unsubscribe() {
    state = 'busy';
    const path = updates ? '/api/v1/updates/unsubscribe' : '/api/v1/notices/unsubscribe';
    const res = await fetch(`${path}?t=${token}`, { method: 'POST' }).catch(() => null);
    state = res?.ok ? 'done' : 'error';
  }

  async function resubscribe() {
    state = 'busy';
    const res = await fetch(`/api/v1/updates/subscribe?t=${token}`, { method: 'POST' }).catch(() => null);
    state = res?.ok ? 'again' : 'error';
  }
</script>

<svelte:head>
  <title>{t().landing.unsubscribe.title}</title>
</svelte:head>

{#if updates}
  <h1>{t().landing.unsubscribe.updatesTitle}</h1>
  {#if state === 'done'}
    <p>{t().landing.unsubscribe.updatesDone}</p>
    <Button variant="secondary" onclick={resubscribe}>{t().landing.unsubscribe.resubscribe}</Button>
  {:else if state === 'again'}
    <p>{t().landing.unsubscribe.updatesAgain}</p>
  {:else}
    <p>{t().landing.unsubscribe.updatesIdle}</p>
    {#if state === 'error'}
      <p>{t().landing.unsubscribe.updatesError}</p>
    {/if}
    <Button onclick={unsubscribe} loading={state === 'busy'}>{t().landing.unsubscribe.unsubscribe}</Button>
  {/if}
{:else}
  <h1>{t().landing.unsubscribe.noticesTitle}</h1>
  {#if state === 'done'}
    <p>{t().landing.unsubscribe.noticesDone}</p>
  {:else}
    <p>{t().landing.unsubscribe.noticesIdle}</p>
    {#if state === 'error'}
      <p>{t().landing.unsubscribe.noticesError}</p>
    {/if}
    <Button onclick={unsubscribe} loading={state === 'busy'}>{t().landing.unsubscribe.unsubscribe}</Button>
  {/if}
{/if}
