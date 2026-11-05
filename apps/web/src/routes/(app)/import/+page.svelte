<script lang="ts">
  import { onDestroy, onMount, getContext } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { IMPORT_KINDS, isVersionable, type ImportKind, type ImportPlan, type PlannedItem } from '@music-hub/shared';
  import { t } from '$lib/i18n/index.js';
  import { api } from '$lib/api/client.js';
  import { ask } from '$lib/stores/confirm.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import { formatFileSize, formatGb } from '$lib/utils/format.js';

  type Connection = { configured: boolean; connected: boolean; displayName: string | null };
  type Entry = { path: string; size: number; modified: string };
  type Scan = { id: string; rootName: string; entries: Entry[]; plan: ImportPlan; duplicates: number[]; storage: { used: number; limit: number } };
  type StatusItem = {
    id: string; kind: 'version' | 'stem' | 'file'; name: string; status: 'pending' | 'done' | 'failed'; error: string | null;
    fileSize: number; projectId: string; trackId: string | null; projectName: string; trackName: string | null;
  };
  type Status = { id: string; status: 'scanned' | 'running' | 'done' | 'cancelled'; rootName: string; items: StatusItem[] };

  const reloadSidebar = getContext<(() => void) | undefined>('reloadSidebar');

  let connection = $state<Connection | null>(null);
  let path = $state('');
  let folders = $state<{ name: string; path: string }[] | null>(null);
  let scanning = $state(false);
  let scan = $state<Scan | null>(null);
  let plan = $state<ImportPlan | null>(null);
  let starting = $state(false);
  let status = $state<Status | null>(null);
  let showKept = $state<Record<string, boolean>>({});
  let moving = $state<number | null>(null);
  let poll: ReturnType<typeof setInterval> | undefined;

  const failedConnect = page.url.searchParams.get('dropbox') === 'failed';
  const crumbs = $derived([{ label: t().importer.root, path: '' }, ...path.split('/').filter(Boolean).map((name, i, all) => ({ label: name, path: `/${all.slice(0, i + 1).join('/')}` }))]);

  const duplicate = $derived(new Set(scan?.duplicates ?? []));
  const counted = $derived(plan ? plan.items.filter((item) => item.kind !== 'skip' && !duplicate.has(item.entry)) : []);
  const totalSize = $derived(scan ? counted.reduce((sum, item) => sum + scan!.entries[item.entry].size, 0) : 0);
  const fits = $derived(scan ? totalSize <= scan.storage.limit - scan.storage.used : true);
  const totals = $derived.by(() => {
    const songs = new Set(counted.filter((item) => item.track !== null).map((item) => item.track));
    const projects = new Set(counted.map((item) => item.project));
    return {
      projects: projects.size,
      songs: songs.size,
      versions: counted.filter((item) => item.kind === 'version').length,
      stems: counted.filter((item) => item.kind === 'stem').length,
    };
  });

  const fileName = (entry: number) => scan?.entries[entry].path.split('/').at(-1) ?? '';
  // What the server accepts: versions in the formats of the upload, stems from any audio
  const isAudio = (entry: number) => /\.(wav|aiff?|aifc|flac|mp3|m4a|aac|ogg|opus)$/i.test(fileName(entry));
  function allowed(item: PlannedItem, kind: ImportKind) {
    if (kind === 'version') return item.track !== null && isVersionable(fileName(item.entry));
    if (kind === 'stem') return item.track !== null && isAudio(item.entry);
    if (kind === 'file') return item.project !== null;
    return true;
  }
  const folderOf = (entry: number) => scan?.entries[entry].path.split('/').slice(0, -1).join('/') ?? '';
  const itemsOf = (track: number) => plan!.items.filter((item) => item.track === track);
  const projectItems = (project: number) => plan!.items.filter((item) => item.project === project && item.track === null);
  const unassigned = $derived(plan ? plan.items.filter((item) => item.project === null) : []);
  const versionNumber = (item: PlannedItem) => itemsOf(item.track!).filter((other) => other.kind === 'version').indexOf(item) + 1;

  onMount(async () => {
    connection = await api.get<Connection>('/dropbox');
    const id = page.url.searchParams.get('id');
    if (id) return follow(id);
    if (connection.connected) await open('');
  });

  onDestroy(() => clearInterval(poll));

  async function open(next: string) {
    path = next;
    folders = null;
    folders = (await api.get<{ folders: { name: string; path: string }[] }>(`/dropbox/folders?path=${encodeURIComponent(next)}`)).folders;
  }

  async function analyze() {
    scanning = true;
    try {
      scan = await api.post<Scan>('/imports/dropbox', { path });
      plan = scan.plan;
    } finally {
      scanning = false;
    }
  }

  async function disconnect() {
    if (!(await ask(t().importer.disconnectConfirm, t().importer.disconnect))) return;
    await api.delete('/dropbox');
    connection = { ...connection!, connected: false, displayName: null };
    scan = null;
    plan = null;
  }

  function setKind(item: PlannedItem, kind: ImportKind) {
    item.kind = kind;
  }

  // Where an item goes: a song (track index) or the files of a project (p + project index), or nowhere
  function target(item: PlannedItem) {
    if (item.track !== null) return `t${item.track}`;
    if (item.project !== null) return `p${item.project}`;
    return '';
  }

  function moveTo(item: PlannedItem, value: string) {
    if (value.startsWith('t')) {
      const track = Number(value.slice(1));
      item.track = track;
      item.project = plan!.tracks[track].project;
      if (item.kind === 'skip' || item.kind === 'file') item.kind = isVersionable(fileName(item.entry)) ? 'version' : isAudio(item.entry) ? 'stem' : 'file';
    } else if (value.startsWith('p')) {
      item.track = null;
      item.project = Number(value.slice(1));
      item.kind = 'file';
    } else {
      item.track = null;
      item.project = null;
      item.kind = 'skip';
    }
    // Versions are numbered in list order: a moved item goes to the end
    plan!.items = [...plan!.items.filter((other) => other !== item), item];
    moving = null;
  }

  function shift(item: PlannedItem, by: -1 | 1) {
    const siblings = itemsOf(item.track!).filter((other) => other.kind === 'version');
    const other = siblings[siblings.indexOf(item) + by];
    if (!other) return;
    const items = [...plan!.items];
    const a = items.indexOf(item);
    const b = items.indexOf(other);
    [items[a], items[b]] = [items[b], items[a]];
    plan!.items = items;
  }

  async function start() {
    if (!scan || !plan) return;
    starting = true;
    try {
      await api.post(`/imports/${scan.id}/start`, $state.snapshot(plan));
      reloadSidebar?.();
      const id = scan.id;
      scan = null;
      plan = null;
      await goto(`/import?id=${id}`, { replaceState: true });
      await follow(id);
    } finally {
      starting = false;
    }
  }

  async function follow(id: string) {
    status = await api.get<Status>(`/imports/${id}`);
    clearInterval(poll);
    if (status.status !== 'running') return;
    poll = setInterval(async () => {
      status = await api.get<Status>(`/imports/${id}`, true).catch(() => status);
      if (status?.status !== 'running') {
        clearInterval(poll);
        reloadSidebar?.();
      }
    }, 2000);
  }

  async function cancel() {
    if (!status || !(await ask(t().importer.cancelConfirm, t().importer.cancel))) return;
    await api.post(`/imports/${status.id}/cancel`);
    await follow(status.id);
  }

  async function again() {
    status = null;
    await goto('/import', { replaceState: true });
    if (connection?.connected) await open(path);
  }

  const doneCount = $derived(status ? status.items.filter((item) => item.status !== 'pending').length : 0);
  const failedItems = $derived(status ? status.items.filter((item) => item.status === 'failed') : []);
  const importedProjects = $derived(status ? [...new Map(status.items.map((item) => [item.projectId, item.projectName])).entries()] : []);
