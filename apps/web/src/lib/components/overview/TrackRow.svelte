<script lang="ts">
  import { TRACK_STATUS_LABELS } from '@music-hub/shared';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import MiniWave from './MiniWave.svelte';
  import StageLabel from './StageLabel.svelte';
  import TurnLabel from './TurnLabel.svelte';
  import { handOff, listen } from '$lib/stores/listen.js';
  import { formatTime, formatWhen } from '$lib/utils/format.js';
  import { byPosition } from '$lib/utils/track.js';
  import {
    UPLOAD_ROLES, avatarOf, firstName, fullName, lastText, markersFor, personName, trackHref, versionName,
    type OverviewIndex, type TrackInfo,
  } from '$lib/utils/overview.js';

  let { ix, info, expanded = false, ontoggle }: { ix: OverviewIndex; info: TrackInfo; expanded?: boolean; ontoggle: () => void } = $props();

  const STATUS_COLORS = { sketch: '#9b96a8', in_progress: '#fb923c', final: '#22c55e', released: '#f43f5e' };

  const v = $derived(info.latest);
  const comments = $derived(v ? (ix.commentsOf.get(v.id) ?? []) : []);
  const expandable = $derived(info.stage.key === 'open' || info.stage.key === 'rejected');
  // Opens the version that plays inline, otherwise the newest
  const playing = $derived($listen.trackId === info.track.id ? $listen.versionId : null);
  const href = $derived(trackHref(info.project.id, info.track.id, playing ?? v?.id));
  const canUpload = $derived(UPLOAD_ROLES.includes(info.project.myRole));
  const last = $derived(info.last);
</script>

