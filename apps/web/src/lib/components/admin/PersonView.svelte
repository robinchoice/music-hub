<script lang="ts">
  import { ROLE_LABELS } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import ColumnChart from './ColumnChart.svelte';
  import EventLine from './EventLine.svelte';
  import PersonAvatar from './PersonAvatar.svelte';
  import { formatGb, formatWhen } from '$lib/utils/format.js';
  import {
    ACTION_LABEL,
    VIA_LABEL,
    apart,
    eventIcon,
    inviteState,
    plural,
    pointLabel,
    type Column,
    type PersonDetail,
  } from '$lib/utils/admin.js';

  // Everything about one person; the user list shows it beside the list, /admin/users/[id] on its own
  let { userId, onclose }: { userId: string; onclose?: () => void } = $props();

  let detail = $state<PersonDetail | null>(null);
  let failed = $state(false);
  let range = $state<'d30' | 'all'>('d30');
  let table = $state(false);

  $effect(() => {
    const id = userId;
    detail = null;
    failed = false;
    api
      .get<PersonDetail>(`/admin/users/${id}`, true)
      .then((d) => {
        if (id === userId) detail = d;
      })
      .catch(() => {
        if (id === userId) failed = true;
      });
  });

  const p = $derived(detail?.person ?? null);
  const counts = $derived(p ? (range === 'd30' ? p.counts : p.countsAll) : null);
  const names = $derived(new Map(p ? [[p.id, p]] : []));
  const invite = $derived(p ? inviteState(p) : null);
  const longDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });

  const columns = $derived<Column[]>(
    (detail?.weekly ?? []).map((w, i, all) => {
      const label = pointLabel(w.start, 'week');
      const running = i === all.length - 1;
      const tip = `${plural(w.value, 'Aktion', 'Aktionen')}\n${label}${running ? ', läuft' : ''}`;
      return { label, value: w.value, tip, tick: i % 3 === 0 || running };
    }),
  );

  // The last action, with its time when it lies apart from the last activity
  const lastText = $derived.by(() => {
    if (!p?.lastAction) return '';
    const label = ACTION_LABEL[p.lastAction.type];
    return p.online || apart(p.lastAction.at, p.lastActiveAt) ? `${label}, ${formatWhen(p.lastAction.at)}` : label;
  });

  const tiles = $derived(
    counts
      ? [
          { label: 'Uploads', value: counts.versions + counts.stems, sub: counts.stems ? `davon ${counts.stems} Stems` : '' },
          { label: 'Kommentare', value: counts.comments, sub: '' },
          {
            label: 'Freigaben',
            value: counts.approvals,
            sub: 'seit Okt. 2026',
            tip: 'Wer freigegeben hat, wird erst seit Oktober 2026 gespeichert.',
          },
          { label: 'Share-Plays', value: counts.plays, sub: 'eigene Links' },
        ]
      : [],
  );

  const deviceIcon = (d: PersonDetail['devices'][number]) =>
    d.kind === 'plugin' ? 'plug' : /iPhone|iPad|Android/.test(d.label) ? 'smartphone' : 'monitor';
</script>

