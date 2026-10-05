<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { user, authLoading, checkAuth } from '$lib/stores/auth.js';
  import Sidebar from '$lib/components/workspace/Sidebar.svelte';
  import BottomNav from '$lib/components/workspace/BottomNav.svelte';
  import ShortcutsModal from '$lib/components/ui/ShortcutsModal.svelte';
  import TooltipLayer from '$lib/components/ui/TooltipLayer.svelte';
  import { stopListen } from '$lib/stores/listen.js';
  import { onKey } from '$lib/utils/shortcuts.js';

  let { children } = $props();

  let mobileMenuOpen = $state(false);
  let shortcutsOpen = $state(false);
  let sidebarRef = $state<Sidebar | undefined>();

  setContext('openMobileMenu', () => (mobileMenuOpen = true));
  setContext('reloadSidebar', () => sidebarRef?.reload());

  // The inline player belongs to the page it was started on
  beforeNavigate(() => stopListen());

  // Come back to the requested page after logging in
  function toLogin() {
    goto(`/login?next=${encodeURIComponent($page.url.pathname + $page.url.search)}`);
  }

  onMount(async () => {
    if ($user === null && !$authLoading) {
      toLogin();
      return;
    }
    if ($authLoading) await checkAuth();
    if (!$user) toLogin();
  });

  onKey({
    '/': () => sidebarRef?.focusSearch(),
    '?': () => (shortcutsOpen = true),
    Escape: () => {
      if (mobileMenuOpen) mobileMenuOpen = false;
    },
  });
</script>

{#if $authLoading}
  <div class="loading"><div class="spinner"></div></div>
{:else if $user}
  <div class="workspace">
    <Sidebar bind:this={sidebarRef} bind:open={mobileMenuOpen} onClose={() => (mobileMenuOpen = false)} />
    {#if mobileMenuOpen}
      <button class="backdrop" onclick={() => (mobileMenuOpen = false)} aria-label="Menü schließen"></button>
    {/if}
    <main class="main">
      {@render children()}
    </main>
    <BottomNav />
  </div>

  <ShortcutsModal bind:open={shortcutsOpen} />
  <TooltipLayer />
{/if}

<style>
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
  }
  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .workspace {
    display: flex;
    min-height: 100vh;
    /* Series colours of the overview charts, checked for contrast on #131119 and #17151f */
    --color-series-1: #f43f5e;
    --color-series-2: #8b5cf6;
    --color-text-axis: #8a8597;
  }

  /* Version and timestamp chips of the overview pages */
  :global(.vchip) {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 5px;
    border-radius: 5px;
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border-hover);
    color: var(--color-text-primary);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  :global(.tchip) {
    color: var(--color-warning);
    font-variant-numeric: tabular-nums;
    background: rgba(251, 191, 36, 0.12);
    border: 1px solid rgba(251, 191, 36, 0.3);
    padding: 0 5px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    line-height: 1.6;
  }

  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  @media (max-width: 640px) {
    .main {
      padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px));
    }
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(8, 6, 14, 0.65);
    backdrop-filter: blur(4px);
    z-index: 99;
    border: none;
    cursor: pointer;
    display: none;
  }

  @media (max-width: 880px) {
    .backdrop {
      display: block;
    }
  }
</style>
