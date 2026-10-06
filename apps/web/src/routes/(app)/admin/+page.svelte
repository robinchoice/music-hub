<script lang="ts">
  import { env } from '$env/dynamic/public';
  import { api } from '$lib/api/client.js';
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import DashCard from '$lib/components/overview/DashCard.svelte';
  import ColumnChart from '$lib/components/admin/ColumnChart.svelte';
  import PersonAvatar from '$lib/components/admin/PersonAvatar.svelte';
  import { formatGb, formatWhen } from '$lib/utils/format.js';
  import {
    ACTION_LABEL,
    daysSince,
    inviteState,
    personState,
    plural,
    pointLabel,
    standOf,
    type AdminOverview,
    type Column,
    type Person,
  } from '$lib/utils/admin.js';

  const DAY = 86_400_000;
  const PERIODS = [7, 30, 90];

  let days = $state(30);
  let data = $state<AdminOverview | null>(null);
  let failed = $state(false);
  let loading = $state(false);
  let table = $state(false);
  // When the shown numbers were loaded; "today" and "online" refer to it
  let loadedAt = $state(Date.now());

  function load() {
    const want = days;
    failed = false;
    loading = true;
    api
      .get<AdminOverview>(`/admin/overview?days=${want}`, true)
      .then((d) => {
        if (want !== days) return;
        data = d;
        loadedAt = Date.now();
      })
      .catch(() => {
        if (want === days) failed = true;
      })
      .finally(() => {
        if (want === days) loading = false;
      });
  }

  $effect(() => {
    void days;
    load();
  });

  // Errors are collected by GlitchTip; its address is the one of the DSN
  const glitchtip = env.PUBLIC_SENTRY_DSN ? new URL(env.PUBLIC_SENTRY_DSN).origin : null;

  const people = $derived(data?.people ?? []);
  const since = $derived(loadedAt - days * DAY);
  const registered = $derived(people.filter((p) => !p.pending).length);
  const active = $derived(people.filter((p) => p.lastActiveAt && Date.parse(p.lastActiveAt) >= since));
  const online = $derived(people.filter((p) => p.online));
  const today = $derived(
    people
      .filter((p) => !p.online && p.lastActiveAt && daysSince(p.lastActiveAt, loadedAt) === 0)
      .sort((a, b) => b.lastActiveAt!.localeCompare(a.lastActiveAt!)),
  );
  const newAccounts = $derived(people.filter((p) => Date.parse(p.createdAt) >= since));
  // Open links first, the one running out soonest on top; then expired ones
  const pending = $derived(
    people
      .filter((p) => p.pending)
      .sort((a, b) => {
        const ea = a.inviteExpiresAt ? Date.parse(a.inviteExpiresAt) : 0;
        const eb = b.inviteExpiresAt ? Date.parse(b.inviteExpiresAt) : 0;
        return Number(ea < loadedAt) - Number(eb < loadedAt) || ea - eb;
      }),
  );
  const away = $derived(
    people.filter((p) => personState(p, loadedAt) === 'away').sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '')),
  );
  const storage = $derived(people.filter((p) => p.storageBytes > 0).sort((a, b) => b.storageBytes - a.storageBytes));
  const storageTotal = $derived(storage.reduce((sum, p) => sum + p.storageBytes, 0));

  const uploads = $derived(data ? data.current.versions + data.current.stems : 0);
  const uploadsBefore = $derived(data ? data.previous.versions + data.previous.stems : 0);
  const comments = $derived(data ? data.current.comments + data.current.guestComments : 0);
  const commentsBefore = $derived(data ? data.previous.comments + data.previous.guestComments : 0);

  const columns = $derived.by((): Column[] => {
    if (!data) return [];
    const { unit, points } = data.series;
    const every = points.length > 14 ? 7 : 1;
    return points.map((pt, i) => {
      const label = pointLabel(pt.start, unit);
      const running = i === points.length - 1;
      const runningText = unit === 'week' ? ', Woche läuft' : ', Tag läuft';
      return {
        label,
        value: pt.value,
        tip: `${plural(pt.value, 'Person', 'Personen')}\n${label}${running ? runningText : ''}`,
        tick: (points.length - 1 - i) % every === 0,
      };
    });
  });

  const lastText = (p: Person) => (p.lastAction ? ACTION_LABEL[p.lastAction.type] : 'gesehen');
  const playsText = $derived(data?.current.plays === 1 ? 'einmal' : `${data?.current.plays}-mal`);
  const chartSub = $derived(`pro ${data?.series.unit === 'week' ? 'Woche' : 'Tag'}, mit mindestens einer Aktion`);
