<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import TaskCard from '$lib/components/overview/TaskCard.svelte';
  import { overviewIndex, overviewFailed, tasks, loadOverview, dismissTask, restoreTask } from '$lib/stores/overview.js';
  import { formatTime, formatWhen } from '$lib/utils/format.js';
  import { avatarOf, eventsOf, fullName, personName, type OverviewEvent } from '$lib/utils/overview.js';

  onMount(() => {
    void loadOverview(true);
  });

  const ix = $derived($overviewIndex);
  // The four newest things the others did
  const recent = $derived(ix ? eventsOf(ix).filter((e) => e.actorId !== ix.me).slice(0, 4) : []);

  let undoKey = $state<string | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  function done(key: string) {
    clearTimeout(undoTimer);
    undoKey = key;
    undoTimer = setTimeout(() => (undoKey = null), 6000);
    void dismissTask(key);
  }

  function undo() {
    clearTimeout(undoTimer);
    if (undoKey) void restoreTask(undoKey);
    undoKey = null;
  }

  // Whom a reply went to, seen from you
  function replyTo(e: OverviewEvent) {
    if (!ix || !e.parent) return 'jemandem';
    return e.parent.userId === ix.me ? 'dir' : personName(ix, e.parent.userId, e.parent.guestName);
  }
</script>

<TopBar crumbs={[{ label: 'Für dich' }]} />

<div class="page">
  <h1>Für dich {#if $tasks.length}<span class="count">{$tasks.length}</span>{/if}</h1>
  <p class="sub">Was gerade auf dich wartet, das Neueste zuerst.</p>

  {#if !ix && $overviewFailed}
    <LoadFailed />
  {:else if !ix}
    <div class="loading">
      <Skeleton height="9rem" variant="rect" />
      <Skeleton height="9rem" variant="rect" />
    </div>
  {:else if $tasks.length}
    <div class="list">
      {#each $tasks as task (task.key)}
        <div out:fly={{ x: 18, duration: 220 }}>
          <TaskCard {ix} {task} ondone={done} />
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty">
      <div class="ok"><Icon name="check" size={22} stroke={2.4} /></div>
      <h2>Alles erledigt</h2>
      <p>Nichts wartet auf dich. Sobald jemand eine Version hochlädt oder dir antwortet, steht es hier.</p>
    </div>
  {/if}

  {#if ix && recent.length}
    <section class="recent">
      <h2>Zuletzt</h2>
      {#each recent as e (`${e.kind}:${e.comment?.id ?? e.version?.id ?? e.track.id}`)}
        <div class="line">
          <Avatar name={fullName(ix, e.actorId, e.guestName)} src={avatarOf(ix, e.actorId)} size="xs" />
          <p>
            <b>{personName(ix, e.actorId, e.guestName)}</b>
            {#if e.kind === 'version'}
              hat <span class="t">{e.track.name}</span> <span class="vchip">V{e.version?.versionNumber}</span> hochgeladen
            {:else if e.kind === 'comment'}
              hat <span class="t">{e.track.name}</span>{#if e.comment && e.comment.timestampSeconds !== null}
                {' '}bei <span class="tchip">{formatTime(e.comment.timestampSeconds)}</span>{/if} kommentiert
            {:else if e.kind === 'reply'}
              hat {replyTo(e)} bei <span class="t">{e.track.name}</span> geantwortet
            {:else if e.kind === 'approved'}
              hat <span class="t">{e.track.name}</span> <span class="vchip">V{e.version?.versionNumber}</span> freigegeben
            {:else if e.kind === 'rejected'}
              hat <span class="t">{e.track.name}</span> <span class="vchip">V{e.version?.versionNumber}</span> abgelehnt
            {:else}
              hat <span class="t">{e.track.name}</span> angelegt
            {/if}
          </p>
          <span class="when">{formatWhen(e.at)}</span>
        </div>
      {/each}
      <a class="more" href="/timeline">Ganzer Verlauf</a>
    </section>
  {/if}
</div>

{#if undoKey}
  <div class="undo" role="status">
    Als erledigt markiert.
    <button type="button" onclick={undo}>Rückgängig</button>
  </div>
{/if}

<style>
  .page {
    padding: var(--space-6);
    max-width: 768px;
  }
  h1 {
    margin: 0;
    font-size: var(--text-xl);
    line-height: 1.25;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .count {
    min-width: 24px;
    height: 24px;
    padding: 0 7px;
    border-radius: 12px;
    background: var(--color-accent-subtle);
    color: var(--color-accent);
    font-size: 13px;
    font-weight: 700;
    display: inline-grid;
    place-items: center;
    font-variant-numeric: tabular-nums;
  }
  .sub {
    margin: 4px 0 var(--space-5);
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  .list,
  .loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .empty {
    text-align: center;
    padding: var(--space-10) var(--space-4);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-lg);
  }
  .ok {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    margin: 0 auto var(--space-3);
    display: grid;
    place-items: center;
    background: rgba(34, 197, 94, 0.12);
    color: var(--color-success);
  }
  .empty h2 {
    margin: 0 0 4px;
    font-size: var(--text-lg);
  }
  .empty p {
    margin: 0 auto;
    max-width: 380px;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
  .recent {
    margin-top: var(--space-10);
  }
  .recent h2 {
    font-size: var(--text-base);
    margin: 0 0 var(--space-2);
  }
  .line {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 0;
    border-top: 1px solid var(--color-border);
    font-size: var(--text-sm);
  }
  .line p {
    margin: 0;
    flex: 1;
    min-width: 0;
    color: var(--color-text-secondary);
  }
  .line b,
  .t {
    color: var(--color-text-primary);
  }
  .line b {
    font-weight: 600;
  }
  .when {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    margin-top: 2px;
  }
  .more {
    display: inline-block;
    margin-top: 4px;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    text-decoration: none;
  }
  .more:hover {
    color: var(--color-text-primary);
  }
  .undo {
    position: fixed;
    left: 50%;
    bottom: calc(24px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    z-index: 120;
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: calc(100vw - 32px);
    padding: 9px 14px;
    border-radius: 10px;
    background: var(--color-text-primary);
    color: var(--color-bg-base);
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  }
  .undo button {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-weight: 700;
    color: var(--color-accent-hover);
    cursor: pointer;
  }
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
    .undo {
      bottom: calc(72px + env(safe-area-inset-bottom, 0px));
    }
  }
</style>
