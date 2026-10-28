<script lang="ts">
  import { getContext } from 'svelte';
  import { get } from 'svelte/store';
  import { locale, t } from '$lib/i18n/index.js';
  import { TRACK_STATUSES, TRACK_STATUS_LABELS, type TrackStatus } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { overview } from '$lib/stores/overview.js';
  import { toast } from '$lib/stores/toast.js';
  import { handOff } from '$lib/stores/listen.js';
  import Icon from '$lib/components/ui/Icon.svelte';
  import StageLabel from './StageLabel.svelte';
  import TurnLabel from './TurnLabel.svelte';
  import { capabilities } from '$lib/utils/track.js';
  import { STATUS_COLORS, trackHref, type OverviewIndex, type TrackInfo } from '$lib/utils/overview.js';

  // One column per production stage; the cards keep the order of infos
  let { ix, infos, showProject = false }: { ix: OverviewIndex; infos: TrackInfo[]; showProject?: boolean } = $props();

  const reloadSidebar = getContext<(() => void) | undefined>('reloadSidebar');

  // in_progress predates the stages: a column only while a track has it, and nothing moves there
  const columns = $derived(TRACK_STATUSES.filter((s) => s !== 'in_progress' || infos.some((i) => i.track.status === s)));
  const targets = TRACK_STATUSES.filter((s) => s !== 'in_progress');
  const label = (s: TrackStatus) => TRACK_STATUS_LABELS[locale()][s];
  const nextOf = (s: TrackStatus): TrackStatus | undefined => (s === 'in_progress' ? 'recording' : targets[targets.indexOf(s) + 1]);
  const mayMove = (info: TrackInfo) => capabilities(info.project.myRoles).canUpload;

  let dragging = $state<TrackInfo | null>(null);
  let over = $state<TrackStatus | null>(null);

  function setLocal(trackId: string, status: TrackStatus) {
    overview.update((o) => o && { ...o, tracks: o.tracks.map((tr) => (tr.id === trackId ? { ...tr, status } : tr)) });
  }

  // Shows the change at once and takes it back if the API refuses
  async function move(trackId: string, from: TrackStatus, to: TrackStatus): Promise<boolean> {
    if (from === to) return false;
    setLocal(trackId, to);
    try {
      await api.patch(`/tracks/${trackId}`, { status: to });
    } catch {
      // The API client already showed the error
      setLocal(trackId, from);
      return false;
    }
    reloadSidebar?.();
    return true;
  }

  async function moveInfo(info: TrackInfo, to: TrackStatus) {
    const { id, name, status: from } = info.track;
    if (!(await move(id, from, to))) return;
    toast(t().overview.board.moved(name, label(to)), 'success', 6000, {
      label: t().common.undo,
      // Only while the track still stands where this move put it
      run: () => {
        if (get(overview)?.tracks.find((tr) => tr.id === id)?.status === to) void move(id, to, from);
      },
    });
  }

  function endDrag() {
    dragging = null;
    over = null;
  }

  function drop(e: DragEvent, to: TrackStatus) {
    e.preventDefault();
    const info = dragging;
    endDrag();
    if (info) void moveInfo(info, to);
  }

  const accepts = (s: TrackStatus) => !!dragging && s !== 'in_progress' && s !== dragging.track.status;
</script>

<!-- A card that leaves the page while dragged (reload, filter) never gets its dragend -->
<svelte:window ondragend={endDrag} ondrop={endDrag} />