</script>

<TopBar crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Lagebild' }]} />

<div class="page">
  {#if !data && failed}
    <EmptyState title="Gerade nicht erreichbar" description="Die Zahlen ließen sich nicht laden.">
      {#snippet action()}
        <Button onclick={load}>Erneut versuchen</Button>
      {/snippet}
    </EmptyState>
  {:else if !data}
    <div class="loading">
      <Skeleton width="40%" height="1.2rem" />
      <Skeleton height="6rem" variant="rect" />
      <Skeleton height="16rem" variant="rect" />
    </div>
  {:else}
    <div class="head">
      <p class="date">{standOf(loadedAt)}</p>
      <p class="sum">
        In den letzten {days} Tagen waren <b>{active.length}</b> von {registered} Personen aktiv,
        <b>{online.length}</b> {online.length === 1 ? 'ist' : 'sind'} gerade online.
        Dazu kamen <b>{plural(uploads, 'Upload', 'Uploads')}</b> und <b>{plural(comments, 'Kommentar', 'Kommentare')}</b>,
        {#if data.current.plays}
          Gäste haben <b>{playsText}</b> über Share-Links zugehört.
        {:else}
          über Share-Links hat niemand zugehört.
        {/if}
      </p>
    </div>

    <div class="filters">
      <div class="seg" role="group" aria-label="Zeitraum">
        {#each PERIODS as p (p)}
          <button type="button" class:on={days === p} onclick={() => (days = p)}>{p} Tage</button>
        {/each}
      </div>
      <span class="hint">Gilt für die ganze Seite, verglichen mit den {days} Tagen davor.</span>
    </div>

    <div class="body" class:dim={loading}>
      <div class="kpis">
        <a class="kpi" href="/admin/users?filter=active">
          <span class="l">Aktive Personen</span>
          <span class="v">{active.length}</span>
          <span class="s">von {registered} angemeldeten</span>
        </a>
        <div class="kpi">
          <span class="l">Online jetzt</span>
          <span class="v">{online.length}</span>
          <span class="s">{online.length ? online.map((p) => p.name.split(' ')[0]).join(', ') : 'in den letzten 5 Minuten'}</span>
        </div>
        <a class="kpi" href="/admin/users?sort=created">
          <span class="l">Neue Konten</span>
          <span class="v">{newAccounts.length}</span>
          <span class="s">{newAccounts.filter((p) => p.pending).length} noch nie angemeldet</span>
        </a>
        <div class="kpi">
          <span class="l">Uploads</span>
          <span class="v">{uploads}</span>
          {@render delta(uploads, uploadsBefore)}
          <span class="s">{data.current.versions} Versionen · {data.current.stems} Stems</span>
        </div>
        <div class="kpi">
          <span class="l">Kommentare</span>
          <span class="v">{comments}</span>
          {@render delta(comments, commentsBefore)}
          <span class="s">{data.current.guestComments} von Gästen</span>
        </div>
        <div class="kpi">
          <span class="l">Share-Plays</span>
          <span class="v">{data.current.plays}</span>
          {@render delta(data.current.plays, data.previous.plays)}
          <span class="s">{data.current.opens} Aufrufe · {data.current.complete} komplett</span>
        </div>
      </div>

      <div class="grid">
        <DashCard icon="users" title="Aktive Personen" sub={chartSub} span={8}>
          {#snippet actions()}
            <button type="button" class="tbtn" onclick={() => (table = !table)}>{table ? 'Diagramm' : 'Tabelle'}</button>
          {/snippet}
          <ColumnChart {columns} running {table} labelHead={data.series.unit === 'week' ? 'Woche' : 'Tag'} valueHead="Personen" />
        </DashCard>

        <DashCard icon="activity" title="Gerade da" span={4}>
          <h3 class="sub-h">Online</h3>
          {#if online.length}
            <ul class="plist">
              {#each online as p (p.id)}
                <li>
                  <PersonAvatar person={p} size="sm" />
                  <span class="grow">
                    <a href="/admin/users/{p.id}">{p.name}</a>
                    <span class="sub">{lastText(p)}{p.lastAction ? `, ${formatWhen(p.lastAction.at)}` : ''}</span>
                  </span>
                  <span class="on">online</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="empty">Gerade niemand.</p>
          {/if}
          <h3 class="sub-h">Heute aktiv</h3>
          {#if today.length}
            <ul class="plist">
              {#each today as p (p.id)}
                <li>
                  <PersonAvatar person={p} size="sm" />
                  <span class="grow"><a href="/admin/users/{p.id}">{p.name}</a><span class="sub">{lastText(p)}</span></span>
                  <span class="t">{new Date(p.lastActiveAt!).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="empty">Sonst noch niemand.</p>
          {/if}
        </DashCard>

        <DashCard icon="mail" title="Einladungen ohne Login" sub={pending.length ? String(pending.length) : ''} span={4}>
          {#if pending.length}
            <ul class="plist">
              {#each pending as p (p.id)}
                {@const state = inviteState(p, loadedAt)}
                <li>
                  <PersonAvatar person={p} size="sm" />
                  <span class="grow">
                    <a href="/admin/users/{p.id}">{p.name}</a>
                    <span class="sub">{p.invitedTo?.projectName ?? '–'} · eingeladen {formatWhen(p.createdAt)}</span>
                  </span>
                  {#if state}<span class="pill {state.tone}">{state.short.replace('Link ', '')}</span>{/if}
                </li>
              {/each}
            </ul>
            <p class="foot">Auch nach Ablauf geht der Login über die Login-Seite.</p>
          {:else}
            <p class="empty">Alle Eingeladenen haben sich angemeldet.</p>
          {/if}
        </DashCard>

        <DashCard icon="clock" title="Länger nicht da" sub="über 7 Tage" span={4}>
          {#if away.length}
            <ul class="plist">
              {#each away as p (p.id)}
                <li>
                  <PersonAvatar person={p} size="sm" />
                  <span class="grow"><a href="/admin/users/{p.id}">{p.name}</a><span class="sub">zuletzt: {lastText(p)}</span></span>
                  <span class="t">{p.lastActiveAt ? plural(daysSince(p.lastActiveAt, loadedAt), 'Tag', 'Tage') : '–'}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="empty">Alle waren in den letzten 7 Tagen da.</p>
          {/if}
        </DashCard>

        <DashCard icon="drive" title="Speicher" sub="{formatGb(storageTotal)} · je Person bis {formatGb(data.storageLimitBytes)}" span={4}>
          {#if storage.length}
            <div class="bars">
              {#each storage as p (p.id)}
                <div class="bar-row" data-tt="{formatGb(p.storageBytes)} von {formatGb(data.storageLimitBytes)}&#10;{p.name}">
                  <span class="nm">{p.name}</span>
                  <span class="track"><i style="width: {Math.min(100, (p.storageBytes / data.storageLimitBytes) * 100)}%"></i></span>
                  <span class="v">{formatGb(p.storageBytes)}</span>
                </div>
              {/each}
            </div>
          {:else}
            <p class="empty">Noch nichts hochgeladen.</p>
          {/if}
        </DashCard>

        <DashCard icon="layers" title="Projekte" sub="nach letzter Aktivität" span={8} flush>
          <div class="scroll">
            <table class="ptable">
              <thead><tr><th>Projekt</th><th>Mitglieder</th><th>Uploads</th><th>Kommentare</th><th>Zuletzt</th></tr></thead>
              <tbody>
                {#each data.projects as project (project.id)}
                  <tr>
                    <td>
                      {project.name}{#if project.archived}<span class="tag">archiviert</span>{/if}
                      {#if project.artist}<small>{project.artist}</small>{/if}
                    </td>
                    <td>{project.members}{#if project.openInvites}<span class="muted"> ({project.openInvites} offen)</span>{/if}</td>
                    <td>{project.uploads || '–'}</td>
                    <td>{project.comments || '–'}</td>
                    <td>{project.lastActivityAt ? formatWhen(project.lastActivityAt) : '–'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </DashCard>

        <DashCard icon="link" title="Share-Links" sub="meiste Plays" span={4}>
          {#snippet actions()}
            <a class="tbtn" href="/admin/users?tab=links">Alle</a>
          {/snippet}
          {#if data.shareLinks.length}
            <ul class="plist">
              {#each data.shareLinks as link (link.id)}
                <li>
                  <span class="grow">
                    <span class="track-name">{link.trackName}</span> <span class="vchip">v{link.versionNumber}</span>
                    <span class="sub">{link.projectName} · von {link.creatorName}</span>
                  </span>
                  <span class="t">{plural(link.plays, 'Play', 'Plays')} · {link.opens} Aufr.</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="empty">Niemand hat einen Link geöffnet.</p>
          {/if}
        </DashCard>

        {#if glitchtip}
          <section class="errors">
            <Icon name="alert" size={18} />
            <span class="grow">Fehler und Abstürze sammelt GlitchTip, ohne Personendaten.</span>
            <a href={glitchtip} target="_blank" rel="noopener">GlitchTip öffnen <Icon name="external" size={14} /></a>
          </section>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#snippet delta(now: number, before: number)}
  {@const d = now - before}
  <span class="d">
    {#if d}<span class={d > 0 ? 'up' : 'down'}>{d > 0 ? '▲' : '▼'} {Math.abs(d)}</span> ggü. davor{:else}wie davor{/if}
  </span>
{/snippet}

<style>
  .page {
    padding: var(--space-6);
  }
  .loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .head {
    margin-bottom: var(--space-4);
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
  .filters {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: var(--space-4);
  }
  .hint {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    border-radius: 10px;
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
  }
  .seg button {
    height: 28px;
    padding: 0 12px;
    border-radius: 8px;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .seg button:hover {
    color: var(--color-text-primary);
  }
  .seg button.on {
    background: var(--color-bg-overlay);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-sm);
  }
  /* The previous numbers stay while the next period loads */
  .body {
    transition: opacity var(--transition-base);
  }
  .body.dim {
    opacity: 0.55;
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .kpi {
    display: flex;
    flex-direction: column;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: 12px 14px;
    min-width: 0;
    color: inherit;
  }
  a.kpi:hover {
    border-color: var(--color-border-hover);
    background: var(--color-bg-overlay);
    color: inherit;
  }
  .kpi .l {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .kpi .v {
    font-size: 1.75rem;
    font-weight: 600;
    color: var(--color-text-primary);
    letter-spacing: -0.02em;
    line-height: 1.2;
    margin-top: 2px;
  }
  .kpi .s {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    line-height: 1.4;
    margin-top: 2px;
  }
  .d {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .up {
    color: var(--color-success);
  }
  .down {
    color: var(--color-warning);
  }

  /* 12 columns across the full width; one column on narrow screens */
  .grid {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--space-4);
    align-items: stretch;
  }
  .tbtn {
    font: inherit;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 2px 8px;
    cursor: pointer;
  }
  .tbtn:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-hover);
  }
  .sub-h {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
    margin: 0 0 4px;
  }
  .sub-h:not(:first-of-type) {
    margin-top: var(--space-4);
  }
  .plist {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .plist li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    border-bottom: 1px solid var(--color-border);
    font-size: var(--text-sm);
  }
  .plist li:last-child {
    border-bottom: none;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .grow a,
  .track-name {
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .sub {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .t {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
  .on {
    font-size: var(--text-xs);
    color: var(--color-success);
    font-weight: 500;
  }
  .pill {
    font-size: 11px;
    font-weight: 500;
    padding: 0.1rem 0.5rem;
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
  .foot {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    margin: 8px 0 0;
  }
  .empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  .bars {
    display: grid;
    gap: 8px;
  }
  .bar-row {
    display: grid;
    grid-template-columns: minmax(80px, 120px) 1fr 64px;
    gap: 10px;
    align-items: center;
    font-size: var(--text-sm);
  }
  .bar-row .nm {
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar-row .track {
    height: 10px;
    border-radius: 0 4px 4px 0;
    background: var(--color-bg-subtle);
    overflow: hidden;
  }
  .bar-row .track i {
    display: block;
    height: 100%;
    min-width: 2px;
    background: var(--color-series-1);
    border-radius: 0 4px 4px 0;
  }
  .bar-row .v {
    text-align: right;
    color: var(--color-text-primary);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .scroll {
    overflow-x: auto;
  }
  .ptable {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  .ptable th {
    font-weight: 500;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    text-align: right;
    padding: 0 10px 8px;
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
  }
  .ptable td {
    padding: 8px 10px;
    text-align: right;
    color: var(--color-text-primary);
    border-bottom: 1px solid var(--color-border);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ptable :is(th, td):first-child {
    text-align: left;
    padding-left: var(--space-5);
  }
  .ptable :is(th, td):last-child {
    padding-right: var(--space-5);
  }
  .ptable tr:last-child td {
    border-bottom: none;
  }
  .ptable small {
    display: block;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
  .muted {
    color: var(--color-text-tertiary);
  }
  .tag {
    margin-left: 6px;
    font-size: 11px;
    color: var(--color-text-tertiary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    padding: 0 6px;
  }
  .errors {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: var(--space-3) var(--space-5);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
  .errors .grow {
    color: var(--color-text-secondary);
  }
  .errors a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  @media (max-width: 1100px) {
    .kpis {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 880px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
    .sum {
      font-size: var(--text-base);
    }
    .kpis {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .kpi .v {
      font-size: 1.4rem;
    }
    .errors {
      flex-wrap: wrap;
    }
  }
</style>