<div class="row" class:open={expanded}>
  <div class="song">
    <span class="dot" style="background: {STATUS_COLORS[info.track.status]}" title={TRACK_STATUS_LABELS[info.track.status]}></span>
    <div class="st">
      <div class="name">
        <a {href} onclick={() => handOff(info.track.id)}>{info.track.name}</a>
        {#if info.isNew}<span class="newdot" title="Neu seit deinem letzten Besuch"></span>{/if}
      </div>
      <div class="ver">
        {#if v}
          <span class="vchip">V{v.versionNumber}</span>
          {#if versionName(v)}<span>{versionName(v)}</span>{/if}
        {:else}
          <span class="dim">noch leer</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="wave">
    {#if v}
      <MiniWave version={v} markers={markersFor(ix, comments)} />
    {:else if canUpload}
      <Button size="sm" variant="secondary" {href}><Icon name="upload" size={14} /> Erste Version hochladen</Button>
    {/if}
  </div>

  <div class="stage">
    {#if expandable}
      <button type="button" class="toggle" aria-expanded={expanded} onclick={ontoggle}>
        <StageLabel stage={info.stage} />
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} />
      </button>
    {:else}
      <StageLabel stage={info.stage} />
    {/if}
    <TurnLabel {ix} {info} />
  </div>

  <div class="last">
    <Avatar name={fullName(ix, last.actorId, last.guestName)} src={avatarOf(ix, last.actorId)} size="xs" />
    <div>
      <div class="l1"><b>{personName(ix, last.actorId, last.guestName)}</b> {lastText(last, ix.me)}</div>
      <div class="l2">{formatWhen(last.at)}</div>
    </div>
  </div>
</div>

{#if expanded && v}
  <div class="exp">
    {#if info.stage.key === 'rejected'}
      <p class="reason">
        {#if v.decidedById}
          <Avatar name={fullName(ix, v.decidedById)} src={avatarOf(ix, v.decidedById)} size="xs" />
          <span><b>{firstName(fullName(ix, v.decidedById))}</b> hat <span class="vchip">V{v.versionNumber}</span> abgelehnt{v.rejectionReason ? `: „${v.rejectionReason}“` : '.'}</span>
        {:else}
          <span><span class="vchip">V{v.versionNumber}</span> wurde abgelehnt{v.rejectionReason ? `: „${v.rejectionReason}“` : '.'}</span>
        {/if}
      </p>
    {:else}
      <ul class="cms">
        {#each [...info.open].sort(byPosition) as c (c.id)}
          <li>
            <a {href} onclick={() => handOff(info.track.id, c.timestampSeconds)}>
              <Avatar name={fullName(ix, c.userId, c.guestName)} src={avatarOf(ix, c.userId)} size="xs" />
              {#if c.timestampSeconds !== null}<span class="tchip">{formatTime(c.timestampSeconds)}</span>{/if}
              <span class="cm-body"><b>{personName(ix, c.userId, c.guestName)}</b>{c.body}</span>
              <span class="when">{formatWhen(c.createdAt)}</span>
            </a>
          </li>
          {#each comments.filter((r) => r.parentId === c.id) as r (r.id)}
            <li class="reply">
              <a {href} onclick={() => handOff(info.track.id, c.timestampSeconds)}>
                <Icon name="reply" size={14} />
                <Avatar name={fullName(ix, r.userId, r.guestName)} src={avatarOf(ix, r.userId)} size="xs" />
                <span class="cm-body"><b>{personName(ix, r.userId, r.guestName)}</b>{r.body}</span>
                <span class="when">{formatWhen(r.createdAt)}</span>
              </a>
            </li>
          {/each}
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .row {
    position: relative;
    display: grid;
    grid-template-columns: var(--track-cols);
    gap: var(--space-4);
    align-items: center;
    padding: var(--space-3);
    border-radius: var(--radius-md);
  }
  .row:hover,
  .row.open {
    background: var(--color-bg-raised);
  }
  .row.open {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .song {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 8px;
    flex-shrink: 0;
  }
  .st {
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    min-width: 0;
    color: var(--color-text-primary);
    font-weight: 600;
    font-size: var(--text-base);
    white-space: nowrap;
  }
  .name a {
    color: inherit;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    outline: none;
  }
  /* The whole row opens the track; waveform and buttons sit above this link */
  .name a::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .name a:focus-visible::after {
    box-shadow: 0 0 0 2px rgba(244, 63, 94, 0.5);
  }
  .newdot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-accent);
    box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.2);
    margin-left: 8px;
    flex-shrink: 0;
  }
  .ver {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .dim {
    color: var(--color-text-tertiary);
  }
  .wave,
  .toggle {
    position: relative;
    z-index: 1;
  }
  .wave {
    min-width: 0;
  }
  .stage {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    margin: -2px -6px;
    border: none;
    border-radius: 6px;
    background: none;
    font: inherit;
    color: var(--color-text-tertiary);
    cursor: pointer;
  }
  .toggle:hover {
    background: var(--color-bg-overlay);
  }
  .last {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
    font-size: var(--text-xs);
    line-height: 1.45;
    color: var(--color-text-secondary);
  }
  .last b {
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .l2 {
    color: var(--color-text-tertiary);
  }
  .exp {
    background: var(--color-bg-raised);
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    padding: 0 var(--space-3) var(--space-3) calc(var(--space-3) + 18px);
    margin-bottom: 2px;
  }
  .reason {
    margin: 0;
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border);
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: var(--text-sm);
  }
  .reason b {
    color: var(--color-text-primary);
  }
  .cms {
    list-style: none;
    margin: 0;
    padding: var(--space-2) 0 0;
    border-top: 1px solid var(--color-border);
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
  .reply a {
    padding-left: 30px;
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
  .when {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
  /* Phone: name and time, below the waveform, below stage and turn */
  @media (max-width: 640px) {
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'song last' 'wave wave' 'stage stage';
      gap: 8px 12px;
      padding: var(--space-3) var(--space-1);
    }
    .song {
      grid-area: song;
    }
    .last {
      grid-area: last;
      align-self: start;
      padding-top: 2px;
    }
    .last :global(.avatar),
    .l1 {
      display: none;
    }
    .wave {
      grid-area: wave;
    }
    .wave:empty {
      display: none;
    }
    .stage {
      grid-area: stage;
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
    }
    .exp {
      padding: 0 var(--space-1) var(--space-3);
    }
  }
</style>
