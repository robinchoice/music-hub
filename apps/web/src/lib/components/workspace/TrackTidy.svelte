<script lang="ts" module>
  /** What tidying needs to know of a track */
  export type TidyTrack = { id: string; name: string; projectId: string; section: string | null };
  type Preview = {
    versions: { id: string; from: number; to: number; duplicateOf: number | null }[];
    stems: { added: number; revised: number; duplicates: number };
    files: number;
  };
</script>

<script lang="ts">
  import { songKey } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { t } from '$lib/i18n/index.js';
  import { overviewIndex } from '$lib/stores/overview.js';
  import { toast, toastSuccess, toastTrash } from '$lib/stores/toast.js';
  import ActionMenu, { type MenuEntry } from '$lib/components/ui/ActionMenu.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';

  // The menu of tracks and everything behind it: moving into another project, merging, sections,
  // renaming, the trash. Pages show the rows; this does the work and asks what it has to ask.
  let {
    sections = [],
    onchange,
    onopen,
  }: {
    /** Sections of the project on screen, for the menu */
    sections?: string[];
    /** Something changed: reload what the page shows */
    onchange: () => void | Promise<void>;
    /** "Open" in the menu */
    onopen?: (track: TidyTrack) => void;
  } = $props();

  const ix = $derived($overviewIndex);
  const owned = (projectId: string) => {
    const p = ix?.projects.get(projectId);
    return !!p && (p.myRole === 'owner' || p.myRoles.includes('owner'));
  };
  const projectName = (id: string) => ix?.projects.get(id)?.name ?? '…';
  const where = (projectId: string, section: string | null) => (section ? `${projectName(projectId)} › ${section}` : projectName(projectId));
  const what = (list: TidyTrack[]) => (list.length === 1 ? t().tidy.quoted(list[0]!.name) : t().tidy.tracks(list.length));

  // --- Menu ---
  let menuOpen = $state(false);
  let menuAt = $state<{ x: number; y: number } | null>(null);
  let menuList = $state<TidyTrack[]>([]);

  export function menu(list: TidyTrack[], at: { x: number; y: number } | null) {
    menuList = list;
    menuAt = at;
    menuOpen = true;
  }

  const menuItems = $derived.by((): MenuEntry[] => {
    const list = menuList;
    if (!list.length) return [];
    const one = list.length === 1 ? list[0]! : null;
    const mine = list.every((tr) => owned(tr.projectId));
    const sameProject = list.every((tr) => tr.projectId === list[0]!.projectId);
    const sectionItems: MenuEntry[] = [
      ...sections.map((s) => ({ label: s, checked: list.every((tr) => tr.section === s), run: () => setSection(list, s) })),
      ...(sections.length ? ['separator' as const] : []),
      { label: t().tidy.newSection, icon: 'plus', run: () => askSection(list) },
      { label: t().tidy.noSection, checked: list.every((tr) => !tr.section), run: () => setSection(list, null) },
    ];
    return [
      ...(one && onopen ? [{ label: t().tidy.open, icon: 'headphones' as const, run: () => onopen(one) }] : []),
      ...(one ? [{ label: t().tidy.rename, icon: 'edit' as const, run: () => askRename(one) }] : []),
      ...(sameProject ? [{ label: t().tidy.section, icon: 'layers' as const, items: sectionItems }] : []),
      ...(mine
        ? [
            'separator' as const,
            { label: t().tidy.move, icon: 'folder-move' as const, run: () => move(list) },
            { label: list.length > 1 ? t().tidy.mergeMany(list.length) : t().tidy.merge, icon: 'merge' as const, run: () => merge(list) },
            'separator' as const,
            { label: t().tidy.trash, icon: 'trash' as const, danger: true, run: () => trash(list) },
          ]
        : []),
    ];
  });

  // --- Sections and names: done at once, with an undo in the toast ---

  export async function setSection(list: TidyTrack[], section: string | null) {
    const before = list.map((tr) => ({ id: tr.id, section: tr.section }));
    for (const tr of list) await api.patch(`/tracks/${tr.id}`, { section });
    await onchange();
    toast(t().tidy.sectionSet(what(list), section ?? t().tidy.noSection), 'success', 8000, {
      label: t().common.undo,
      run: async () => {
        for (const b of before) await api.patch(`/tracks/${b.id}`, { section: b.section });
        await onchange();
      },
    });
  }

  let sectionOpen = $state(false);
  let sectionName = $state('');
  let sectionFor = $state<TidyTrack[]>([]);
  // A new section from the move dialog goes back there instead
  let sectionForMove = false;

  function askSection(list: TidyTrack[]) {
    sectionFor = list;
    sectionName = '';
    sectionForMove = false;
    sectionOpen = true;
  }

  async function saveSection() {
    const name = sectionName.trim();
    if (!name) return;
    sectionOpen = false;
    if (sectionForMove) {
      moveSections = [...moveSections, name];
      moveSection = name;
      return;
    }
    await setSection(sectionFor, name);
  }

  let renameOpen = $state(false);
  let renameTrack = $state<TidyTrack | null>(null);
  let renameValue = $state('');

  export function askRename(track: TidyTrack) {
    renameTrack = track;
    renameValue = track.name;
    renameOpen = true;
  }

  async function saveRename() {
    const track = renameTrack;
    const name = renameValue.trim();
    if (!track || !name || name === track.name) {
      renameOpen = false;
      return;
    }
    await api.patch(`/tracks/${track.id}`, { name });
    renameOpen = false;
    await onchange();
    toast(t().tidy.renamed(name), 'success', 8000, {
      label: t().common.undo,
      run: async () => {
        await api.patch(`/tracks/${track.id}`, { name: track.name });
        await onchange();
      },
    });
  }

  export async function trash(list: TidyTrack[]) {
    for (const tr of list) await api.delete(`/tracks/${tr.id}`);
    await onchange();
    toastTrash(t().tidy.trashed(what(list)), async () => {
      for (const tr of list) await api.post(`/trash/track/${tr.id}/restore`);
      await onchange();
    });
  }

  // --- Moving into another project ---
  let moveOpen = $state(false);
  let moveList = $state<TidyTrack[]>([]);
  let moveTo = $state<string | null>(null);
  let moveSections = $state<string[]>([]);
  let moveNames = $state<{ id: string; name: string }[]>([]);
  let moveSection = $state<string | null>(null);
  let moveProblem = $state('');
  let moving = $state(false);
  let moveChecking = $state(false);

  const moveTargets = $derived(
    ix ? [...ix.projects.values()].filter((p) => !moveList.every((tr) => tr.projectId === p.id)).sort((a, b) => a.name.localeCompare(b.name)) : [],
  );
  const clash = $derived(
    moveList.length === 1 ? moveNames.find((n) => n.name.trim().toLowerCase() === moveList[0]!.name.trim().toLowerCase()) : undefined,
  );

  export function move(list: TidyTrack[], to: string | null = null) {
    moveList = list;
    moveTo = null;
    moveProblem = '';
    moveOpen = true;
    if (to) void pickTarget(to);
  }

  async function pickTarget(projectId: string) {
    if (!owned(projectId)) return;
    moveTo = projectId;
    moveChecking = true;
    moveProblem = '';
    moveSections = [];
    moveNames = [];
    try {
    const { tracks } = await api.get<{ tracks: { id: string; name: string; section: string | null }[] }>(`/tracks/project/${projectId}`);
    if (moveTo !== projectId) return;
    moveNames = tracks;
    moveSections = [...new Set(tracks.map((tr) => tr.section?.trim()).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b));
    const kept = moveList[0]?.section ?? null;
    moveSection = kept && moveSections.includes(kept) ? kept : null;
    // Whatever keeps a track where it is shows before the click
    for (const tr of moveList) {
      try {
        await api.post(`/tracks/${tr.id}/move`, { projectId, dryRun: true }, true);
      } catch (e) {
        if (moveTo === projectId) moveProblem = (e as Error).message;
        return;
      }
    }
    } catch (e) {
      if (moveTo === projectId) moveProblem = (e as Error).message;
    } finally {
      if (moveTo === projectId) moveChecking = false;
    }
  }

  async function doMove() {
    const to = moveTo;
    if (!to) return;
    moving = true;
    const before = moveList.map((tr) => ({ id: tr.id, projectId: tr.projectId, section: tr.section }));
    const done: typeof before = [];
    try {
      for (const tr of moveList) {
        await api.post(`/tracks/${tr.id}/move`, { projectId: to, section: moveSection });
        done.push(before.find((b) => b.id === tr.id)!);
      }
      moveOpen = false;
      toast(t().tidy.moved(what(moveList), where(to, moveSection)), 'success', 8000, {
        label: t().common.undo,
        run: async () => {
          for (const b of done) await api.post(`/tracks/${b.id}/move`, { projectId: b.projectId, section: b.section });
          await onchange();
        },
      });
    } catch {
      // The API client already showed the error
    } finally {
      moving = false;
      await onchange();
    }
  }

  function newSectionForMove() {
    sectionName = '';
    sectionForMove = true;
    sectionOpen = true;
  }

  // --- Merging ---
  let mergeOpen = $state(false);
  let mergeList = $state<TidyTrack[]>([]);
  let mergeTarget = $state<string | null>(null);
  let mergeQuery = $state('');
  let previews = $state<{ source: TidyTrack; preview: Preview }[]>([]);
  let mergeProblem = $state('');
  let merging = $state(false);

  type Candidate = { id: string; name: string; projectId: string; versionCount: number };
  const candidates = $derived.by((): Candidate[] => {
    if (!ix) return [];
    const toCandidate = (id: string, name: string, projectId: string) => ({ id, name, projectId, versionCount: ix.versionsOf.get(id)?.length ?? 0 });
    if (mergeList.length > 1) return mergeList.map((tr) => toCandidate(tr.id, tr.name, tr.projectId));
    const source = mergeList[0];
    if (!source) return [];
    const key = songKey(source.name);
    const rank = (name: string) => {
      const other = songKey(name);
      if (key && other === key) return 0;
      if (key && other && (other.startsWith(key) || key.startsWith(other))) return 1;
      return 2;
    };
    const q = mergeQuery.trim().toLowerCase();
    return [...ix.tracks.values()]
      .filter((tr) => tr.id !== source.id && owned(tr.projectId) && (!q || tr.name.toLowerCase().includes(q)))
      .map((tr) => ({ ...toCandidate(tr.id, tr.name, tr.projectId), rank: rank(tr.name) }))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .slice(0, 30);
  });
  const targetTrack = $derived.by((): TidyTrack | null => {
    if (!mergeTarget || !ix) return null;
    const own = mergeList.find((tr) => tr.id === mergeTarget);
    if (own) return own;
    const tr = ix.tracks.get(mergeTarget);
    return tr ? { id: tr.id, name: tr.name, projectId: tr.projectId, section: null } : null;
  });

  export function merge(list: TidyTrack[], into: string | null = null) {
    mergeList = list;
    mergeQuery = '';
    previews = [];
    mergeProblem = '';
    mergeTarget = null;
    mergeOpen = true;
    void pickMerge(into ?? (list.length > 1 ? list[0]!.id : null));
  }

  async function pickMerge(id: string | null) {
    mergeTarget = id;
    previews = [];
    mergeProblem = '';
    if (!id) return;
    const sources = mergeList.filter((tr) => tr.id !== id);
    const found: typeof previews = [];
    for (const source of sources) {
      try {
        const { preview } = await api.post<{ preview: Preview }>(`/tracks/${source.id}/merge`, { intoTrackId: id, dryRun: true }, true);
        found.push({ source, preview });
      } catch (e) {
        if (mergeTarget === id) mergeProblem = (e as Error).message;
        return;
      }
    }
    if (mergeTarget === id) previews = found;
  }

  // Each source after the one before it: later numbers shift by what came earlier
  const plan = $derived.by(() => {
    let shift = 0;
    return previews.map(({ source, preview }) => {
      const versions = preview.versions.map((v) => ({ ...v, to: v.to + shift }));
      shift += preview.versions.length;
      return { source, versions, preview };
    });
  });
  const firstNew = $derived(plan[0]?.versions[0]?.to ?? 1);

  async function doMerge() {
    const target = targetTrack;
    if (!target) return;
    merging = true;
    const sources = mergeList.filter((tr) => tr.id !== target.id);
    try {
      for (const source of sources) await api.post(`/tracks/${source.id}/merge`, { intoTrackId: target.id });
      mergeOpen = false;
      toastSuccess(t().tidy.merged(target.name));
    } catch {
      // The API client already showed the error
    } finally {
      merging = false;
      await onchange();
    }
  }

  // --- One version into another track, or into a track of its own ---
  let versionOpen = $state(false);
  let versionFrom = $state<TidyTrack | null>(null);
  let versionItem = $state<{ id: string; versionNumber: number } | null>(null);
  let versionTarget = $state<string | null>(null);
  let versionQuery = $state('');
  let versionProblem = $state('');
  let versionMoving = $state(false);
  let versionChecking = $state(false);

  const versionCandidates = $derived.by(() => {
    const from = versionFrom;
    if (!ix || !from) return [];
    const q = versionQuery.trim().toLowerCase();
    return [...ix.tracks.values()]
      .filter((tr) => tr.id !== from.id && owned(tr.projectId) && (!q || tr.name.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.projectId === from.projectId) - Number(a.projectId === from.projectId) || a.name.localeCompare(b.name))
      .slice(0, 30);
  });

  export function moveVersion(version: { id: string; versionNumber: number }, from: TidyTrack) {
    versionItem = version;
    versionFrom = from;
    versionTarget = null;
    versionQuery = '';
    versionProblem = '';
    versionOpen = true;
  }

  async function pickVersionTarget(id: string) {
    versionTarget = id;
    versionChecking = true;
    versionProblem = '';
    try {
      await api.post(`/versions/${versionItem!.id}/move`, { trackId: id, dryRun: true }, true);
    } catch (e) {
      if (versionTarget === id) versionProblem = (e as Error).message;
    } finally {
      if (versionTarget === id) versionChecking = false;
    }
  }

  async function doMoveVersion() {
    const version = versionItem;
    const target = versionTarget ? ix?.tracks.get(versionTarget) : undefined;
    if (!version || !target) return;
    versionMoving = true;
    try {
      const res = await api.post<{ version: { versionNumber: number } }>(`/versions/${version.id}/move`, { trackId: target.id });
      versionOpen = false;
      toastSuccess(t().tidy.versionMoved(version.versionNumber, res.version.versionNumber, target.name));
      await onchange();
    } catch {
      // The API client already showed the error
    } finally {
      versionMoving = false;
    }
  }

  export async function splitVersion(version: { id: string }) {
    try {
      const res = await api.post<{ track: { name: string } }>(`/versions/${version.id}/split`, {});
      toastSuccess(t().tidy.versionSplit(res.track.name));
      await onchange();
    } catch {
      // The API client already showed the error
    }
  }

  function mergeInstead() {
    const list = moveList;
    const into = clash?.id ?? null;
    moveOpen = false;
    merge(list, into);
  }
