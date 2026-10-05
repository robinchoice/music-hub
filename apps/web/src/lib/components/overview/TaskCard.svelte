<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import MiniWave from './MiniWave.svelte';
  import { handOff } from '$lib/stores/listen.js';
  import { formatTime, formatWhen } from '$lib/utils/format.js';
  import { byPosition } from '$lib/utils/track.js';
  import {
    avatarOf, firstName, fullName, joinNames, markersFor, personName, trackHref, versionName,
    type OverviewIndex, type Task,
  } from '$lib/utils/overview.js';

  let { ix, task, ondone }: { ix: OverviewIndex; task: Task; ondone: (key: string) => void } = $props();

  const info = $derived(task.info);
  const href = $derived(trackHref(info.project.id, info.track.id, task.version.id));
  const markers = $derived(markersFor(ix, ix.commentsOf.get(task.version.id) ?? []));
  const open = $derived(task.kind === 'open' ? [...task.comments].sort(byPosition) : []);
  const openFrom = $derived(joinNames([...new Set(open.map((c) => personName(ix, c.userId, c.guestName)))]));
  const decider = $derived(task.version.decidedById ? firstName(fullName(ix, task.version.decidedById)) : null);
  // "Antworten" opens the track at the comment that was answered
  const replyAt = $derived(task.kind === 'reply' ? task.comment.timestampSeconds : null);
</script>

<article class="task">
  <div class="top">
    <CoverImage src={info.track.coverUrl ?? info.project.coverUrl} name={info.track.name} size="sm" rounded="md" />
    <div class="ttl">
      <div class="name">
        <b>{info.track.name}</b><span class="vchip">V{task.version.versionNumber}</span>
        {#if versionName(task.version)}<span class="lbl">{versionName(task.version)}</span>{/if}
      </div>
      <div class="proj">{info.project.name}</div>
    </div>
    <span class="when">{formatWhen(task.at)}</span>
  </div>

  <div class="body">
    {#if task.kind === 'listen'}
      <p class="text"><b>{personName(ix, task.version.createdById)}</b> hat eine neue Version hochgeladen. Dein Feedback fehlt noch.</p>
      <MiniWave version={task.version} {markers} count={120} />
    {:else if task.kind === 'open'}
      {#if task.rejected}
        <p class="text">
          {decider ? `${decider} hat deine Version abgelehnt` : 'Deine Version wurde abgelehnt'}{task.version.rejectionReason ? ':' : '.'}
        </p>
        {#if task.version.rejectionReason}<p class="reason">„{task.version.rejectionReason}“</p>{/if}
      {/if}
      {#if open.length}
        <p class="text">{open.length === 1 ? 'Ein offener Kommentar' : `${open.length} offene Kommentare`} zu deiner Version, von {openFrom}.</p>
      {/if}
      <MiniWave version={task.version} {markers} count={120} />
      {#if open.length}
        <ul class="cms">
          {#each open as c (c.id)}
            <li>
              <a {href} onclick={() => handOff(info.track.id, c.timestampSeconds)}>
                <Avatar name={fullName(ix, c.userId, c.guestName)} src={avatarOf(ix, c.userId)} size="xs" />
                {#if c.timestampSeconds !== null}<span class="tchip">{formatTime(c.timestampSeconds)}</span>{/if}
                <span class="cm-body"><b>{personName(ix, c.userId, c.guestName)}</b>{c.body}</span>
                <span class="when">{formatWhen(c.createdAt)}</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      <p class="text">
        <b>{personName(ix, task.reply.userId, task.reply.guestName)}</b> hat auf deinen Kommentar{#if task.comment.timestampSeconds !== null}
          {' '}bei <span class="tchip">{formatTime(task.comment.timestampSeconds)}</span>{/if} geantwortet.
      </p>
      <div class="thread">
        <p class="mine">{task.comment.body}</p>
        <p class="theirs">
          <Avatar name={fullName(ix, task.reply.userId, task.reply.guestName)} src={avatarOf(ix, task.reply.userId)} size="xs" />
          <span>{task.reply.body}</span>
        </p>
      </div>
    {/if}

    <div class="actions">
      {#if task.kind === 'listen'}
        <Button size="sm" {href} onclick={() => handOff(info.track.id)}><Icon name="comment" size={14} /> Feedback geben</Button>
      {:else if task.kind === 'open'}
        <Button size="sm" {href} onclick={() => handOff(info.track.id)}><Icon name="upload" size={14} /> Neue Version hochladen</Button>
      {:else}
        <Button size="sm" {href} onclick={() => handOff(info.track.id, replyAt)}><Icon name="reply" size={14} /> Antworten</Button>
      {/if}
      <Button size="sm" variant="ghost" onclick={() => ondone(task.key)}><Icon name="check" size={14} /> Erledigt</Button>
    </div>
  </div>
</article>

<style>
  .task {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
  }
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .ttl {
    flex: 1;
    min-width: 0;
  }
  .name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
    color: var(--color-text-primary);
    font-size: var(--text-base);
  }
  .name b {
    font-weight: 600;
  }
  .lbl {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .proj {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .when {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    align-self: flex-start;
    margin-top: 2px;
  }
  .body {
    padding-left: 44px;
    margin-top: var(--space-2);
  }
  .text {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .text b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .reason {
    margin: calc(-1 * var(--space-2)) 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .cms {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .cms a {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    margin: 0 -8px;
    border-radius: 8px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-decoration: none;
  }
  .cms a:hover {
    background: var(--color-bg-overlay);
  }
  .cm-body {
    flex: 1;
    min-width: 0;
  }
  .cm-body b {
    color: var(--color-text-primary);
    font-weight: 600;
    margin-right: 5px;
  }
  .thread {
    border-left: 2px solid var(--color-border);
    padding-left: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mine {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  .theirs {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    color: var(--color-text-primary);
    font-size: var(--text-sm);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  @media (max-width: 640px) {
    .body {
      padding-left: 0;
      margin-top: var(--space-3);
    }
  }
</style>
