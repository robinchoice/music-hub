<script lang="ts">
  import { page } from '$app/stores';
  import Button from '$lib/components/ui/Button.svelte';

  // A button instead of unsubscribing on load: mail scanners open links, but don't click
  let state = $state<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function unsubscribe() {
    state = 'busy';
    const token = $page.url.searchParams.get('t') ?? '';
    const res = await fetch(`/api/v1/notices/unsubscribe?t=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => null);
    state = res?.ok ? 'done' : 'error';
  }
</script>

<svelte:head>
  <title>Mails abbestellen — Music Hub</title>
</svelte:head>

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
