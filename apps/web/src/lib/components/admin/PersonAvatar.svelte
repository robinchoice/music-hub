<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import type { Person } from '$lib/utils/admin.js';

  // Avatar with a dot while online; invited people who never logged in get an envelope
  let {
    person,
    size = 'md',
  }: {
    person: Pick<Person, 'name' | 'avatarUrl' | 'pending' | 'online'>;
    size?: 'sm' | 'md' | 'lg';
  } = $props();
</script>

<span class="pa {size}" class:pending={person.pending} title={person.pending ? 'Nie angemeldet' : undefined}>
  {#if person.pending}
    <Icon name="mail" size={size === 'lg' ? 18 : 13} />
  {:else}
    <Avatar name={person.name} src={person.avatarUrl} {size} />
    {#if person.online}<i class="dot" title="online"></i>{/if}
  {/if}
</span>

<style>
  .pa {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }
  .pending {
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1px dashed var(--color-border-hover);
    color: var(--color-text-tertiary);
  }
  .pending.sm { width: 24px; height: 24px; }
  .pending.md { width: 32px; height: 32px; }
  .pending.lg { width: 40px; height: 40px; }
  .dot {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-success);
    box-shadow: 0 0 0 2px var(--color-bg-raised);
  }
</style>
