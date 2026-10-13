<script lang="ts">
  import { onMount, getContext } from 'svelte';
  import { page } from '$app/stores';
  import { goto, replaceState } from '$app/navigation';
  import { api } from '$lib/api/client.js';
  import { toast, toastSuccess } from '$lib/stores/toast.js';
  import { loadOverview } from '$lib/stores/overview.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import { formatFileSize, formatGb, formatTime, timeAgo, trashDaysLeft } from '$lib/utils/format.js';
  import { spurDisplayName, versionTitle } from '$lib/utils/track.js';
  import { TRASH_DAYS } from '@music-hub/shared';

  type Base = { id: string; deletedAt: string; projectId: string; projectName: string; trackId: string; trackName: string };
  type Entry =
    | (Base & {
        kind: 'track';
        coverUrl: string | null;
        versionCount: number;
        commentCount: number;
        stemCount: number;
        shareLinkCount: number;
        bytes: number;
      })
    | (Base & {
        kind: 'version';
        versionNumber: number;
        label: string | null;
        branchLabel: string | null;
        originalFileName: string;
        commentCount: number;
        shareLinkCount: number;
        bytes: number;
      })
    | (Base & { kind: 'stem'; name: string; bytes: number })
    | (Base & { kind: 'revision'; name: string; originalFileName: string; bytes: number })
    | (Base & {
        kind: 'comment';
        versionId: string;
        versionNumber: number;
        body: string;
        timestampSeconds: number | null;
        replyCount: number;
      });
  type Filter = 'all' | Entry['kind'];

  const reloadSidebar = getContext<(() => void) | undefined>('reloadSidebar');

  const FILTERS: [Filter, string][] = [
    ['all', 'Alle'],
    ['track', 'Tracks'],
    ['version', 'Versionen'],
    ['stem', 'Spuren'],
    ['revision', 'Fassungen'],
    ['comment', 'Kommentare'],
  ];

  let entries = $state<Entry[]>([]);
  let loading = $state(true);
  let filter = $state<Filter>('all');
  // All projects or one, kept in ?project= so the project page can link here
  let projectFilter = $state($page.url.searchParams.get('project') ?? '');
  // The projects as loaded, so one stays selectable once its last entry is gone
  let projectOptions = $state<{ id: string; name: string }[]>([]);
  let menuFor = $state<string | null>(null);
  let discarding = $state<Entry | null>(null);
  let discardOpen = $state(false);
  let emptyOpen = $state(false);
  let busy = $state(false);

  const scoped = $derived(projectFilter ? entries.filter((e) => e.projectId === projectFilter) : entries);
  const shown = $derived(filter === 'all' ? scoped : scoped.filter((e) => e.kind === filter));
  const bytes = $derived(scoped.reduce((sum, e) => sum + ('bytes' in e ? e.bytes : 0), 0));
  const countOf = (f: Filter) => (f === 'all' ? scoped.length : scoped.filter((e) => e.kind === f).length);
  const projectName = $derived(projectOptions.find((p) => p.id === projectFilter)?.name ?? '');
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const size = (b: number) => (b >= 1024 ** 3 ? formatGb(b) : formatFileSize(b));

  onMount(async () => {
    try {
      entries = (await api.get<{ entries: Entry[] }>('/trash')).entries;
      projectOptions = [...new Map(entries.map((e) => [e.projectId, e.projectName]))]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
      if (projectFilter && !projectOptions.some((p) => p.id === projectFilter)) selectProject('');
    } finally {
      loading = false;
    }
  });

  function selectProject(id: string) {
    projectFilter = id;
    const url = new URL($page.url);
    if (id) url.searchParams.set('project', id);
    else url.searchParams.delete('project');
    replaceState(url, {});
  }

  function title(e: Entry) {
    if (e.kind === 'track') return e.trackName;
    if (e.kind === 'version') return `V${e.versionNumber} · ${versionTitle(e)}`;
    if (e.kind === 'stem') return spurDisplayName(e.name, e.trackName);
    if (e.kind === 'revision') return e.originalFileName;
    return `„${e.body}“`;
  }

  // "„Nachtbus“", "V4", "Spur „Kick In“", "Kommentar"
  function shortName(e: Entry) {
    if (e.kind === 'track') return `„${e.trackName}“`;
    if (e.kind === 'version') return `V${e.versionNumber}`;
    if (e.kind === 'stem') return `Spur „${spurDisplayName(e.name, e.trackName)}“`;
    if (e.kind === 'revision') return `Fassung „${e.originalFileName}“`;
    return 'Kommentar';
  }

  // Where a restored entry is
  function place(e: Entry) {
    const track = `/projects/${e.projectId}/tracks/${e.trackId}`;
    if (e.kind === 'version') return `${track}?v=${e.id}`;
    if (e.kind === 'comment') return `${track}?v=${e.versionId}`;
    return track;
  }

  function trackContents(e: Extract<Entry, { kind: 'track' }>, dative = false) {
    const parts = [plural(e.versionCount, 'Version', 'Versionen'), plural(e.commentCount, 'Kommentar', dative ? 'Kommentaren' : 'Kommentare')];
    if (e.stemCount) parts.push(plural(e.stemCount, 'Spur', 'Spuren'));
    if (e.shareLinkCount) parts.push(plural(e.shareLinkCount, 'Freigabelink', 'Freigabelinks'));
    if (!dative) return parts.join(' · ');
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}` : parts[0];
  }

  async function restore(e: Entry) {
    await api.post(`/trash/${e.kind}/${e.id}/restore`);
    entries = entries.filter((x) => x.id !== e.id);
    if (e.kind === 'track') reloadSidebar?.();
    void loadOverview();
    toast(`${shortName(e)} ist wieder da`, 'success', 6000, { label: 'Ansehen', run: () => goto(place(e)) });
  }

  function askDiscard(e: Entry) {
    menuFor = null;
    discarding = e;
    discardOpen = true;
  }

  async function discard() {
    const e = discarding;
    if (!e) return;
    busy = true;
    try {
      await api.delete(`/trash/${e.kind}/${e.id}`);
      entries = entries.filter((x) => x.id !== e.id);
      discardOpen = false;
      toastSuccess('Endgültig gelöscht');
    } catch {
      // The API client already showed the error
    } finally {
      busy = false;
    }
  }

  async function emptyTrash() {
    busy = true;
    try {
      await api.delete(projectFilter ? `/trash?project=${projectFilter}` : '/trash');
      entries = entries.filter((e) => projectFilter && e.projectId !== projectFilter);
      emptyOpen = false;
      toastSuccess('Papierkorb geleert');
    } catch {
      // The API client already showed the error
    } finally {
      busy = false;
    }
  }

  function handleWindowClick(ev: MouseEvent) {
    if (!(ev.target as Element).closest('.row-menu')) menuFor = null;
  }
</script>

<svelte:window onclick={handleWindowClick} />

<TopBar crumbs={[{ label: 'Papierkorb' }]} />

<div class="trash-page">
  <header class="head">
    <span class="head-icon"><Icon name="trash" size={24} /></span>
    <div class="grow">
      <h1>Papierkorb</h1>
      <p>
        Gelöschtes aus {projectName ? `„${projectName}“` : 'deinen Projekten'} bleibt {TRASH_DAYS} Tage hier und wird
        danach endgültig gelöscht.
      </p>
      {#if bytes > 0}
        <p>Die Dateien darin belegen {size(bytes)} und zählen weiter zum Speicher.</p>
      {/if}
    </div>
    {#if scoped.length > 0}
      <Button variant="danger" size="sm" onclick={() => (emptyOpen = true)}><Icon name="trash" size={13} /> Papierkorb leeren</Button>
    {/if}
  </header>

  {#if loading}
    <div class="list">
      {#each [1, 2, 3] as _}
        <div class="row"><Skeleton width="50%" height="1rem" /></div>
      {/each}
    </div>
  {:else if entries.length === 0}
    <div class="empty">
      <Icon name="trash" size={28} />
      <b>Der Papierkorb ist leer</b>
      <p>Gelöschte Tracks, Versionen, Spuren und Kommentare aus allen Projekten landen hier und lassen sich {TRASH_DAYS} Tage lang wiederherstellen.</p>
    </div>
  {:else}
    <div class="toolbar">
      {#if projectOptions.length > 1}
        <select
          class="project-select"
          aria-label="Projekt"
          value={projectFilter}
          onchange={(ev) => selectProject(ev.currentTarget.value)}
        >
          <option value="">Alle Projekte</option>
          {#each projectOptions as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      {/if}
      <div class="filter" role="tablist">
        {#each FILTERS.filter(([f]) => f !== 'revision' || countOf(f) > 0) as [f, label]}
          <button role="tab" aria-selected={filter === f} class:on={filter === f} onclick={() => (filter = f)}>
            {label} <i>{countOf(f)}</i>
          </button>
        {/each}
      </div>
    </div>

    {#if shown.length === 0}
      <p class="none">Nichts in dieser Auswahl.</p>
    {:else}
      <div class="list">
        {#each shown as e (e.id)}
          {@const left = trashDaysLeft(e.deletedAt)}
          <div class="row">
            {#if e.kind === 'track'}
              <CoverImage src={e.coverUrl} name={e.trackName} size="sm" rounded="sm" />
            {:else}
              <span class="kind">
                {#if e.kind === 'version'}V{e.versionNumber}{:else}<Icon name={e.kind === 'stem' || e.kind === 'revision' ? 'music' : 'comment'} size={15} />{/if}
              </span>
            {/if}
            <div class="main">
              <div class="title">{title(e)}</div>
              <div class="sub">
                {#if !projectFilter}<span class="project">{e.projectName}</span> · {/if}
                {#if e.kind === 'track'}
                  Track · {trackContents(e)}
                {:else if e.kind === 'version'}
                  Version von <b>{e.trackName}</b> · {plural(e.commentCount, 'Kommentar', 'Kommentare')}{#if e.shareLinkCount} · {plural(e.shareLinkCount, 'Freigabelink', 'Freigabelinks')}{/if}
                {:else if e.kind === 'stem'}
                  Spur von <b>{e.trackName}</b> · {formatFileSize(e.bytes)}
                {:else if e.kind === 'revision'}
                  Frühere Fassung von <b>{spurDisplayName(e.name, e.trackName)}</b> in <b>{e.trackName}</b> · {formatFileSize(e.bytes)}
                {:else}
                  Kommentar zu <b>{e.trackName}</b> · V{e.versionNumber}{#if e.timestampSeconds !== null} bei {formatTime(e.timestampSeconds)}{/if}{#if e.replyCount} · {plural(e.replyCount, 'Antwort bleibt', 'Antworten bleiben')} sichtbar{/if}
                {/if}
              </div>
            </div>
            <div class="meta">
              Gelöscht {timeAgo(e.deletedAt)}
              <span class="left" class:soon={left <= 3}>noch {left} {left === 1 ? 'Tag' : 'Tage'}</span>
            </div>
            <div class="acts">
              <Button variant="secondary" size="sm" onclick={() => restore(e)}>
                <Icon name="restore" size={13} /> <span class="btn-label">Wiederherstellen</span>
              </Button>
              <div class="row-menu">
                <button class="icon-btn" aria-label="Weitere Aktionen" onclick={() => (menuFor = menuFor === e.id ? null : e.id)}>
                  <Icon name="more" size={16} />
                </button>
                {#if menuFor === e.id}
                  <div class="menu" role="menu">
                    <button role="menuitem" class="danger" onclick={() => askDiscard(e)}><Icon name="trash" size={14} /> Endgültig löschen</button>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <p class="foot">
      Du siehst nur, was du wiederherstellen darfst: in deinen eigenen Projekten Tracks, Versionen, Spuren und ihre
      Fassungen, in anderen deine eigenen Spuren und Fassungen, dazu überall deine eigenen Kommentare.
    </p>
  {/if}
</div>

<Modal bind:open={discardOpen} title="Endgültig löschen?">
  {#if discarding}
    <p class="modal-text">
      {#if discarding.kind === 'track'}
        <strong>„{discarding.trackName}“</strong> wird mit {trackContents(discarding, true)} endgültig gelöscht, auch die Audiodateien.
      {:else if discarding.kind === 'version'}
        <strong>{title(discarding)}</strong> wird mit {plural(discarding.commentCount, 'Kommentar', 'Kommentaren')} endgültig gelöscht, auch die Audiodatei.
      {:else if discarding.kind === 'stem'}
        Die Spur <strong>„{title(discarding)}“</strong> wird endgültig gelöscht, auch die Datei.
      {:else if discarding.kind === 'revision'}
        Die frühere Fassung <strong>„{title(discarding)}“</strong> wird endgültig gelöscht, auch die Datei.
      {:else}
        Dein Kommentar <strong>{title(discarding)}</strong> wird endgültig gelöscht.
      {/if}
    </p>
    <p class="modal-text">Danach kannst du es nicht mehr wiederherstellen.</p>
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (discardOpen = false)}>Abbrechen</Button>
    <Button variant="danger" loading={busy} onclick={discard}>Endgültig löschen</Button>
  {/snippet}
</Modal>

<Modal bind:open={emptyOpen} title="Papierkorb leeren?">
  <p class="modal-text">
    {plural(scoped.length, 'Eintrag wird', 'Einträge werden')}{projectName ? ` aus „${projectName}“` : ''} endgültig gelöscht, mit allen Versionen, Kommentaren und
    Dateien darin.
  </p>
  <p class="modal-text">Danach kannst du sie nicht mehr wiederherstellen.</p>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (emptyOpen = false)}>Abbrechen</Button>
    <Button variant="danger" loading={busy} onclick={emptyTrash}>Papierkorb leeren</Button>
  {/snippet}
</Modal>

<style>
  .trash-page {
    padding: var(--space-6) var(--space-6) var(--space-12);
    max-width: 1000px;
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }

  .head-icon {
    width: 56px;
    height: 56px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-raised);
    color: var(--color-text-secondary);
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-size: var(--text-2xl);
  }

  .head p {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .project-select {
    height: 32px;
    max-width: 100%;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-xs);
  }

  .filter {
    display: inline-flex;
    max-width: 100%;
    padding: 2px;
    overflow-x: auto;
    scrollbar-width: none;
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .filter button {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--text-xs);
    white-space: nowrap;
    cursor: pointer;
  }

  .filter button.on {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }

  .filter i {
    font-style: normal;
    color: var(--color-text-tertiary);
  }

  .filter button.on i {
    color: var(--color-text-secondary);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .kind {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 700;
  }

  .main {
    min-width: 0;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-primary);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }

  .sub b,
  .sub .project {
    color: var(--color-text-secondary);
    font-weight: 500;
  }

  .meta {
    text-align: right;
    white-space: nowrap;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }

  .left {
    display: block;
  }

  .left.soon {
    color: var(--color-warning);
  }

  .acts {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .row-menu {
    position: relative;
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    display: inline-grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: var(--z-dropdown);
    min-width: 200px;
    padding: 6px;
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .menu button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 8px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-error);
    font-family: inherit;
    font-size: var(--text-sm);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .menu button:hover {
    background: var(--color-bg-subtle);
  }

  .none {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  .empty {
    padding: var(--space-12) var(--space-4);
    text-align: center;
    border: 1px dashed var(--color-border-hover);
    border-radius: var(--radius-lg);
  }

  .empty b {
    display: block;
    margin: var(--space-3) 0 var(--space-1);
    color: var(--color-text-primary);
    font-weight: 600;
  }

  .empty p {
    margin: 0;
    font-size: var(--text-sm);
  }

  .foot {
    margin-top: var(--space-5);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .modal-text {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
  }

  .modal-text:last-child {
    margin-bottom: 0;
  }

  .modal-text strong {
    color: var(--color-text-primary);
  }

  @media (max-width: 720px) {
    .row {
      grid-template-columns: auto 1fr auto;
      grid-template-areas:
        'kind main acts'
        'kind meta acts';
      gap: 2px var(--space-3);
    }

    .row > :first-child {
      grid-area: kind;
      align-self: start;
    }

    .main {
      grid-area: main;
    }

    .meta {
      grid-area: meta;
      text-align: left;
    }

    .left {
      display: inline;
    }

    .left::before {
      content: ' · ';
    }

    .acts {
      grid-area: acts;
    }

    .sub {
      white-space: normal;
    }
  }

  @media (max-width: 640px) {
    .trash-page {
      padding: var(--space-4) var(--space-4) var(--space-12);
    }
  }

  @media (max-width: 540px) {
    .head {
      flex-wrap: wrap;
      gap: var(--space-3);
    }

    .head-icon {
      display: none;
    }

    .grow {
      flex-basis: 100%;
    }

    h1 {
      font-size: var(--text-xl);
    }

    .filter {
      mask-image: linear-gradient(to right, #000 85%, transparent);
    }
  }

  @media (max-width: 480px) {
    /* Hidden from sight only, the button keeps its name for screen readers */
    .btn-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
</style>
