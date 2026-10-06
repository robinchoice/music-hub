<script lang="ts">
  import { page } from '$app/stores';
  import { api } from '$lib/api/client.js';
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import PersonAvatar from '$lib/components/admin/PersonAvatar.svelte';
  import PersonView from '$lib/components/admin/PersonView.svelte';
  import SidePanel from '$lib/components/admin/SidePanel.svelte';
  import { formatDay, formatGb, formatTime, formatWhen } from '$lib/utils/format.js';
  import {
    ACTION_LABEL,
    apart,
    inviteState,
    personState,
    plural,
    standOf,
    type Person,
    type PersonState,
    type ShareLinkRow,
  } from '$lib/utils/admin.js';

  type Filter = 'all' | PersonState;
  type SortKey = 'name' | 'last' | 'created' | 'projects' | 'uploads' | 'comments' | 'approvals' | 'plays' | 'storage';

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Alle' },
    { key: 'active', label: 'Aktiv · 7 Tage' },
    { key: 'away', label: 'Länger weg' },
    { key: 'never', label: 'Nie angemeldet' },
  ];

  const params = $page.url.searchParams;
  let tab = $state<'people' | 'links'>(params.get('tab') === 'links' ? 'links' : 'people');
  let filter = $state<Filter>((FILTERS.find((f) => f.key === params.get('filter'))?.key ?? 'all') as Filter);
  let sort = $state<SortKey>(params.get('sort') === 'created' ? 'created' : 'last');
  let dir = $state(-1);
  let query = $state('');
  let range = $state<'30' | 'all'>('30');
  let selected = $state<string | null>(null);
  let panelOpen = $state(false);

  let people = $state<Person[] | null>(null);
  let failed = $state(false);
  let loading = $state(false);
  let loadedAt = $state(Date.now());

  function load() {
    const want = range;
    failed = false;
    loading = true;
    api
      .get<{ people: Person[] }>(`/admin/users?range=${want}`, true)
      .then((d) => {
        if (want !== range) return;
        people = d.people;
        loadedAt = Date.now();
      })
      .catch(() => {
        if (want === range) failed = true;
      })
      .finally(() => {
        if (want === range) loading = false;
      });
  }

  $effect(() => {
    void range;
    load();
  });

  let links = $state<ShareLinkRow[] | null>(null);
  let linksFailed = $state(false);
  let openLinks = $state<Record<string, boolean>>({});

  function loadLinks() {
    linksFailed = false;
    api
      .get<{ links: ShareLinkRow[] }>('/admin/share-links', true)
      .then((d) => (links = d.links))
      .catch(() => (linksFailed = true));
  }

  $effect(() => {
    if (tab === 'links' && !links) loadLinks();
  });

  const all = $derived(people ?? []);
  const stateOf = (p: Person) => personState(p, loadedAt);
  const counts = $derived({
    all: all.length,
    active: all.filter((p) => stateOf(p) === 'active').length,
    away: all.filter((p) => stateOf(p) === 'away').length,
    never: all.filter((p) => stateOf(p) === 'never').length,
  });
  const online = $derived(all.filter((p) => p.online).length);
  const expiring = $derived(all.find((p) => p.pending && inviteState(p, loadedAt)?.tone === 'warning'));

  // Sort keys; people who never logged in end up below everyone else, the link running out first on top
  function key(p: Person, k: SortKey): number | string {
    const c = p.counts;
    switch (k) {
      case 'name':
        return p.name.toLowerCase();
      case 'last': {
        if (!p.pending) return p.lastActiveAt ? Date.parse(p.lastActiveAt) : 0;
        const expires = p.inviteExpiresAt ? Date.parse(p.inviteExpiresAt) : 0;
        return expires >= loadedAt ? loadedAt - expires : -1e15;
      }
      case 'created':
        return Date.parse(p.createdAt);
      case 'projects':
        return p.projectCount;
      case 'uploads':
        return p.pending ? -1 : c.versions + c.stems;
      case 'comments':
        return p.pending ? -1 : c.comments;
      case 'approvals':
        return p.pending ? -1 : c.approvals;
      case 'plays':
        return p.pending ? -1 : c.plays;
      case 'storage':
        return p.storageBytes;
    }
  }

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((p) => filter === 'all' || stateOf(p) === filter)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .sort((a, b) => {
        const x = key(a, sort);
        const y = key(b, sort);
        return (x < y ? -1 : x > y ? 1 : 0) * dir;
      });
  });

  const COLUMNS: { key: SortKey; label: string; left?: boolean; tip?: string }[] = [
    { key: 'name', label: 'Person', left: true },
    { key: 'last', label: 'Zuletzt aktiv', left: true },
    { key: 'created', label: 'Dabei seit' },
    { key: 'projects', label: 'Projekte' },
    { key: 'uploads', label: 'Uploads', tip: 'Versionen und Stems' },
    { key: 'comments', label: 'Kommentare' },
    { key: 'approvals', label: 'Freigaben', tip: 'Wer freigegeben hat, wird erst seit Oktober 2026 gespeichert' },
    { key: 'plays', label: 'Share-Plays', tip: 'Gäste, die Links dieser Person abgespielt haben' },
    { key: 'storage', label: 'Speicher', tip: 'Originaldateien, aktueller Stand' },
  ];

  function sortBy(k: SortKey) {
    dir = sort === k ? -dir : k === 'name' ? 1 : -1;
    sort = k;
  }

  function open(id: string) {
    selected = id;
    panelOpen = true;
  }

  const monthYear = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });
  const longDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const short = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  const lastLine = (p: Person) =>
    p.lastAction ? `${ACTION_LABEL[p.lastAction.type]}${apart(p.lastAction.at, p.lastActiveAt) ? `, ${formatDay(p.lastAction.at)}` : ''}` : 'gesehen';
  const validity = (l: ShareLinkRow) => {
    if (!l.expiresAt) return 'unbegrenzt';
    return Date.parse(l.expiresAt) < loadedAt ? `abgelaufen ${short(l.expiresAt)}` : `bis ${short(l.expiresAt)}`;
  };
  const toggleLink = (id: string) => (openLinks = { ...openLinks, [id]: !openLinks[id] });
  const heard = (seconds: number, duration: number | null) => `${formatTime(seconds)}${duration ? ` von ${formatTime(duration)}` : ''}`;
