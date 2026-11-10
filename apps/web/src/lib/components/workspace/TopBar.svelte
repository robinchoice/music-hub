<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { getContext } from 'svelte';
  import { t } from '$lib/i18n/index.js';

  let {
    crumbs = [],
    actions,
  }: {
    crumbs?: { label: string; href?: string }[];
    actions?: Snippet;
  } = $props();

  const openMobileMenu = getContext<() => void>('openMobileMenu');
  // Phones show only the current page; one step up stays a tap away, like a drive's back arrow
  const parent = $derived(crumbs.length > 1 ? crumbs[crumbs.length - 2] : null);
</script>

<header class="topbar">
  <button class="hamburger" onclick={() => openMobileMenu?.()} aria-label={t().workspace.nav.openMenu}>
    <Icon name="menu" size={20} />
  </button>
  {#if parent?.href}
    <a class="up" href={parent.href} title={parent.label} aria-label={parent.label}><Icon name="arrow-left" size={18} /></a>
  {/if}
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
    /* Same height on every page, the track page's sticky panel sits right below it */
    min-height: var(--topbar-height);
    padding: 0 var(--space-6);
    border-bottom: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-bg-base) 88%, transparent);
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

  /* In a tight bar the path above gives way before the name of the page */
  .crumbs a {
    flex-shrink: 4;
    min-width: 2.5em;
    color: var(--color-text-tertiary);
    text-decoration: none;
    transition: color var(--transition-fast);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .up {
    display: none;
    align-items: center;
    justify-content: center;
    padding: 6px;
    margin-right: calc(-1 * var(--space-2));
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
  }
  .up:hover {
    color: var(--color-text-primary);
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
      --topbar-height: 57px;
      padding: 0 var(--space-4);
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
      padding: 0 var(--space-3);
      gap: var(--space-2);
    }
    .crumbs a:last-of-type {
      display: none;
    }
    .up {
      display: inline-flex;
    }
  }
</style>
