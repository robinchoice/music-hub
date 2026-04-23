<script lang="ts">
  import { page } from '$app/stores';
  import { getContext } from 'svelte';
  import Icon from '$lib/components/ui/Icon.svelte';

  const openMobileMenu = getContext<() => void>('openMobileMenu');

  const isActive = (path: string) => $page.url.pathname === path || $page.url.pathname.startsWith(path + '/');
</script>

<nav class="bottom-nav" aria-label="Hauptnavigation">
  <a href="/dashboard" class="nav-item" class:active={$page.url.pathname === '/dashboard'} aria-label="Übersicht">
    <Icon name="home" size={22} />
    <span>Übersicht</span>
  </a>

  <button class="nav-item" onclick={() => openMobileMenu?.()} aria-label="Projekte">
    <Icon name="list" size={22} />
    <span>Projekte</span>
  </button>

  <a href="/projects/new" class="nav-item nav-new" aria-label="Neues Projekt">
    <span class="plus-ring">
      <Icon name="plus" size={20} />
    </span>
    <span>Neu</span>
  </a>

  <a href="/account" class="nav-item" class:active={isActive('/account')} aria-label="Konto">
    <Icon name="settings" size={22} />
    <span>Konto</span>
  </a>
</nav>

<style>
  .bottom-nav {
    display: none;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 90;
    background: rgba(10, 9, 16, 0.92);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid var(--color-border);
    padding: 0 var(--space-2) env(safe-area-inset-bottom, 0);
    height: calc(56px + env(safe-area-inset-bottom, 0px));
    align-items: stretch;
    justify-content: space-around;
    gap: 0;
  }

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-1);
    color: var(--color-text-tertiary);
    text-decoration: none;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.02em;
    transition: color var(--transition-fast);
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
  }

  .nav-item:hover,
  .nav-item.active {
    color: var(--color-text-primary);
  }

  .nav-item.active {
    color: var(--color-accent);
  }

  .nav-new {
    color: var(--color-text-secondary);
  }

  .plus-ring {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--color-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    transition: transform var(--transition-fast), opacity var(--transition-fast);
    margin-bottom: -2px;
  }

  .nav-new:hover .plus-ring {
    transform: scale(1.08);
    opacity: 0.9;
  }

  .nav-new span:not(.plus-ring) {
    font-size: 9px;
  }

  @media (max-width: 640px) {
    .bottom-nav {
      display: flex;
    }
  }
</style>
