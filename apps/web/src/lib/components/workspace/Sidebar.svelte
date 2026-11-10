<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/index.js';
  import { user, logout } from '$lib/stores/auth.js';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Tile from '$lib/components/ui/Tile.svelte';
  import { loadOverview, overview, tasks } from '$lib/stores/overview.js';
  import { STATUS_COLORS, type OverviewProject, type OverviewTrack } from '$lib/utils/overview.js';
  import { loadRequests, requests } from '$lib/stores/requests.js';

  // Like a drive: a few fixed places here, the projects themselves live in "Meine Musik"
  const NAV = $derived([
    { href: '/dashboard', icon: 'home', label: t().workspace.nav.overview, within: [] },
    { href: '/music', icon: 'folder', label: t().workspace.nav.music, within: ['/artists/', '/projects/', '/board', '/archive'] },
    { href: '/for-you', icon: 'inbox', label: t().workspace.nav.forYou, within: [] },
    { href: '/shared', icon: 'users', label: t().workspace.nav.shared, within: [] },
    { href: '/offen', icon: 'git-branch', label: t().workspace.nav.openMusic, within: [] },
    { href: '/trash', icon: 'trash', label: t().workspace.nav.trash, within: [] },
  ] as const);

  // Only for addresses in ADMIN_EMAILS; the admin area stays German
  const ADMIN_NAV = [
    { href: '/admin', icon: 'gauge', label: 'Lagebild' },
    { href: '/admin/users', icon: 'users', label: 'Nutzerliste' },
    { href: '/admin/log', icon: 'activity', label: 'Protokoll' },
    { href: '/admin/updates', icon: 'mail', label: 'Updates' },
  ] as const;

  let {
    open = $bindable(false),
    onClose,
  }: {
    open?: boolean;
    onClose?: () => void;
  } = $props();

  const pickFiles = getContext<(() => void) | undefined>('pickFiles');

  // Projects and tracks come from the overview store; the sidebar keeps no copy of its own
  const tracksByProject = $derived.by(() => {
    const map: Record<string, OverviewTrack[]> = {};
    for (const t of $overview?.tracks ?? []) (map[t.projectId] ??= []).push(t);
    for (const list of Object.values(map)) list.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    return map;
  });
  let menuOpen = $state(false);
  let newOpen = $state(false);
  let query = $state('');
  let searchInput = $state<HTMLInputElement | undefined>();
  // The / shortcut only helps with a keyboard
  let touch = $state(false);

  const path = $derived($page.url.pathname);
  const activeTrackId = $derived(($page.params as Record<string, string>).trackId ?? null);
  const isActive = (item: { href: string; within: readonly string[] }) =>
    path === item.href || item.within.some((prefix) => path.startsWith(prefix));

  // While searching, the projects whose name, artist or tracks match take the place below the navigation
  type Hit = { project: OverviewProject; tracks: OverviewTrack[] };
  const hits = $derived.by((): Hit[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return ($overview?.projects ?? []).flatMap((project) => {
      const all = tracksByProject[project.id] ?? [];
      const tracks = all.filter((tr) => tr.name.toLowerCase().includes(q));
      const named = project.name.toLowerCase().includes(q) || !!project.artist?.toLowerCase().includes(q);
      return named || tracks.length ? [{ project, tracks }] : [];
    });
  });

  onMount(() => {
    touch = matchMedia('(hover: none)').matches;
    void loadOverview();
    void loadRequests();
  });

  async function handleLogout() {
    await logout();
    goto('/login');
  }

  // Expose focus method for global / shortcut
  export function focusSearch() {
    searchInput?.focus();
    searchInput?.select();
  }

  function handleNavClick() {
    newOpen = false;
    if (open) onClose?.();
  }

  function uploadFiles() {
    handleNavClick();
    pickFiles?.();
  }

  function handleWindowClick(e: MouseEvent) {
    if (newOpen && !(e.target as Element).closest('.new-root')) newOpen = false;
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={(e) => e.key === 'Escape' && (newOpen = false)} />

<aside class="sidebar" class:open>
  <div class="sb-head">
    <a href="/dashboard" class="logo" onclick={handleNavClick}><Tile size={28} /> Music Hub</a>
    {#if open}
      <button class="close" onclick={onClose} aria-label={t().common.close}>
        <Icon name="x" size={18} />
      </button>
    {/if}
  </div>

  <div class="new-root">
    <button class="new" aria-expanded={newOpen} aria-haspopup="menu" onclick={() => (newOpen = !newOpen)}>
      <Icon name="plus" size={18} /> {t().workspace.sidebar.new}
    </button>
    {#if newOpen}
      <div class="new-menu" role="menu">
        <a role="menuitem" href="/projects/new" onclick={handleNavClick}><Icon name="music" size={16} /> {t().workspace.sidebar.newProject}</a>
        <button role="menuitem" onclick={uploadFiles}><Icon name="upload" size={16} /> {t().workspace.sidebar.uploadFiles}</button>
        <a role="menuitem" href="/import" onclick={handleNavClick}><Icon name="cloud-download" size={16} /> {t().importer.nav}</a>
      </div>
    {/if}
  </div>

  <div class="search">
    <input
      bind:this={searchInput}
      onfocus={() => (newOpen = false)}
      type="text"
      bind:value={query}
      placeholder={touch ? t().workspace.sidebar.search : t().workspace.sidebar.searchWithKey}
      aria-label={t().workspace.sidebar.searchLabel}
    />
  </div>

  {#if query.trim()}
    <div class="section">
      <div class="section-head"><span>{t().workspace.sidebar.projects}</span></div>
      <ul class="projects">
        {#each hits as { project, tracks } (project.id)}
          <li>
            <a href="/projects/{project.id}" class="project" onclick={handleNavClick}>
              <CoverImage src={project.coverUrl} name={project.name} size="xs" rounded="sm" />
              <span class="name">{project.name}</span>
              {#if project.artist}<span class="count">{project.artist}</span>{/if}
            </a>
            {#if tracks.length}
              <ul class="tracks">
                {#each tracks as track (track.id)}
                  <li>
                    <a href="/projects/{project.id}/tracks/{track.id}" class="track" class:active={activeTrackId === track.id} onclick={handleNavClick}>
                      <span class="status-dot" style="background: {STATUS_COLORS[track.status]}"></span>
                      {track.name}
                    </a>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
      {#if !hits.length}
        <p class="empty">{t().workspace.sidebar.nothingFound(query.trim())}</p>
      {/if}
    </div>
  {:else}
    <nav class="nav" aria-label={t().workspace.nav.main}>
      {#each NAV as item (item.href)}
        <a href={item.href} class="nav-item" class:active={isActive(item)} aria-current={isActive(item) ? 'page' : undefined} onclick={handleNavClick}>
          <Icon name={item.icon} size={16} /> {item.label}
          {#if item.href === '/for-you' && $tasks.length + $requests.length}
            <span class="badge">{$tasks.length + $requests.length}</span>
          {/if}
        </a>
      {/each}
    </nav>

    {#if $user?.isAdmin}
      <nav class="nav admin" aria-label="Admin">
        <span class="nav-label">Admin</span>
        {#each ADMIN_NAV as item (item.href)}
          <a
            href={item.href}
            class="nav-item"
            class:active={item.href === '/admin' ? path === '/admin' : path.startsWith(item.href)}
            onclick={handleNavClick}
          >
            <Icon name={item.icon} size={16} /> {item.label}
          </a>
        {/each}
      </nav>
    {/if}
    <div class="grow"></div>
  {/if}

  <div class="user-block">
    <button class="user" onclick={() => (menuOpen = !menuOpen)}>
      {#if $user}
        <Avatar name={$user.name} src={$user.avatarUrl ?? null} size="sm" />
        <span class="user-name">{$user.name}</span>
        <span class="chev"><Icon name="more" size={14} /></span>
      {/if}
    </button>
    {#if menuOpen}
      <div class="menu" role="menu">
        <a href="/account" onclick={() => { menuOpen = false; handleNavClick(); }}>{t().workspace.sidebar.account}</a>
        <button onclick={handleLogout}>{t().workspace.sidebar.logout}</button>
      </div>
    {/if}
  </div>
</aside>

<style>
  .sidebar {
    width: 240px;
    flex-shrink: 0;
    height: 100vh;
    height: 100dvh;
    background: var(--color-bg-raised);
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    padding: var(--space-5) 0 var(--space-4);
    position: sticky;
    top: 0;
  }

  .sb-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-5);
    margin-bottom: var(--space-4);
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--color-text-primary);
    font-family: var(--font-display);
    font-size: 1.375rem;
    font-weight: 800;
    font-stretch: 76%;
    letter-spacing: -0.02em;
    line-height: 1;
    text-decoration: none;
  }
  .logo:hover {
    color: var(--color-text-primary);
  }
  .close {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    display: none;
    padding: 4px;
  }

  .search {
    padding: 0 var(--space-3);
    margin-bottom: var(--space-4);
  }
  .search input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    transition: all var(--transition-fast);
  }
  .search input::placeholder {
    color: var(--color-text-tertiary);
  }
  .search input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 4px var(--color-accent-subtle);
  }

  .nav {
    padding: 0 var(--space-3);
    margin-bottom: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .nav-label {
    padding: 0 var(--space-3) var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .badge {
    margin-left: auto;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
    /* Open tasks wait for you: signal colour, not the product colour */
    background: var(--color-warning);
    color: var(--color-on-accent);
    font-size: 11px;
    font-weight: 700;
    display: inline-grid;
    place-items: center;
    font-variant-numeric: tabular-nums;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    text-decoration: none;
    font-size: var(--text-sm);
    transition: all var(--transition-fast);
  }
  .nav-item:hover {
    background: var(--color-bg-overlay);
    color: var(--color-text-primary);
  }
  .nav-item.active {
    background: var(--color-bg-overlay);
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .nav-item.active :global(svg) {
    color: var(--color-accent);
  }

  .section {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--space-3);
  }

  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 var(--space-3) var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }
  .grow {
    flex: 1;
  }

  .new-root {
    position: relative;
    padding: 0 var(--space-3);
    margin-bottom: var(--space-4);
  }
  .new {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0.6rem 1.1rem 0.6rem 0.85rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-overlay);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    transition: background var(--transition-fast);
  }
  .new:hover,
  .new[aria-expanded='true'] {
    background: var(--color-bg-subtle);
  }
  .new-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: var(--space-3);
    right: var(--space-3);
    z-index: var(--z-dropdown);
    display: grid;
    padding: var(--space-1);
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }
  .new-menu a,
  .new-menu button {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .new-menu a:hover,
  .new-menu button:hover {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }

  .projects {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .project {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    text-decoration: none;
    font-size: var(--text-sm);
    transition: all var(--transition-fast);
  }
  .project:hover {
    background: var(--color-bg-overlay);
    color: var(--color-text-primary);
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }

  .tracks {
    list-style: none;
    padding: var(--space-1) 0 var(--space-2) var(--space-6);
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    border-left: 1px solid var(--color-border);
    margin-left: var(--space-4);
  }
  .track {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0.3rem var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--color-text-tertiary);
    text-decoration: none;
    font-size: var(--text-xs);
    overflow: hidden;
    white-space: nowrap;
    transition: all var(--transition-fast);
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .track:hover {
    color: var(--color-text-primary);
  }
  .track.active {
    color: var(--color-accent);
    background: var(--color-accent-subtle);
  }

  .empty {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    padding: var(--space-2) var(--space-3);
  }

  .user-block {
    padding: var(--space-3) var(--space-3) 0;
    border-top: 1px solid var(--color-border);
    margin-top: var(--space-3);
    position: relative;
  }
  .user {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    background: none;
    border: none;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    cursor: pointer;
    font-family: inherit;
    transition: background var(--transition-fast);
  }
  .user:hover {
    background: var(--color-bg-overlay);
  }
  .user-name {
    flex: 1;
    text-align: left;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    color: var(--color-text-tertiary);
  }
  .menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: var(--space-3);
    right: var(--space-3);
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    overflow: hidden;
  }
  .menu button,
  .menu a {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--color-text-primary);
    padding: var(--space-3) var(--space-4);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    text-decoration: none;
  }
  .menu button:hover,
  .menu a:hover {
    background: var(--color-bg-subtle);
  }

  /* MOBILE — Drawer overlay */
  @media (max-width: 880px) {
    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      height: 100vh;
      height: 100dvh;
      width: min(280px, 85vw);
      z-index: 100;
      transform: translateX(-100%);
      /* Hidden once it slid out, so Tab and screen readers skip the closed drawer */
      visibility: hidden;
      transition:
        transform 240ms var(--ease-out),
        visibility 0s 240ms;
      box-shadow: var(--shadow-lg);
    }
    .sidebar.open {
      transform: translateX(0);
      visibility: visible;
      transition: transform 240ms var(--ease-out);
    }
    .close {
      display: inline-flex;
    }
  }
</style>
