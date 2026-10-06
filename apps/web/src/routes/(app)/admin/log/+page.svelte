<script lang="ts">
  import { api } from '$lib/api/client.js';
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import EventLine from '$lib/components/admin/EventLine.svelte';
  import PersonAvatar from '$lib/components/admin/PersonAvatar.svelte';
  import { EVENT_KINDS, daysSince, eventIcon, isGuestEvent, plural, type AdminEvent, type Person } from '$lib/utils/admin.js';

  const DAY = 86_400_000;
  type Range = 'today' | 'week';

  let range = $state<Range>('week');
  let kind = $state<string>('all');
  // A person's id, 'guests' or '' for everyone
  let who = $state('');
  let events = $state<AdminEvent[] | null>(null);
  // Start of what is loaded; older entries load in steps of a week before it
  let loadedFrom = $state<string | null>(null);
  let failed = $state(false);
  let loadingOlder = $state(false);
  let people = $state<Person[]>([]);
  let loadedAt = $state(Date.now());

  const get = (from: Date, to: Date) =>
    api.get<{ from: string; to: string; events: AdminEvent[] }>(
      `/admin/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      true,
    );

  function load() {
    const want = range;
    const to = new Date();
    const from = want === 'today' ? new Date(new Date(to).setHours(0, 0, 0, 0)) : new Date(to.getTime() - 7 * DAY);
    failed = false;
    get(from, to)
      .then((d) => {
        if (want !== range) return;
        events = d.events;
        loadedFrom = d.from;
        loadedAt = Date.now();
      })
      .catch(() => {
        if (want === range) failed = true;
      });
  }

  function loadOlder() {
    if (!loadedFrom) return;
    const to = new Date(loadedFrom);
    loadingOlder = true;
    get(new Date(to.getTime() - 7 * DAY), to)
      .then((d) => {
        events = [...(events ?? []), ...d.events];
        loadedFrom = d.from;
      })
      .finally(() => (loadingOlder = false));
  }

  $effect(() => {
    void range;
    load();
  });

  // Names, online state and today's activity of everyone
  $effect(() => {
    api
      .get<{ people: Person[] }>('/admin/users?range=30', true)
      .then((d) => (people = d.people))
      .catch(() => {});
  });

  const byId = $derived(new Map(people.map((p) => [p.id, p])));
  const todays = $derived(
    people
      .filter((p) => p.lastActiveAt && daysSince(p.lastActiveAt, loadedAt) === 0)
      .sort((a, b) => b.lastActiveAt!.localeCompare(a.lastActiveAt!)),
  );
  const online = $derived(people.filter((p) => p.online).length);
  const selected = $derived(who && who !== 'guests' ? (byId.get(who) ?? null) : null);

  const forWho = $derived(
    (events ?? []).filter((e) => (!who ? true : who === 'guests' ? isGuestEvent(e) : e.userId === who && !isGuestEvent(e))),
  );
  const kinds = $derived(EVENT_KINDS.map((k) => ({ ...k, n: forWho.filter((e) => (k.types as readonly string[]).includes(e.type)).length })));
  const shown = $derived(
    kind === 'all' ? forWho : forWho.filter((e) => (EVENT_KINDS.find((k) => k.key === kind)?.types as readonly string[]).includes(e.type)),
  );

  // Grouped by local day, newest first
  const days = $derived.by(() => {
    const groups: { key: string; at: string; list: AdminEvent[] }[] = [];
    for (const e of shown) {
      const key = new Date(e.at).toDateString();
      if (groups.at(-1)?.key !== key) groups.push({ key, at: e.at, list: [] });
      groups.at(-1)!.list.push(e);
    }
    return groups;
  });

  const dayName = (iso: string) => {
    const d = daysSince(iso, loadedAt);
    return d === 0 ? 'Heute' : d === 1 ? 'Gestern' : new Date(iso).toLocaleDateString('de-DE', { weekday: 'long' });
  };
  const dayDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const longDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const count = (types: AdminEvent['type'][]) =>
    forWho.filter((e) => types.includes(e.type)).reduce((n, e) => n + (e.type === 'stems' ? (e.count ?? 1) : 1), 0);
  const pick = (id: string) => (who = who === id ? '' : id);
</script>

<TopBar crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Protokoll' }]} />

<div class="page">
  {#if !events && failed}
    <EmptyState title="Gerade nicht erreichbar" description="Das Protokoll ließ sich nicht laden.">
      {#snippet action()}
        <Button onclick={load}>Erneut versuchen</Button>
      {/snippet}
    </EmptyState>
  {:else if !events}
    <div class="loading">
      <Skeleton width="50%" height="1.2rem" />
      <Skeleton height="3rem" variant="rect" />
      <Skeleton height="3rem" variant="rect" />
      <Skeleton height="3rem" variant="rect" />
    </div>
  {:else}
    <div class="today">
      <span class="lbl">Heute aktiv: <b>{todays.length}</b>{#if online}{' · '}davon <b>{online}</b> online{/if}</span>
      <div class="faces">
        {#each todays as p (p.id)}
          <button type="button" class="face" class:on={who === p.id} onclick={() => pick(p.id)}>
            <PersonAvatar person={p} size="sm" />
            {p.name.split(' ')[0]}
            <span class="t">{p.online ? 'online' : time(p.lastActiveAt!)}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="filters">
      <div class="row">
        <div class="seg" role="group" aria-label="Zeitraum">
          <button type="button" class:on={range === 'today'} onclick={() => (range = 'today')}>Heute</button>
          <button type="button" class:on={range === 'week'} onclick={() => (range = 'week')}>7 Tage</button>
        </div>
        <select bind:value={who} aria-label="Person">
          <option value="">Alle Personen</option>
          <option value="guests">Gäste über Share-Links</option>
          {#each people.filter((p) => !p.pending) as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      </div>
      <div class="chips">
        <button type="button" class="chip" class:on={kind === 'all'} onclick={() => (kind = 'all')}>Alles <b>{forWho.length}</b></button>
        {#each kinds as k (k.key)}
          {#if k.n || kind === k.key}
            <button type="button" class="chip" class:on={kind === k.key} onclick={() => (kind = k.key)}>{k.label} <b>{k.n}</b></button>
          {/if}
        {/each}
      </div>
    </div>

    {#if selected}
      <div class="profile">
        <PersonAvatar person={selected} size="lg" />
        <div class="grow">
          <a class="name" href="/admin/users/{selected.id}">{selected.name}</a>
          <span class="mail">{selected.email} · dabei seit {longDate(selected.createdAt)}</span>
          <span class="facts">
            Im geladenen Zeitraum: <b>{count(['version', 'stems'])}</b> Uploads · <b>{count(['comment'])}</b> Kommentare ·
            <b>{count(['login'])}</b> Logins · in {plural(selected.projectCount, 'Projekt', 'Projekten')}
          </span>
        </div>
        <button type="button" class="clear" onclick={() => (who = '')}><Icon name="x" size={14} /> Filter aufheben</button>
      </div>
    {/if}

    {#if days.length}
      {#each days as day (day.key)}
        <h2 class="day">{dayName(day.at)}<span>{dayDate(day.at)} · {plural(day.list.length, 'Eintrag', 'Einträge')}</span></h2>
        <ul class="feed">
          {#each day.list as e, i (i)}
            <li class:guest={isGuestEvent(e) || e.type === 'invite'}>
              <span class="tm">{time(e.at)}</span>
              <span class="ic"><Icon name={eventIcon(e)} size={15} /></span>
              <span class="tx"><EventLine event={e} people={byId} onperson={pick} /></span>
            </li>
          {/each}
        </ul>
      {/each}
    {:else}
      <p class="empty">Nichts in diesem Zeitraum.</p>
    {/if}

    <div class="more">
      <Button variant="secondary" size="sm" onclick={loadOlder} loading={loadingOlder}>Ältere Einträge laden</Button>
      {#if loadedFrom}<span class="hint">geladen ab {new Date(loadedFrom).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .page {
    padding: var(--space-6);
    max-width: 920px;
  }
  .loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .today {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 14px;
    margin-bottom: var(--space-4);
  }
  .lbl {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .lbl b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .faces {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .face {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 10px 0 4px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .face:hover {
    border-color: var(--color-border-hover);
  }
  .face.on {
    border-color: rgba(244, 63, 94, 0.45);
    background: var(--color-accent-subtle);
  }
  .face .t {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: var(--space-4);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
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
  select {
    height: 30px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
    padding: 0 8px;
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
  .profile {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    margin-bottom: var(--space-4);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    font-weight: 600;
  }
  .mail {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .facts {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin-top: 4px;
  }
  .facts b {
    color: var(--color-text-primary);
  }
  .clear {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    white-space: nowrap;
  }
  .clear:hover {
    background: var(--color-bg-overlay);
    color: var(--color-text-primary);
  }
  /* Right below the top bar; a pixel too little hides under it, too much leaves a gap */
  .day {
    position: sticky;
    top: 54px;
    z-index: 3;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin: 0;
    padding: 10px 0 8px;
    background: rgba(10, 9, 16, 0.94);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--color-border);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .day span {
    color: var(--color-text-tertiary);
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }
  .feed {
    list-style: none;
    margin: 0 0 var(--space-5);
    padding: 0;
  }
  .feed li {
    display: grid;
    grid-template-columns: 46px 30px minmax(0, 1fr);
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(36, 34, 46, 0.6);
    align-items: start;
  }
  .tm {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    padding-top: 6px;
  }
  .ic {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    display: grid;
    place-items: center;
    color: var(--color-text-secondary);
  }
  .guest .ic {
    border-style: dashed;
  }
  .tx {
    font-size: var(--text-sm);
    padding-top: 4px;
    min-width: 0;
  }
  .empty {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: var(--space-6) 0;
  }
  .more {
    display: flex;
    align-items: center;
    gap: 12px;
    justify-content: center;
    margin: var(--space-4) 0 var(--space-8);
  }
  .hint {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  @media (max-width: 880px) {
    .day {
      top: 56px;
    }
  }
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
    .chips {
      flex-wrap: nowrap;
      overflow-x: auto;
      width: calc(100% + 2 * var(--space-4));
      margin: 0 calc(-1 * var(--space-4));
      padding: 0 var(--space-4) 2px;
      scrollbar-width: none;
    }
    .feed li {
      grid-template-columns: 38px 26px minmax(0, 1fr);
      gap: 8px;
    }
    .ic {
      width: 26px;
      height: 26px;
    }
    .profile {
      flex-wrap: wrap;
    }
  }
</style>