</script>

<svelte:head>
  <title>{t().importer.title} · Music Hub</title>
</svelte:head>

<TopBar crumbs={[{ label: t().importer.title }]} />

<div class="import-page">
  <header class="head">
    <div class="head-icon"><Icon name="cloud-download" size={26} /></div>
    <div class="grow">
      <h1>{t().importer.title}</h1>
      {#if connection?.connected && !status}
        <p class="muted">
          {connection.displayName ? t().importer.connectedAs(connection.displayName) : t().importer.connected}
          · <button class="link" onclick={disconnect}>{t().importer.disconnect}</button>
        </p>
      {/if}
    </div>
  </header>

  {#if failedConnect && !connection?.connected}
    <p class="banner error">{t().importer.connectFailed}</p>
  {/if}

  {#if !connection}
    <p class="muted">{t().common.loading}</p>
  {:else if status}
    <section class="card">
      <h2>
        {status.status === 'running' ? t().importer.running : status.status === 'cancelled' ? t().importer.cancelled : t().importer.done}
        <span class="muted">· {status.rootName}</span>
      </h2>
      <div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={status.items.length} aria-valuenow={doneCount}>
        <span style:width={`${status.items.length ? (doneCount / status.items.length) * 100 : 100}%`}></span>
      </div>
      <p class="muted">
        {t().importer.progress(doneCount, status.items.length)}{#if failedItems.length} · <span class="warn">{t().importer.failed(failedItems.length)}</span>{/if}
      </p>
      <p class="hint">{status.status === 'running' ? t().importer.runningHint : t().importer.doneHint}</p>

      {#if failedItems.length}
        <ul class="failed">
          {#each failedItems as item (item.id)}
            <li>
              <span class="name">{item.trackName ?? item.projectName} · {item.name}</span>
              <span class="warn">{item.error && /not_found/.test(item.error) ? t().importer.missingInDropbox : (t().importer.errors[item.error ?? 'failed'] ?? t().importer.errors.failed)}</span>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="actions">
        {#each importedProjects as [id, name] (id)}
          <Button variant="secondary" href={`/projects/${id}`}>{t().importer.openProject(name)}</Button>
        {/each}
        {#if status.status === 'running'}
          <Button variant="ghost" onclick={cancel}>{t().importer.cancel}</Button>
        {:else}
          <Button variant="ghost" onclick={again}>{t().importer.another}</Button>
        {/if}
      </div>
    </section>
  {:else if !connection.configured}
    <p class="banner">{t().importer.unconfigured}</p>
  {:else if !connection.connected}
    <section class="card intro">
      <p>{t().importer.intro}</p>
      <ul class="points">
        {#each t().importer.points as point}
          <li><Icon name="check" size={14} /> {point}</li>
        {/each}
      </ul>
      <div class="actions">
        <Button onclick={() => (location.href = '/api/v1/dropbox/connect')}>{t().importer.connect}</Button>
        <span class="muted small">{t().importer.readOnly}</span>
      </div>
    </section>
  {:else if scanning}
    <section class="card">
      <h2>{t().importer.analyzing(crumbs.at(-1)?.label ?? '')}</h2>
      <div class="bar busy"><span></span></div>
      <p class="hint">{t().importer.analyzingHint}</p>
    </section>
  {:else if scan && plan}
    <section class="summary card">
      <div class="grow">
        <strong>{t().importer.summary(totals.projects, totals.songs, totals.versions, totals.stems)}</strong>
        <p class="muted">
          {t().importer.size(formatGb(totalSize))} · {t().importer.storageLeft(formatGb(Math.max(0, scan.storage.limit - scan.storage.used)))}
        </p>
        {#if !fits}<p class="warn">{t().importer.tooBig}</p>{/if}
        {#if scan.duplicates.length}<p class="muted small">{t().importer.duplicates(scan.duplicates.length)}</p>{/if}
        {#if plan.ignored.length}<p class="muted small">{t().importer.ignored(plan.ignored.length)}</p>{/if}
      </div>
    </section>

    {#if plan.items.every((item) => item.kind === 'skip')}
      <p class="banner">{t().importer.nothing}</p>
    {/if}

    {#snippet row(item: PlannedItem)}
      {@const entry = scan!.entries[item.entry]}
      <li class="item" class:skip={item.kind === 'skip'} class:dup={duplicate.has(item.entry)}>
        <span class="kind-tag {item.kind}">
          {item.kind === 'version' ? `V${versionNumber(item)}` : item.kind === 'stem' ? 'S' : item.kind === 'file' ? 'F' : '–'}
        </span>
        <span class="file">
          <span class="name" title={entry.path}>{fileName(item.entry)}</span>
          <span class="sub">{folderOf(item.entry) || scan!.rootName} · {formatFileSize(entry.size)}{#if duplicate.has(item.entry)} · <b>{t().importer.already}</b>{/if}</span>
        </span>
        <span class="controls">
          {#if item.kind === 'version'}
            <button class="icon" aria-label={t().importer.earlier} title={t().importer.earlier} onclick={() => shift(item, -1)}><Icon name="chevron-up" size={14} /></button>
            <button class="icon" aria-label={t().importer.later} title={t().importer.later} onclick={() => shift(item, 1)}><Icon name="chevron-down" size={14} /></button>
          {/if}
          <select aria-label={t().importer.kindLabel} value={item.kind} onchange={(e) => setKind(item, e.currentTarget.value as ImportKind)}>
            {#each IMPORT_KINDS as kind}
              <option value={kind} disabled={!allowed(item, kind)}>{t().importer.kinds[kind]}</option>
            {/each}
          </select>
          {#if moving === item.entry}
            <select aria-label={t().importer.moveLabel} value={target(item)} onchange={(e) => moveTo(item, e.currentTarget.value)}>
              <option value="">{t().importer.nowhere}</option>
              {#each plan!.projects as project, p}
                <optgroup label={project.name}>
                  <option value={`p${p}`}>{t().importer.intoProject(project.name)}</option>
                  {#each plan!.tracks as track, tr}
                    {#if track.project === p}<option value={`t${tr}`}>{track.name}</option>{/if}
                  {/each}
                </optgroup>
              {/each}
            </select>
          {:else}
            <button class="icon" aria-label={t().importer.move} title={t().importer.move} onclick={() => (moving = item.entry)}><Icon name="more" size={14} /></button>
          {/if}
        </span>
      </li>
    {/snippet}

    {#snippet list(items: PlannedItem[], key: string)}
      {@const shown = items.filter((item) => item.kind !== 'skip')}
      {@const kept = items.filter((item) => item.kind === 'skip')}
      <ul class="items">
        {#each shown as item (item.entry)}{@render row(item)}{/each}
        {#if kept.length}
          <li class="kept">
            <button class="link" onclick={() => (showKept[key] = !showKept[key])}>
              {t().importer.kept(kept.length)} · {showKept[key] ? t().importer.hide : t().importer.show}
            </button>
          </li>
          {#if showKept[key]}
            {#each kept as item (item.entry)}{@render row(item)}{/each}
          {/if}
        {/if}
      </ul>
    {/snippet}

    {#each plan.projects as project, p}
      {#if plan.items.some((item) => item.project === p)}
        <section class="card project">
          <label class="name-field project-name">
            <span class="label">{t().importer.project}</span>
            <input aria-label={t().importer.projectName} bind:value={project.name} maxlength="255" />
          </label>
          {#each plan.tracks as track, tr}
            {#if track.project === p && itemsOf(tr).length}
              <div class="track">
                <label class="name-field">
                  <Icon name="music" size={14} />
                  <input aria-label={t().importer.songName} bind:value={track.name} maxlength="255" />
                </label>
                {@render list(itemsOf(tr), `t${tr}`)}
              </div>
            {/if}
          {/each}
          {#if projectItems(p).length}
            <div class="track">
              <div class="name-field static"><Icon name="layers" size={14} /> {t().importer.projectFiles}</div>
              {@render list(projectItems(p), `p${p}`)}
            </div>
          {/if}
        </section>
      {/if}
    {/each}

    {#if unassigned.length}
      <section class="card project">
        <h2>{t().importer.unassigned}</h2>
        <p class="hint">{t().importer.unassignedHint}</p>
        {@render list(unassigned, 'none')}
      </section>
    {/if}

    <div class="sticky">
      <Button variant="ghost" onclick={() => { scan = null; plan = null; }}>{t().importer.otherFolder}</Button>
      <Button loading={starting} disabled={!fits || counted.length === 0 || plan.projects.some((p) => !p.name.trim()) || plan.tracks.some((tr) => !tr.name.trim())} onclick={start}>
        {t().importer.start}
      </Button>
    </div>
  {:else}
    <section class="card">
      <h2>{t().importer.pickFolder}</h2>
      <nav class="path" aria-label="Breadcrumb">
        {#each crumbs as crumb, i}
          {#if i > 0}<span class="sep">/</span>{/if}
          {#if i < crumbs.length - 1}
            <button class="link" onclick={() => open(crumb.path)}>{crumb.label}</button>
          {:else}
            <span class="current">{crumb.label}</span>
          {/if}
        {/each}
      </nav>
      {#if folders === null}
        <p class="muted">{t().common.loading}</p>
      {:else if folders.length === 0}
        <p class="muted">{t().importer.noFolders}</p>
      {:else}
        <ul class="folders">
          {#each folders as folder (folder.path)}
            <li>
              <button onclick={() => open(folder.path)}>
                <Icon name="drive" size={16} />
                <span>{folder.name}</span>
                <Icon name="chevron-right" size={14} />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="actions">
        <Button disabled={path === ''} onclick={analyze}>{t().importer.analyze}</Button>
      </div>
    </section>
  {/if}
</div>

<style>
  .import-page {
    padding: var(--space-6) var(--space-6) var(--space-12);
    max-width: 920px;
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

  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-lg);
  }

  .muted {
    margin: var(--space-1) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .small {
    font-size: var(--text-xs);
  }

  .hint {
    margin: var(--space-2) 0 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }

  .warn {
    color: var(--color-warning);
  }

  .banner {
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-overlay);
    font-size: var(--text-sm);
  }

  .banner.error {
    border-color: var(--color-error);
  }

  .card {
    margin-bottom: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-overlay);
  }

  .intro p {
    margin: 0;
    line-height: 1.5;
  }

  .points {
    margin: var(--space-3) 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .points li {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin-top: var(--space-4);
  }

  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--color-accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }

  .path {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
    font-size: var(--text-sm);
  }

  .path .sep {
    color: var(--color-text-tertiary);
  }

  .path .current {
    font-weight: 600;
  }

  .folders {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    max-height: 50vh;
    overflow-y: auto;
  }

  .folders li + li {
    border-top: 1px solid var(--color-border);
  }

  .folders button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: none;
    background: none;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .folders button span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folders button:hover {
    background: var(--color-bg-subtle);
  }

  .bar {
    height: 8px;
    margin-top: var(--space-2);
    border-radius: 4px;
    background: var(--color-bg-subtle);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 0.4s ease;
  }

  .bar.busy span {
    width: 30%;
    animation: slide 1.2s ease-in-out infinite;
  }

  @keyframes slide {
    from { transform: translateX(-100%); }
    to { transform: translateX(340%); }
  }

  .summary {
    display: flex;
    gap: var(--space-4);
    position: sticky;
    top: 0;
    z-index: 2;
  }

  .name-field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
  }

  .name-field input {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-base);
    font-weight: 600;
  }

  .name-field input:hover,
  .name-field input:focus {
    border-color: var(--color-border);
    background: var(--color-bg-base);
  }

  .project-name .label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .project-name input {
    font-size: var(--text-lg);
  }

  .name-field.static {
    height: 34px;
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .track {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
  }

  .items {
    margin: var(--space-1) 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 2px;
  }

  .item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
  }

  .item:hover {
    background: var(--color-bg-subtle);
  }

  .item.skip,
  .item.dup {
    opacity: 0.6;
  }

  .kind-tag {
    width: 30px;
    height: 24px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 700;
  }

  .kind-tag.version {
    background: var(--color-accent-subtle);
    color: var(--color-text-primary);
  }

  .file {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .file .name,
  .file .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file .name {
    font-size: var(--text-sm);
  }

  .file .sub {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .controls select {
    height: 30px;
    max-width: 180px;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-xs);
  }

  .icon {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .icon:hover {
    background: var(--color-bg-base);
    color: var(--color-text-primary);
  }

  .kept {
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .kept .link {
    color: var(--color-text-secondary);
  }

  .failed {
    margin: var(--space-3) 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }

  .failed li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .failed .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sticky {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) 0 calc(var(--space-3) + env(safe-area-inset-bottom));
    background: linear-gradient(to top, var(--color-bg-base) 70%, transparent);
  }

  @media (max-width: 640px) {
    .import-page {
      padding: var(--space-4) var(--space-3) var(--space-12);
    }

    .card {
      padding: var(--space-3);
    }

    .item {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .controls {
      grid-column: 1 / -1;
      justify-content: flex-end;
      flex-wrap: wrap;
    }

    .summary {
      position: static;
    }

    /* Above the bottom navigation */
    .sticky {
      bottom: calc(56px + env(safe-area-inset-bottom, 0px));
      padding-bottom: var(--space-3);
    }
  }
</style>
