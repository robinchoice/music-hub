<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { user, logout } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Tile from '$lib/components/ui/Tile.svelte';
  import { loadOverview, tasks } from '$lib/stores/overview.js';

  type Project = { id: string; name: string; artist: string | null; coverUrl: string | null };
  type ProjectMembership = { project: Project; role: string; trackCount: number };
  type ArtistGroup = { artist: string; memberships: ProjectMembership[] };
  type TrackStatus = 'sketch' | 'in_progress' | 'final' | 'released';
  type Track = { id: string; name: string; coverUrl: string | null; status: TrackStatus };

  const NAV = [
    { href: '/dashboard', icon: 'home', label: 'Übersicht' },
    { href: '/for-you', icon: 'inbox', label: 'Für dich' },
  ] as const;

  // Only for addresses in ADMIN_EMAILS
  const ADMIN_NAV = [
    { href: '/admin', icon: 'gauge', label: 'Lagebild' },
    { href: '/admin/users', icon: 'users', label: 'Nutzerliste' },
    { href: '/admin/log', icon: 'activity', label: 'Protokoll' },
  ] as const;

  const STATUS_COLORS: Record<TrackStatus, string> = {
    sketch: 'var(--color-text-secondary)',
    in_progress: 'var(--color-accent)',
    final: 'var(--color-success)',
    released: 'var(--color-text-primary)',
  };

  let {
    open = $bindable(false),
    onClose,
  }: {
    open?: boolean;
    onClose?: () => void;
  } = $props();

  let projects = $state<ProjectMembership[]>([]);
  let tracksByProject = $state<Record<string, Track[]>>({});
  let menuOpen = $state(false);
  let query = $state('');
  let searchInput = $state<HTMLInputElement | undefined>();

  const activeProjectId = $derived(($page.params as Record<string, string>).projectId ?? null);
  const activeTrackId = $derived(($page.params as Record<string, string>).trackId ?? null);

  // Filtered projects: a project matches if its name matches, artist matches, OR any of its loaded tracks match
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(({ project }) => {
      if (project.name.toLowerCase().includes(q)) return true;
      if (project.artist?.toLowerCase().includes(q)) return true;
      const tracks = tracksByProject[project.id];
      return tracks?.some((t) => t.name.toLowerCase().includes(q));
    });
  });

  // Group filtered projects by artist
  const artistGroups = $derived.by(() => {
    const groups = new Map<string, ProjectMembership[]>();
    for (const m of filtered) {
      const key = m.project.artist?.trim() || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    const sorted: ArtistGroup[] = [];
    for (const [artist, memberships] of groups) {
      if (artist) sorted.push({ artist, memberships });
    }
    sorted.sort((a, b) => a.artist.localeCompare(b.artist));
    const ungrouped = groups.get('');
    if (ungrouped) sorted.push({ artist: '', memberships: ungrouped });
    return sorted;
  });

  // Artist group collapsed state
  let collapsedArtists = $state<Set<string>>(new Set());
  function toggleArtist(artist: string) {
    const next = new Set(collapsedArtists);
    if (next.has(artist)) next.delete(artist);
    else next.add(artist);
    collapsedArtists = next;
  }
  function isArtistExpanded(artist: string) {
    if (collapsedArtists.has(artist)) return false;
    // Auto-expand if active project is in this group or search is active
    if (query.trim()) return true;
    return artistGroups.some(
      (g) => g.artist === artist && g.memberships.some((m) => m.project.id === activeProjectId),
    );
  }

  function trackMatches(track: Track) {
    const q = query.trim().toLowerCase();
    return !q || track.name.toLowerCase().includes(q);
  }

  // Whether a given project should auto-expand for search
  function shouldExpand(projectId: string) {
    if (activeProjectId === projectId) return true;
    if (!query.trim()) return false;
    return tracksByProject[projectId]?.some(trackMatches);
  }

  onMount(async () => {
    void loadOverview();
    try {
      const res = await api.get<{ projects: ProjectMembership[] }>('/projects', true);
      projects = res.projects;
    } catch {
      // not logged in or error — sidebar stays empty, layout still renders
    }
  });

  // Lazy-load tracks when a project becomes active
  $effect(() => {
    const id = activeProjectId;
    if (id && !tracksByProject[id]) {
      api.get<{ tracks: Track[] }>(`/tracks/project/${id}`, true).then((r) => {
        tracksByProject = { ...tracksByProject, [id]: r.tracks };
      }).catch(() => {});
    }
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

  // After a track was deleted or restored: fresh counts, and the active project's tracks load again
  export async function reload() {
    tracksByProject = {};
    const res = await api.get<{ projects: ProjectMembership[] }>('/projects', true).catch(() => null);
    if (res) projects = res.projects;
  }

  function handleNavClick() {
    if (open) onClose?.();
  }
</script>

<aside class="sidebar" class:open>
  <div class="sb-head">
    <a href="/dashboard" class="logo" onclick={handleNavClick}><Tile size={28} /> Music Hub</a>
    {#if open}
      <button class="close" onclick={onClose} aria-label="Schließen">
        <Icon name="x" size={18} />
      </button>
    {/if}
  </div>

  <div class="search">
    <input
      bind:this={searchInput}
      type="text"
      bind:value={query}
      placeholder="Suchen…  (/)"
      aria-label="Suchen"
    />
  </div>

  <nav class="nav">
    {#each NAV as item (item.href)}
      <a
        href={item.href}
        class="nav-item"
        class:active={$page.url.pathname === item.href}
        onclick={handleNavClick}
      >
        <Icon name={item.icon} size={16} /> {item.label}
        {#if item.href === '/for-you' && $tasks.length}
          <span class="badge">{$tasks.length}</span>
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
          class:active={item.href === '/admin' ? $page.url.pathname === '/admin' : $page.url.pathname.startsWith(item.href)}
          onclick={handleNavClick}
        >
          <Icon name={item.icon} size={16} /> {item.label}
        </a>
      {/each}
    </nav>
  {/if}

  <div class="section">
    <div class="section-head">
      <span>Projekte</span>
      <a href="/projects/new" class="add" title="Neues Projekt" aria-label="Neues Projekt" onclick={handleNavClick}>
        <Icon name="plus" size={14} />
      </a>
    </div>
    <div class="artist-groups">
      {#each artistGroups as group (group.artist)}
        {@const expanded = group.artist === '' || isArtistExpanded(group.artist) || !collapsedArtists.has(group.artist)}
        <div class="artist-group">
          {#if group.artist}
            <div class="artist-head" class:active={$page.params.artist === group.artist}>
              <button class="toggle" onclick={() => toggleArtist(group.artist)} aria-label={expanded ? 'Zuklappen' : 'Aufklappen'}>
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
              </button>
              <a href="/artists/{encodeURIComponent(group.artist)}" class="artist-name" onclick={handleNavClick}>{group.artist}</a>
              <span class="count">{group.memberships.length}</span>
            </div>
          {:else}
            <div class="artist-head ungrouped">
              <span class="artist-name">Ohne Zuordnung</span>
            </div>
          {/if}

          {#if expanded}
            <ul class="projects">
              {#each group.memberships as { project, trackCount } (project.id)}
                <li>
                  <a
                    href="/projects/{project.id}"
                    class="project"
                    class:active={activeProjectId === project.id}
                    onclick={handleNavClick}
                  >
                    <CoverImage src={project.coverUrl} name={project.name} size="xs" rounded="sm" />
                    <span class="name">{project.name}</span>
                    <span class="count">{trackCount}</span>
                  </a>
                  {#if shouldExpand(project.id) && tracksByProject[project.id]}
                    <ul class="tracks">
                      {#each tracksByProject[project.id].filter(trackMatches) as track (track.id)}
                        <li>
                          <a
                            href="/projects/{project.id}/tracks/{track.id}"
                            class="track"
                            class:active={activeTrackId === track.id}
                            onclick={handleNavClick}
                          >
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
          {/if}
        </div>
      {/each}
      {#if filtered.length === 0 && query}
        <p class="empty">Nichts gefunden für "{query}"</p>
      {:else if projects.length === 0}
        <p class="empty">Noch keine Projekte</p>
      {/if}
    </div>
  </div>

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
        <a href="/account" onclick={() => { menuOpen = false; handleNavClick(); }}>Konto</a>
        <button onclick={handleLogout}>Abmelden</button>
      </div>
    {/if}
  </div>
</aside>

<style>
  .sidebar {
    width: 240px;
    flex-shrink: 0;
    height: 100vh;
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
  .add {
    color: var(--color-text-tertiary);
    text-decoration: none;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
  }
  .add:hover {
    background: var(--color-bg-overlay);
    color: var(--color-accent);
  }

  .artist-groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .artist-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-3);
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    font-weight: 600;
    font-family: inherit;
    text-align: left;
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);
  }
  .toggle {
    display: inline-flex;
    padding: 2px;
    margin: -2px;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
  }
  .artist-head a {
    color: inherit;
    text-decoration: none;
  }
  .artist-head a:hover,
  .artist-head.active a {
    color: var(--color-text-primary);
  }
  .artist-head.ungrouped {
    cursor: default;
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border);
    margin-top: var(--space-1);
    border-radius: 0;
  }
  .artist-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .project.active {
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
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
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
      width: min(280px, 85vw);
      z-index: 100;
      transform: translateX(-100%);
      transition: transform 240ms var(--ease-out);
      box-shadow: var(--shadow-lg);
    }
    .sidebar.open {
      transform: translateX(0);
    }
    .close {
      display: inline-flex;
    }
  }
</style>