</script>

<TopBar crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Nutzerliste' }]} />

<div class="page">
  {#if !people && failed}
    <EmptyState title="Gerade nicht erreichbar" description="Die Liste ließ sich nicht laden.">
      {#snippet action()}
        <Button onclick={load}>Erneut versuchen</Button>
      {/snippet}
    </EmptyState>
  {:else if !people}
    <div class="loading">
      <Skeleton width="40%" height="1.2rem" />
      <Skeleton height="20rem" variant="rect" />
    </div>
  {:else}
    <div class="head">
      <p class="date">{standOf(loadedAt)}</p>
      <p class="sum">
        <b>{plural(counts.all, 'Konto', 'Konten')}.</b>
        In den letzten sieben Tagen waren <b>{counts.active}</b> davon aktiv, <b>{online}</b> {online === 1 ? 'ist' : 'sind'} gerade online.
        {#if counts.never}
          <b>{counts.never}</b> {counts.never === 1 ? 'eingeladene Person hat' : 'Eingeladene haben'} sich noch nie angemeldet{#if expiring}, bei
            <b>{expiring.name}</b> läuft der Einladungslink heute ab{/if}.
        {/if}
      </p>
    </div>

    <div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'people'} class:on={tab === 'people'} onclick={() => (tab = 'people')}>
        Personen <span class="n">{counts.all}</span>
      </button>
      <button type="button" role="tab" aria-selected={tab === 'links'} class:on={tab === 'links'} onclick={() => (tab = 'links')}>
        Share-Links {#if links}<span class="n">{links.length}</span>{/if}
      </button>
    </div>

    {#if tab === 'people'}
      <div class="toolbar">
        <div class="chips">
          {#each FILTERS as f (f.key)}
            <button type="button" class="chip" class:on={filter === f.key} onclick={() => (filter = f.key)}>{f.label} <b>{counts[f.key]}</b></button>
          {/each}
        </div>
        <label class="search">
          <Icon name="search" size={14} />
          <input type="search" bind:value={query} placeholder="Name oder E-Mail" aria-label="Personen suchen" />
        </label>
        <div class="right">
          <select class="sort-m" bind:value={sort} onchange={() => (dir = sort === 'name' ? 1 : -1)} aria-label="Sortieren">
            {#each COLUMNS as c (c.key)}<option value={c.key}>{c.label}</option>{/each}
          </select>
          <div class="seg" role="group" aria-label="Zeitraum der Zahlen">
            <button type="button" class:on={range === '30'} onclick={() => (range = '30')}>30 Tage</button>
            <button type="button" class:on={range === 'all'} onclick={() => (range = 'all')}>Gesamt</button>
          </div>
        </div>
      </div>

      <div class="list" class:dim={loading}>
        <div class="card table-card">
          <table class="tbl">
            <thead>
              <tr>
                {#each COLUMNS as c (c.key)}
                  <th
                    class:left={c.left}
                    class:sorted={sort === c.key}
                    aria-sort={sort === c.key ? (dir > 0 ? 'ascending' : 'descending') : undefined}
                  >
                    <button type="button" onclick={() => sortBy(c.key)} data-tt={c.tip}>
                      {c.label}{#if sort === c.key}<Icon name={dir > 0 ? 'chevron-up' : 'chevron-down'} size={12} />{/if}
                    </button>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each shown as p (p.id)}
                {@const state = p.pending ? inviteState(p, loadedAt) : null}
                <tr class:sel={panelOpen && selected === p.id} onclick={() => open(p.id)}>
                  <td>
                    <div class="who">
                      <PersonAvatar person={p} />
                      <div class="who-text">
                        <button type="button" class="nm" class:pend={p.pending} onclick={(e) => { e.stopPropagation(); open(p.id); }}>
                          {p.name}{#if p.isAdmin}<span class="admin">Admin</span>{/if}
                        </button>
                        <span class="em">{p.email}</span>
                      </div>
                    </div>
                  </td>
                  <td class="left">
                    {#if p.pending}
                      <span class="l1">Nie angemeldet</span>
                      {#if state}<span class="l2"><span class="pill {state.tone}">{state.short}</span></span>{/if}
                    {:else if p.online}
                      <span class="l1 on">online</span>
                      <span class="l2">{p.lastAction ? `${ACTION_LABEL[p.lastAction.type]}, ${formatWhen(p.lastAction.at)}` : ''}</span>
                    {:else}
                      <span class="l1">{p.lastActiveAt ? formatWhen(p.lastActiveAt) : '–'}</span>
                      <span class="l2">{lastLine(p)}</span>
                    {/if}
                  </td>
                  <td title={longDate(p.createdAt)}>{monthYear(p.createdAt)}</td>
                  <td>{p.projectCount}</td>
                  {#if p.pending}
                    <td class="zero">–</td><td class="zero">–</td><td class="zero">–</td><td class="zero">–</td>
                  {:else}
                    <td class:zero={!(p.counts.versions + p.counts.stems)}>{p.counts.versions + p.counts.stems || '–'}</td>
                    <td class:zero={!p.counts.comments}>{p.counts.comments || '–'}</td>
                    <td class:zero={!p.counts.approvals}>{p.counts.approvals || '–'}</td>
                    <td class:zero={!p.counts.plays}>{p.counts.plays || '–'}</td>
                  {/if}
                  <td class:zero={!p.storageBytes}>{p.storageBytes ? formatGb(p.storageBytes) : '–'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <ul class="cards">
          {#each shown as p (p.id)}
            {@const c = p.counts}
            {@const parts = p.pending
              ? []
              : [
                  c.versions + c.stems ? plural(c.versions + c.stems, 'Upload', 'Uploads') : '',
                  c.comments ? plural(c.comments, 'Kommentar', 'Kommentare') : '',
                  c.plays ? plural(c.plays, 'Share-Play', 'Share-Plays') : '',
                ].filter(Boolean)}
            <li>
              <button type="button" class="pcard" onclick={() => open(p.id)}>
                <PersonAvatar person={p} />
                <span class="pc-main">
                  <span class="pc-name">{p.name}{#if p.isAdmin}<span class="admin">Admin</span>{/if}</span>
                  <span class="pc-state">
                    {#if p.pending}
                      Nie angemeldet{#if inviteState(p, loadedAt)}{' · '}{inviteState(p, loadedAt)?.short}{/if}
                    {:else if p.online}
                      <span class="on">online</span>{#if p.lastAction}{' · '}{ACTION_LABEL[p.lastAction.type]}, {formatWhen(p.lastAction.at)}{/if}
                    {:else}
                      {p.lastActiveAt ? formatWhen(p.lastActiveAt) : '–'} · {lastLine(p)}
                    {/if}
                  </span>
                  {#if parts.length}<span class="pc-nums">{parts.join(' · ')} {range === '30' ? 'in 30 Tagen' : 'insgesamt'}</span>{/if}
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            </li>
          {/each}
        </ul>

        <p class="foot">
          {#if shown.length}
            {plural(shown.length, 'Person', 'Personen')}. „Zuletzt aktiv“ ist das Jüngste aus dem letzten Aufruf der App
            und Aktionen wie Login, Upload, Kommentar, Freigabe oder Share-Link.
          {:else}
            Niemand passt zu diesem Filter.
          {/if}
        </p>
      </div>
    {:else if !links && linksFailed}
      <p class="empty">Die Share-Links ließen sich nicht laden. <button type="button" class="retry" onclick={loadLinks}>Erneut versuchen</button></p>
    {:else if !links}
      <Skeleton height="16rem" variant="rect" />
    {:else if !links.length}
      <p class="empty">Keine gültigen Share-Links und keine Aufrufe in den letzten 30 Tagen.</p>
    {:else}
      <p class="lead">Aufrufe, Plays und Gast-Kommentare der letzten 30 Tage. Eine Zeile aufklappen zeigt die letzten Aufrufe.</p>
      <div class="card table-card">
        <table class="tbl">
          <thead>
            <tr>
              <th class="left">Version</th><th class="left">Erstellt von</th><th>Erstellt</th><th>Gültig</th>
              <th>Aufrufe</th><th>Plays</th><th>Komplett</th><th>Gast-Kommentare</th><th>Schutz</th>
            </tr>
          </thead>
          <tbody>
            {#each links as l (l.id)}
              <tr onclick={() => toggleLink(l.id)}>
                <td>
                  <button
                    type="button"
                    class="nm"
                    aria-expanded={!!openLinks[l.id]}
                    onclick={(e) => {
                      e.stopPropagation();
                      toggleLink(l.id);
                    }}
                  >
                    <Icon name={openLinks[l.id] ? 'chevron-down' : 'chevron-right'} size={14} />
                    {l.trackName} <span class="vchip">v{l.versionNumber}</span>
                  </button>
                  <span class="em indent">{l.projectName}</span>
                </td>
                <td class="left">{l.creatorName}</td>
                <td>{short(l.createdAt)}</td>
                <td class:zero={!!l.expiresAt && Date.parse(l.expiresAt) < loadedAt}>{validity(l)}</td>
                <td class:zero={!l.opens}>{l.opens || '–'}</td>
                <td class:zero={!l.plays}>{l.plays || '–'}</td>
                <td class:zero={!l.complete}>{l.complete || '–'}</td>
                <td class:zero={!l.guestComments}>{l.guestComments || '–'}</td>
                <td>
                  <span class="flags">
                    {#if l.hasPassword}<span data-tt="Passwort nötig"><Icon name="lock" size={14} /></span>{/if}
                    {#if l.allowDownload}<span data-tt="Download erlaubt"><Icon name="download" size={14} /></span>{/if}
                    {#if !l.hasPassword && !l.allowDownload}<span class="zero">–</span>{/if}
                  </span>
                </td>
              </tr>
              {#if openLinks[l.id]}
                <tr class="detail">
                  <td colspan="9">
                    {#if l.listeners.length}
                      <ul class="listeners">
                        {#each l.listeners as x, i (i)}
                          <li>
                            <b>{x.guestName ?? 'Gast ohne Namen'}</b>
                            <span>{x.device}</span>
                            <span>
                              {x.played ? heard(x.seconds, l.duration) : 'geöffnet, nicht abgespielt'}
                              {#if x.completed}<span class="on">· komplett</span>{/if}
                            </span>
                            <span class="t">{formatWhen(x.at)}</span>
                          </li>
                        {/each}
                      </ul>
                    {:else}
                      <p class="empty">Noch niemand hat den Link geöffnet.</p>
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>

      <ul class="cards">
        {#each links as l (l.id)}
          <li>
            <button type="button" class="pcard" aria-expanded={!!openLinks[l.id]} onclick={() => toggleLink(l.id)}>
              <span class="pc-main">
                <span class="pc-name">{l.trackName} <span class="vchip">v{l.versionNumber}</span></span>
                <span class="pc-state">{l.creatorName} · {validity(l)}</span>
                <span class="pc-nums">{l.opens} Aufrufe · {l.plays} Plays · {l.complete} komplett</span>
                {#if openLinks[l.id]}
                  {#each l.listeners as x, i (i)}
                    <span class="pc-listener">
                      <b>{x.guestName ?? 'Gast ohne Namen'}</b> · {x.played ? heard(x.seconds, l.duration) : 'nicht abgespielt'}
                      · {formatWhen(x.at)}
                    </span>
                  {/each}
                {/if}
              </span>
              <Icon name={openLinks[l.id] ? 'chevron-down' : 'chevron-right'} size={16} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<SidePanel bind:open={panelOpen} label="Person">
  {#if selected}<PersonView userId={selected} onclose={() => (panelOpen = false)} />{/if}
</SidePanel>

<style>
  .page {
    padding: var(--space-6);
    max-width: 1240px;
  }
  .loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .head {
    margin-bottom: var(--space-5);
  }
  .date {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    margin: 0 0 4px;
  }
  .sum {
    margin: 0;
    max-width: 820px;
    font-size: var(--text-lg);
    line-height: 1.45;
    letter-spacing: -0.01em;
  }
  .sum b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: var(--space-4);
  }
  .tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: 8px 12px;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-secondary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .tabs button:hover {
    color: var(--color-text-primary);
  }
  .tabs button.on {
    color: var(--color-text-primary);
    border-image: var(--gradient-accent) 1;
  }
  .n {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: var(--space-3);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    display: inline-flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--color-border-hover);
    color: var(--color-text-primary);
  }
  .chip b {
    font-weight: 600;
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .chip.on {
    background: var(--color-bg-overlay);
    border-color: var(--color-border-hover);
    color: var(--color-text-primary);
  }
  .chip.on b {
    color: var(--color-accent);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    width: 220px;
    padding: 0 10px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-base);
    color: var(--color-text-tertiary);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
    outline: none;
  }
  .search:focus-within {
    border-color: var(--color-accent);
  }
  .right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sort-m {
    display: none;
    height: 30px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
    padding: 0 8px;
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    border-radius: 10px;
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
  }
  .seg button {
    height: 26px;
    padding: 0 10px;
    border-radius: 8px;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .seg button.on {
    background: var(--color-bg-overlay);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-sm);
  }
  .list {
    transition: opacity var(--transition-base);
  }
  .list.dim {
    opacity: 0.55;
  }

  .card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4) 0 var(--space-2);
    overflow-x: auto;
  }
  .tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  .tbl th {
    font-weight: 500;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    text-align: right;
    padding: 0 10px 10px;
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
  }
  .tbl th button {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .tbl th button:hover,
  .tbl th.sorted button {
    color: var(--color-text-primary);
  }
  .tbl td {
    padding: 9px 10px;
    text-align: right;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
  }
  .tbl :is(th, td):first-child {
    text-align: left;
    padding-left: var(--space-5);
  }
  .tbl :is(th, td):last-child {
    padding-right: var(--space-5);
  }
  .tbl .left {
    text-align: left;
  }
  .tbl tbody tr {
    cursor: pointer;
  }
  .tbl tbody tr:hover td,
  .tbl tbody tr.sel td {
    background: var(--color-bg-overlay);
  }
  .tbl tbody tr:last-child td {
    border-bottom: none;
  }
  .zero {
    color: var(--color-text-tertiary) !important;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .who-text {
    min-width: 0;
  }
  .nm {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--color-text-primary);
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-align: left;
  }
  .nm:hover {
    color: var(--color-accent);
  }
  .nm.pend {
    color: var(--color-text-secondary);
    font-weight: 400;
  }
  .em {
    display: block;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
  .indent {
    padding-left: 20px;
  }
  .admin {
    font-size: 11px;
    font-weight: 500;
    padding: 0 0.45rem;
    border-radius: var(--radius-full);
    background: var(--color-accent-subtle);
    color: var(--color-accent-2);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
  }
  .l1 {
    display: block;
    color: var(--color-text-primary);
  }
  .l2 {
    display: block;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
  .on {
    color: var(--color-success);
    font-weight: 500;
  }
  .pill {
    font-size: 11px;
    font-weight: 500;
    padding: 0.05rem 0.5rem;
    border-radius: var(--radius-full);
    white-space: nowrap;
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
  }
  .pill.warning {
    background: rgba(251, 191, 36, 0.15);
    border-color: transparent;
    color: var(--color-warning);
  }
  .pill.default {
    background: var(--color-bg-subtle);
  }
  .pill.muted {
    color: var(--color-text-tertiary);
  }
  .flags {
    display: inline-flex;
    gap: 6px;
    color: var(--color-text-tertiary);
  }
  .tbl tr.detail {
    cursor: default;
  }
  .tbl tr.detail td,
  .tbl tr.detail:hover td {
    background: var(--color-bg-base);
    white-space: normal;
    text-align: left;
    padding: 10px var(--space-5) 12px;
  }
  .listeners {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .listeners li {
    display: grid;
    grid-template-columns: minmax(150px, 1.2fr) 120px 1fr 130px;
    gap: 12px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .listeners b {
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .t {
    color: var(--color-text-tertiary);
    text-align: right;
  }
  .lead,
  .foot {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .lead {
    margin: 0 0 var(--space-3);
  }
  .foot {
    margin: var(--space-3) 0 0;
  }
  .empty {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
  .retry {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--color-text-primary);
    text-decoration: underline;
    cursor: pointer;
  }

  .cards {
    display: none;
    list-style: none;
    margin: 0;
    padding: 0;
    flex-direction: column;
    gap: 8px;
  }
  .pcard {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    font: inherit;
    color: var(--color-text-tertiary);
    text-align: left;
    cursor: pointer;
  }
  .pc-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .pc-name {
    color: var(--color-text-primary);
    font-weight: 500;
    font-size: var(--text-sm);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pc-state {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .pc-nums,
  .pc-listener {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    margin-top: 2px;
  }
  .pc-listener b {
    color: var(--color-text-primary);
    font-weight: 500;
  }

  @media (max-width: 640px) {
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
    .sum {
      font-size: var(--text-base);
    }
    .table-card {
      display: none;
    }
    .cards {
      display: flex;
    }
    .chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      width: calc(100% + 2 * var(--space-4));
      margin: 0 calc(-1 * var(--space-4));
      padding: 0 var(--space-4) 2px;
      scrollbar-width: none;
    }
    .search {
      width: 100%;
    }
    .right {
      margin-left: 0;
      width: 100%;
      justify-content: space-between;
    }
    .sort-m {
      display: inline-block;
    }
  }
</style>
