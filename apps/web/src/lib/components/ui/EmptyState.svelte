<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    icon,
    title,
    description,
    action,
  }: {
    icon?: string;
    title: string;
    description?: string;
    action?: Snippet;
  } = $props();
</script>

<div class="empty-state">
  {#if icon}<span class="icon">{icon}</span>{/if}
  <h3>{title}</h3>
  {#if description}
    <p>{description}</p>
  {/if}
  {#if action}
    <div class="action">
      {@render action()}
    </div>
  {/if}
</div>

<style>
  .empty-state {
    text-align: center;
    padding: var(--space-12) var(--space-4);
    color: var(--color-text-tertiary);
  }

  .icon {
    font-size: 2.5rem;
    display: block;
    margin-bottom: var(--space-3);
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-base);
    color: var(--color-text-secondary);
  }

  p {
    margin: 0;
    font-size: var(--text-sm);
  }

  .action {
    margin-top: var(--space-4);
  }
</style>
