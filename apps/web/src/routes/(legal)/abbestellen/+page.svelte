<script lang="ts">
  import { page } from '$app/stores';
  import Button from '$lib/components/ui/Button.svelte';

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
  <title>Mails abbestellen — Music Hub</title>
</svelte:head>

{#if updates}
  <h1>Updates per Mail</h1>
  {#if state === 'done'}
    <p>Abbestellt. Music Hub schickt dir keine Updates zu neuen Funktionen mehr. Login-Mails kommen weiter, wenn du sie anforderst.</p>
    <Button variant="secondary" onclick={resubscribe}>Doch wieder bestellen</Button>
  {:else if state === 'again'}
    <p>Wieder bestellt. Du bekommst wieder Updates zu neuen Funktionen.</p>
  {:else}
    <p>Du bekommst eine Mail, wenn Music Hub neue Funktionen hat, höchstens ein paar Mal im Monat.</p>
    {#if state === 'error'}
      <p>Das hat nicht geklappt. Versuch es noch einmal oder schalte die Updates in deinem Konto aus.</p>
    {/if}
    <Button onclick={unsubscribe} loading={state === 'busy'}>Abbestellen</Button>
  {/if}
{:else}
  <h1>Mails zu Versionen und Rückmeldungen</h1>
  {#if state === 'done'}
    <p>Abbestellt. Du bekommst keine Mails zu neuen Versionen und Rückmeldungen mehr. In deinem Konto kannst du sie wieder einschalten.</p>
  {:else}
    <p>Du bekommst eine Mail, wenn in deinen Projekten neue Versionen hochgeladen werden oder jemand mit deiner Version fertig ist und du keinen Push aktiviert hast.</p>
    {#if state === 'error'}
      <p>Das hat nicht geklappt. Versuch es noch einmal oder schalte die Mails in deinem Konto aus.</p>
    {/if}
    <Button onclick={unsubscribe} loading={state === 'busy'}>Abbestellen</Button>
  {/if}
{/if}