<div class="pv">
  <header class="head">
    {#if p}
      <PersonAvatar person={p} size="lg" />
      <div class="who">
        <h2>{p.name}{#if p.isAdmin}<span class="badge">Admin</span>{/if}</h2>
        <a class="mail" href="mailto:{p.email}">{p.email}</a>
        <div class="state">
          {#if p.pending}
            Nie angemeldet
          {:else if p.online}
            <span class="online">online</span>{lastText ? ` · zuletzt: ${lastText}` : ''}
          {:else if p.lastActiveAt}
            Zuletzt aktiv {formatWhen(p.lastActiveAt)}{lastText ? ` · ${lastText}` : ''}
          {/if}
        </div>
      </div>
    {:else}
      <div class="who"><Skeleton width="55%" height="1.2rem" /></div>
    {/if}
    {#if onclose}
      <button type="button" class="close" onclick={onclose} aria-label="Schließen"><Icon name="x" size={18} /></button>
    {/if}
  </header>

  {#if failed}
    <p class="empty pad">Die Daten ließen sich nicht laden.</p>
  {:else if !detail || !p}
    <div class="pad loading">
      <Skeleton height="5rem" variant="rect" />
      <Skeleton height="7rem" variant="rect" />
    </div>
  {:else if p.pending}
    <div class="body">
      <div class="invite">
        {#if p.invitedTo}
          Eingeladen am <b>{formatWhen(p.invitedTo.at)}</b> zu <b>{p.invitedTo.projectName}</b> als {ROLE_LABELS[p.invitedTo.role]}.
        {/if}
        Noch nie angemeldet, als Name steht noch der Teil der Adresse vor dem @.
        {#if invite}{invite.long}{/if}
        Über die Login-Seite lässt sich jederzeit ein Magic Link anfordern.
      </div>
      {@render projectList()}
    </div>
  {:else}
    <div class="body">
      <div class="cols">
        <section>
          <dl class="facts">
            <dt>Dabei seit</dt>
            <dd>{longDate(p.createdAt)}{#if p.invitedTo}<small>eingeladen zu {p.invitedTo.projectName}</small>{/if}</dd>
            <dt>Anmeldung</dt>
            <dd>{p.hasPassword ? 'Passwort gesetzt' : 'nur per Magic Link'}</dd>
            <dt>Letzter Login</dt>
            <dd>
              {#if detail.logins[0]}
                {formatWhen(detail.logins[0].at)}<small>{VIA_LABEL[detail.logins[0].via ?? '']}</small>
              {:else}
                –
              {/if}
            </dd>
            <dt>Zuletzt gesehen</dt>
            <dd>{p.lastSeenAt ? formatWhen(p.lastSeenAt) : 'noch nicht erfasst'}</dd>
            <dt>Speicher</dt>
            <dd>{formatGb(p.storageBytes)}<small>von {formatGb(detail.storageLimitBytes)}</small></dd>
          </dl>
        </section>

        <section>
          <h3>
            Zahlen
            <span class="seg" role="group" aria-label="Zeitraum">
              <button type="button" class:on={range === 'd30'} onclick={() => (range = 'd30')}>30 Tage</button>
              <button type="button" class:on={range === 'all'} onclick={() => (range = 'all')}>Gesamt</button>
            </span>
          </h3>
          <div class="nums">
            {#each tiles as t (t.label)}
              <div class="num" data-tt={t.tip}>
                <span class="l">{t.label}</span>
                <b>{t.value}</b>
                <span class="s">{t.sub || ' '}</span>
              </div>
            {/each}
          </div>
        </section>

        <section>
          <h3>
            Aktionen pro Woche
            <button type="button" class="tbtn" onclick={() => (table = !table)}>{table ? 'Diagramm' : 'Tabelle'}</button>
          </h3>
          <ColumnChart {columns} height={64} running {table} labelHead="Woche" valueHead="Aktionen" />
        </section>

        <section>
          <h3>Letzte Aktivität</h3>
          {#if detail.activity.length}
            <ul class="rows">
              {#each detail.activity as e, i (i)}
                <li>
                  <span class="ic"><Icon name={eventIcon(e)} size={14} /></span>
                  <span class="grow"><EventLine event={e} people={names} own /></span>
                  <span class="t">{formatWhen(e.at)}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="empty">Außer Logins noch nichts.</p>
          {/if}
        </section>

        {@render projectList()}

        <section>
          <h3>Logins</h3>
          {#if detail.logins.length}
            <ul class="rows">
              {#each detail.logins as e, i (i)}
                <li>
                  <span class="ic"><Icon name="log-in" size={14} /></span>
                  <span class="grow">{VIA_LABEL[e.via ?? ''] ?? 'Login'}</span>
                  <span class="t">{formatWhen(e.at)}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="empty">Keine gespeichert.</p>
          {/if}
          <p class="foot">Ein Logout löscht die Session. Fehlt sie, bleibt ein Login nur sichtbar, wenn er per Magic Link lief.</p>
        </section>

        <section>
          <h3>Geräte</h3>
          {#if detail.devices.length}
            <ul class="rows">
              {#each detail.devices as d, i (i)}
                <li>
                  <span class="ic"><Icon name={deviceIcon(d)} size={14} /></span>
                  <span class="grow"><b>{d.label}</b></span>
                  <span class="t">{d.kind === 'plugin' ? 'angemeldet' : 'Push'} seit {longDate(d.since)}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="empty">Keine Push-Abos und kein Plugin.</p>
          {/if}
        </section>
      </div>
    </div>
  {/if}
</div>

{#snippet projectList()}
  <section>
    <h3>Projekte <span class="count">{detail?.projects.length ?? 0}</span></h3>
    <ul class="rows">
      {#each detail?.projects ?? [] as project (project.id)}
        <li>
          <span class="grow"><b>{project.name}</b>{#if project.artist}<span class="sub">{project.artist}</span>{/if}</span>
          <span class="role">{ROLE_LABELS[project.role]}</span>
          <span class="t">seit {longDate(project.since)}</span>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: var(--space-5) var(--space-5) var(--space-4);
    border-bottom: 1px solid var(--color-border);
  }
  .who {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .badge {
    font-size: 11px;
    font-weight: 500;
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-full);
    background: var(--color-accent-subtle);
    color: var(--color-accent-2);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    letter-spacing: 0;
  }
  .mail {
    display: block;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    margin-top: 4px;
  }
  .online {
    color: var(--color-success);
    font-weight: 500;
  }
  .close {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: 6px;
    border-radius: var(--radius-sm);
  }
  .close:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-overlay);
  }
  .pad {
    padding: var(--space-5);
  }
  .loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .body {
    padding: var(--space-4) var(--space-5) var(--space-8);
    container-type: inline-size;
  }
  .cols > section {
    break-inside: avoid;
    margin-bottom: var(--space-5);
  }
  @container (min-width: 720px) {
    .cols {
      columns: 2;
      column-gap: var(--space-8);
    }
  }
  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
  }
  h3 .seg,
  h3 .tbtn,
  h3 .count {
    margin-left: auto;
  }
  .count {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0;
    font-size: var(--text-sm);
  }
  .facts dt {
    color: var(--color-text-tertiary);
  }
  .facts dd {
    margin: 0;
    color: var(--color-text-primary);
  }
  .facts small {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    margin-left: 6px;
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    border-radius: 9px;
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    text-transform: none;
    letter-spacing: 0;
  }
  .seg button {
    height: 24px;
    padding: 0 9px;
    border-radius: 7px;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 500;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--color-bg-overlay);
    color: var(--color-text-primary);
  }
  .tbtn {
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
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
  .nums {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .num {
    display: flex;
    flex-direction: column;
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 8px 10px;
    min-width: 0;
  }
  .num .l {
    font-size: 11px;
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .num b {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .num .s {
    font-size: 11px;
    color: var(--color-text-tertiary);
    line-height: 1.35;
    white-space: pre;
  }
  @media (max-width: 640px) {
    .nums {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--color-border);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .rows li:last-child {
    border-bottom: none;
  }
  .rows b {
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .sub {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .ic {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    background: var(--color-bg-overlay);
    display: grid;
    place-items: center;
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }
  .t {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .role {
    font-size: 11px;
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-full);
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .foot {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    margin: 6px 0 0;
  }
  .empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
  .invite {
    border: 1px solid rgba(251, 191, 36, 0.3);
    background: rgba(251, 191, 36, 0.06);
    border-radius: var(--radius-md);
    padding: 12px 14px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-5);
  }
  .invite b {
    color: var(--color-text-primary);
    font-weight: 500;
  }
</style>
