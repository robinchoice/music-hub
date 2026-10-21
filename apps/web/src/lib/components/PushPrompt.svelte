<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { pushStore, initPush, subscribePush } from '$lib/stores/push.svelte.js';

  // Asks for push where there is a reason to; the browser asks only after the click.
  // "Nicht jetzt" hides it everywhere on this device, the account page still offers it.
  let { text }: { text: string } = $props();

  let dismissed = $state(true);

  onMount(() => {
    dismissed = localStorage.getItem('push-prompt') === 'dismissed';
    if (!dismissed) void initPush();
  });

  function dismiss() {
    localStorage.setItem('push-prompt', 'dismissed');
    dismissed = true;
  }
</script>

{#if !dismissed && pushStore.state === 'unsubscribed'}
  <aside class="push-prompt">
    <Icon name="bell" size={16} />
    <p>{text}</p>
    <div class="actions">
      <Button size="sm" onclick={subscribePush} loading={pushStore.loading}>Benachrichtigen</Button>
      <Button size="sm" variant="ghost" onclick={dismiss}>Nicht jetzt</Button>
    </div>
  </aside>
{/if}

<style>
  .push-prompt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: var(--margin, 0);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-raised);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  p {
    flex: 1;
    min-width: 200px;
    margin: 0;
  }
  .actions {
    display: flex;
    gap: var(--space-1);
  }
</style>
