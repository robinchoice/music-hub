<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { getContext } from 'svelte';

  let {
    crumbs = [],
    actions,
  }: {
    crumbs?: { label: string; href?: string }[];
    actions?: Snippet;
  } = $props();

  const openMobileMenu = getContext<() => void>('openMobileMenu');
</script>

<header class="topbar">
  <button class="hamburger" onclick={() => openMobileMenu?.()} aria-label="Menü öffnen">
    <Icon name="menu" size={20} />
  </button>
  <nav class="crumbs" aria-label="Breadcrumb">
    {#each crumbs as crumb, i}
      {#if crumb.href && i < crumbs.length - 1}
        <a href={crumb.href}>{crumb.label}</a>
      {:else}
        <span class="current">{crumb.label}</span>
      {/if}
      {#if i < crumbs.length - 1}
        <span class="sep">/</span>
      {/if}
    {/each}
  </nav>

  {#if actions}
    <div class="actions">
      {@render actions()}
    </div>
  {/if}
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    border-bottom: 1px solid var(--color-border);
    background: rgba(10, 9, 16, 0.85);
    position: sticky;
    top: 0;
    z-index: 10;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .crumbs {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .crumbs a {
    color: var(--color-text-tertiary);
    text-decoration: none;
    transition: color var(--transition-fast);
  }
  .crumbs a:hover {
    color: var(--color-text-primary);
  }
  .crumbs .current {
    color: var(--color-text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sep {
    color: var(--color-text-tertiary);
    opacity: 0.5;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .hamburger {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 6px;
    border-radius: var(--radius-sm);
    display: none;
    align-items: center;
    justify-content: center;
  }
  .hamburger:hover {
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
  }

  @media (max-width: 880px) {
    .topbar {
      padding: var(--space-3) var(--space-4);
    }
    .hamburger {
      display: inline-flex;
    }
    /* Hide all but the last crumb on tight viewports */
    .crumbs a,
    .crumbs .sep {
      display: none;
    }
    .crumbs a:last-of-type,
    .crumbs .current {
      display: inline;
    }
  }
  @media (max-width: 540px) {
    .topbar {
      padding: var(--space-3);
      gap: var(--space-2);
    }
  }
</style>
