<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { user, authLoading, checkAuth } from '$lib/stores/auth.js';
  import Sidebar from '$lib/components/workspace/Sidebar.svelte';
  import BottomNav from '$lib/components/workspace/BottomNav.svelte';
  import ShortcutsModal from '$lib/components/ui/ShortcutsModal.svelte';
  import { onKey } from '$lib/utils/shortcuts.js';

  let { children } = $props();

  let mobileMenuOpen = $state(false);
  let shortcutsOpen = $state(false);
  let sidebarRef = $state<Sidebar | undefined>();

  setContext('openMobileMenu', () => (mobileMenuOpen = true));

  onMount(async () => {
    if ($user === null && !$authLoading) {
      goto('/login');
      return;
    }
    if ($authLoading) await checkAuth();
    if (!$user) goto('/login');
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