<div class="board">
  {#each columns as s (s)}
    {@const list = infos.filter((i) => i.track.status === s)}
    <section
      class="col"
      class:legacy={s === 'in_progress'}
      class:compact={s === 'released'}
      class:over={over === s}
      class:next={!!dragging && nextOf(dragging.track.status) === s}
      aria-label={label(s)}
      data-stage={s}
      ondragover={(e) => {
        if (!accepts(s)) return;
        e.preventDefault();
        over = s;
      }}
      ondragleave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) over = null;
      }}
      ondrop={(e) => accepts(s) && drop(e, s)}
    >
      <h2 class="head">
        <span class="dot" style="background: {STATUS_COLORS[s]}"></span>{label(s)}<span class="n">{list.length}</span>
        {#if s === 'in_progress'}<span class="hint">{t().overview.board.legacy}</span>{/if}
      </h2>
      <div class="cards">
        {#each list as info (info.track.id)}
          {@const movable = mayMove(info)}
          {@const next = nextOf(info.track.status)}
          <article
            class="card"
            class:dragging={dragging?.track.id === info.track.id}
            draggable={movable}
            ondragstart={(e) => {
              dragging = info;
              if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', info.track.name);
              }
            }}
            ondragend={endDrag}
          >
            <div class="top">
              <div class="names">
                <a class="name" href={trackHref(info.project.id, info.track.id)} draggable="false" onclick={() => handOff(info.track.id)}>{info.track.name}</a>
                {#if showProject}<span class="project">{info.project.name}</span>{/if}
              </div>
              {#if movable}
                <label class="pick" title={t().overview.board.moveTo(info.track.name)}>
                  <Icon name="more" size={16} />
                  <select
                    aria-label={t().overview.board.moveTo(info.track.name)}
                    value={info.track.status}
                    onchange={(e) => void moveInfo(info, e.currentTarget.value as TrackStatus)}
                  >
                    {#if info.track.status === 'in_progress'}<option value="in_progress" disabled>{label('in_progress')}</option>{/if}
                    {#each targets as o (o)}<option value={o}>{label(o)}</option>{/each}
                  </select>
                </label>
              {:else}
                <!-- Phones have no hover, a tap tells the reason -->
                <button type="button" class="lock" title={t().overview.board.locked} aria-label={t().overview.board.locked} onclick={() => toast(t().overview.board.locked)}>
                  <Icon name="lock" size={13} />
                </button>
              {/if}
            </div>
            {#if s !== 'released'}
              <div class="meta">
                {#if info.latest}<span class="vchip">V{info.latest.versionNumber}</span>{/if}
                <StageLabel stage={info.stage} small />
              </div>
              <TurnLabel {ix} {info} />
              {#if movable && next}
                <button type="button" class="next-btn" onclick={() => void moveInfo(info, next)}>
                  {t().overview.board.next(label(next))} <Icon name="chevron-right" size={13} />
                </button>
              {/if}
            {/if}
          </article>
        {:else}
          <p class="empty">{dragging ? t().overview.board.dropHere : t().overview.board.empty}</p>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .board {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(150px, 1fr);
    gap: var(--space-2);
    overflow-x: auto;
    padding-bottom: var(--space-2);
  }
  .col {
    display: flex;
    flex-direction: column;
    min-height: 320px;
    padding: var(--space-2);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }
  .legacy {
    background: repeating-linear-gradient(135deg, var(--color-bg-raised) 0 8px, var(--color-bg-base) 8px 16px);
  }
  .next {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
  }
  .over {
    border-style: solid;
    border-color: var(--color-accent);
    background: var(--color-accent-subtle);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
    margin: 0;
    padding: var(--space-1) var(--space-1) var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .n {
    color: var(--color-text-tertiary);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .hint {
    flex-basis: 100%;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-text-tertiary);
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 9px 10px;
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
  }
  .card[draggable='true'] {
    cursor: grab;
  }
  .card.dragging {
    opacity: 0.4;
  }
  .top {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .names {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: break-word;
    font-weight: 600;
    color: var(--color-text-primary);
    text-decoration: none;
  }
  .name:hover {
    text-decoration: underline;
  }
  .project {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pick {
    position: relative;
    display: inline-flex;
    padding: 4px;
    margin: -4px -4px 0 0;
    border-radius: var(--radius-sm);
    color: var(--color-text-tertiary);
    cursor: pointer;
  }
  .pick:hover,
  .pick:focus-within {
    color: var(--color-text-primary);
    background: var(--color-bg-subtle);
  }
  .pick:has(select:focus-visible),
  .lock:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  /* The native picker opens the menu: a list on the desktop, the system sheet on phones */
  .pick select {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    font-size: 16px;
  }
  .lock {
    display: inline-flex;
    padding: 4px;
    margin: -4px -4px 0 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-tertiary);
    cursor: help;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  /* Narrow columns: the stage text wraps instead of leaving the card */
  .meta :global(.stage) {
    white-space: normal;
  }
  .vchip {
    font-size: 10.5px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
  }
  .next-btn {
    display: none;
    align-items: center;
    justify-content: center;
    gap: 4px;
    margin-top: 2px;
    padding: 7px;
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, transparent);
    border-radius: var(--radius-sm);
    background: var(--color-accent-subtle);
    color: var(--color-accent);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .compact .card {
    padding: 7px 10px;
  }
  .empty {
    margin: 0;
    padding: var(--space-4) var(--space-2);
    border: 1px dashed var(--color-border-hover);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    text-align: center;
  }

  /* Without a mouse there is no dragging: one step on via the button, any stage via the picker */
  @media (hover: none), (max-width: 720px) {
    .next-btn {
      display: inline-flex;
    }
    /* A finger needs room: the picker and the lock grow to 40 px */
    .pick,
    .lock {
      padding: 12px;
      margin: -10px -10px -6px 0;
    }
  }
  /* Phones: the stages one below the other instead of side by side, empty ones only as a heading */
  @media (max-width: 720px) {
    .board {
      grid-auto-flow: row;
      grid-auto-columns: auto;
      overflow-x: visible;
    }
    .col {
      min-height: 0;
    }
    .head {
      padding-bottom: var(--space-1);
    }
    .cards:has(.card) {
      padding-top: var(--space-2);
    }
    .empty {
      display: none;
    }
  }
</style>