</script>

<ActionMenu bind:open={menuOpen} at={menuAt} title={menuList.length === 1 ? menuList[0]!.name : t().tidy.tracks(menuList.length)} items={menuItems} />

<Modal bind:open={renameOpen} title={t().tidy.renameTitle}>
  <form id="tidy-rename" onsubmit={(e) => { e.preventDefault(); void saveRename(); }}>
    <Input bind:value={renameValue} autofocus maxlength={255} />
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (renameOpen = false)}>{t().common.cancel}</Button>
    <Button onclick={saveRename} disabled={!renameValue.trim()}>{t().tidy.save}</Button>
  {/snippet}
</Modal>

<Modal bind:open={sectionOpen} title={t().tidy.newSectionTitle}>
  <form onsubmit={(e) => { e.preventDefault(); void saveSection(); }}>
    <Input bind:value={sectionName} placeholder={t().tidy.newSectionHint} autofocus maxlength={100} />
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (sectionOpen = false)}>{t().common.cancel}</Button>
    <Button onclick={saveSection} disabled={!sectionName.trim()}>{t().tidy.create}</Button>
  {/snippet}
</Modal>

<Modal bind:open={moveOpen} title={t().tidy.moveTitle(what(moveList))}>
  <p class="lead">{t().tidy.moveLead}</p>
  <p class="note">{t().tidy.moveLinks}</p>
  <div class="options" role="radiogroup" aria-label={t().tidy.project}>
    {#each moveTargets as p (p.id)}
      {@const mine = owned(p.id)}
      <button type="button" role="radio" aria-checked={moveTo === p.id} class="option" class:on={moveTo === p.id} disabled={!mine} onclick={() => pickTarget(p.id)}>
        <span class="radio"></span>
        <span class="text"><b>{p.name}</b>{#if !mine}<small>{t().tidy.notYours}</small>{:else if p.artist}<small>{p.artist}</small>{/if}</span>
      </button>
      {#if moveTo === p.id}
        <div class="sections" role="radiogroup" aria-label={t().tidy.section}>
          {#each [...moveSections, null] as s (s ?? '')}
            <button type="button" role="radio" aria-checked={moveSection === s} class="option small" class:on={moveSection === s} onclick={() => (moveSection = s)}>
              <span class="radio"></span><span class="text">{s ?? t().tidy.noSection}</span>
            </button>
          {/each}
          <button type="button" class="option small" onclick={newSectionForMove}><span class="plus">+</span><span class="text">{t().tidy.newSection}</span></button>
        </div>
      {/if}
    {/each}
  </div>
  {#if clash}
    <p class="warn">{t().tidy.sameName(clash.name)} <button type="button" class="link" onclick={mergeInstead}>{t().tidy.mergeInstead}</button></p>
  {/if}
  {#if moveProblem}<p class="warn error">{moveProblem}</p>{/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (moveOpen = false)}>{t().common.cancel}</Button>
    <Button loading={moving} disabled={!moveTo || moveChecking || !!moveProblem} onclick={doMove}>{t().tidy.moveConfirm}</Button>
  {/snippet}
</Modal>

<Modal bind:open={mergeOpen} title={t().tidy.mergeTitle(what(mergeList))}>
  <p class="lead">{mergeList.length > 1 ? t().tidy.mergeLeadMany : t().tidy.mergeLeadOne}</p>
  {#if mergeList.length === 1}
    <Input bind:value={mergeQuery} placeholder={t().tidy.search} />
  {/if}
  <div class="options scroll" role="radiogroup" aria-label={t().tidy.mergeLeadOne}>
    {#each candidates as c (c.id)}
      <button type="button" role="radio" aria-checked={mergeTarget === c.id} class="option" class:on={mergeTarget === c.id} onclick={() => pickMerge(c.id)}>
        <span class="radio"></span>
        <span class="text"><b>{c.name}</b><small>{projectName(c.projectId)} · {t().workspace.music.versions(c.versionCount)}</small></span>
      </button>
    {:else}
      <p class="empty">{t().tidy.noMatch}</p>
    {/each}
  </div>
  {#if mergeProblem}
    <p class="warn error">{mergeProblem}</p>
  {:else if targetTrack && plan.length}
    <div class="preview">
      <p class="result">{t().tidy.result(targetTrack.name, projectName(targetTrack.projectId))}</p>
      <div class="chips">
        {#if firstNew > 1}<span class="chip">V1{firstNew > 2 ? `–V${firstNew - 1}` : ''}</span>{/if}
        {#each plan as p (p.source.id)}
          {#each p.versions as v (v.id)}
            <span class="chip new" class:dup={v.duplicateOf !== null} title="{p.source.name} V{v.from}">V{v.to}</span>
          {/each}
        {/each}
      </div>
      <ul>
        <li>{t().tidy.previewVersions(plan.map((p) => p.source.name), targetTrack.name)}</li>
        {#if plan.some((p) => p.versions.some((v) => v.duplicateOf !== null))}
          <li>{t().tidy.previewDuplicates(plan.reduce((n, p) => n + p.versions.filter((v) => v.duplicateOf !== null).length, 0))}</li>
        {/if}
        {#if plan.some((p) => p.preview.stems.added + p.preview.stems.revised > 0)}
          <li>{t().tidy.previewStems(plan.reduce((n, p) => n + p.preview.stems.added, 0), plan.reduce((n, p) => n + p.preview.stems.revised, 0))}</li>
        {/if}
        {#if plan.some((p) => p.preview.files > 0)}
          <li>{t().tidy.previewFiles(plan.reduce((n, p) => n + p.preview.files, 0))}</li>
        {/if}
        <li>{t().tidy.previewLinks}</li>
        <li>{t().tidy.previewTrash(plan.map((p) => p.source.name), targetTrack.name)}</li>
      </ul>
      <p class="note">{t().tidy.mergeNoUndo}</p>
      <p class="note">{t().tidy.syncHint}</p>
      {#if mergeList.length > 2}<p class="note">{t().tidy.bulkPreview}</p>{/if}
    </div>
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (mergeOpen = false)}>{t().common.cancel}</Button>
    <Button loading={merging} disabled={!targetTrack || !plan.length || !!mergeProblem} onclick={doMerge}>{t().tidy.mergeConfirm}</Button>
  {/snippet}
</Modal>

<Modal bind:open={versionOpen} title={versionItem ? t().tidy.moveVersionTitle(versionItem.versionNumber) : ''}>
  <p class="lead">{t().tidy.moveVersionLead}</p>
  <Input bind:value={versionQuery} placeholder={t().tidy.search} />
  <div class="options scroll" role="radiogroup" aria-label={t().tidy.moveVersionTitle(versionItem?.versionNumber ?? 0)}>
    {#each versionCandidates as c (c.id)}
      <button type="button" role="radio" aria-checked={versionTarget === c.id} class="option" class:on={versionTarget === c.id} onclick={() => pickVersionTarget(c.id)}>
        <span class="radio"></span>
        <span class="text"><b>{c.name}</b><small>{projectName(c.projectId)} · {t().workspace.music.versions(ix?.versionsOf.get(c.id)?.length ?? 0)}</small></span>
      </button>
    {:else}
      <p class="empty">{t().tidy.noMatch}</p>
    {/each}
  </div>
  {#if versionProblem}<p class="warn error">{versionProblem}</p>{/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (versionOpen = false)}>{t().common.cancel}</Button>
    <Button loading={versionMoving} disabled={!versionTarget || versionChecking || !!versionProblem} onclick={doMoveVersion}>{t().tidy.moveConfirm}</Button>
  {/snippet}
</Modal>

<style>
  .lead {
    margin: 0 0 var(--space-3);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .options {
    display: grid;
    gap: 6px;
    margin-top: var(--space-2);
  }
  .options.scroll {
    max-height: 240px;
    overflow-y: auto;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .option:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .option.on {
    border-color: var(--color-accent);
    background: var(--color-accent-subtle);
  }
  .option.small {
    padding: 6px 10px;
    font-size: var(--text-sm);
  }
  .radio {
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: 50%;
    border: 1.5px solid var(--color-border-hover);
  }
  .option.on .radio {
    border: 5px solid var(--color-accent);
  }
  .plus {
    width: 16px;
    text-align: center;
    color: var(--color-text-tertiary);
  }
  .text {
    display: grid;
    min-width: 0;
  }
  .text b {
    color: var(--color-text-primary);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .text small {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
  .sections {
    display: grid;
    gap: 4px;
    margin-left: 26px;
  }
  .warn {
    margin: var(--space-3) 0 0;
    padding: 9px 11px;
    border: 1px solid color-mix(in srgb, var(--color-warning) 40%, transparent);
    background: color-mix(in srgb, var(--color-warning) 8%, transparent);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--text-sm);
  }
  .warn.error {
    border-color: color-mix(in srgb, var(--color-error) 45%, transparent);
    background: color-mix(in srgb, var(--color-error) 8%, transparent);
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--color-accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .empty {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  .preview {
    margin-top: var(--space-3);
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }
  .result {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 6px 0;
  }
  .chip {
    font-size: var(--text-xs);
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }
  .chip.new {
    background: var(--color-accent-subtle);
    color: var(--color-accent);
  }
  .chip.dup {
    background: none;
    border: 1px dashed var(--color-border-hover);
    color: var(--color-text-tertiary);
    text-decoration: line-through;
  }
  .preview ul {
    margin: 0;
    padding-left: 18px;
    color: var(--color-text-secondary);
    display: grid;
    gap: 4px;
  }
  .note {
    margin: var(--space-2) 0 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
</style>
