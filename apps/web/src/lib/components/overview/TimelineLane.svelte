<script lang="ts">
  import { TRACK_STATUS_LABELS } from '@music-hub/shared';
  import Icon from '$lib/components/ui/Icon.svelte';
  import StageLabel from './StageLabel.svelte';
  import TurnLabel from './TurnLabel.svelte';
  import { formatDate } from '$lib/utils/format.js';
  import {
    decisionText, personName, trackHref, versionName,
    type OverviewComment, type OverviewIndex, type OverviewVersion, type TimelineRange, type TrackInfo,
  } from '$lib/utils/overview.js';

  let {
    ix,
    info,
    range,
    now,
    dockedId,
    onplay,
  }: {
    ix: OverviewIndex;
    info: TrackInfo;
    range: TimelineRange;
    now: number;
    /** Version in the player bar */
    dockedId: string | null;
    onplay: (version: OverviewVersion, from?: number) => void;
  } = $props();

  const STATUS_COLORS = { sketch: 'var(--color-text-secondary)', in_progress: 'var(--color-accent)', final: 'var(--color-success)', released: 'var(--color-text-primary)' };

  const at = (iso: string) => range.pct(Date.parse(iso));
  const inRange = (iso: string) => Date.parse(iso) >= range.start;

  // Every version is a clip on its upload day
  const clips = $derived(info.versions.filter((v) => inRange(v.createdAt)));
  const earlier = $derived(info.versions.some((v) => !inRange(v.createdAt)));
  // Comments and replies are dots on the day they were written
  const dots = $derived(
    info.versions.flatMap((v) => (ix.commentsOf.get(v.id) ?? []).filter((c) => inRange(c.createdAt)).map((c) => ({ c, v }))),
  );
  // A line runs between the clips; with versions before the range it starts at the left edge
  const line = $derived(
    clips.length ? { from: earlier ? 0 : at(clips[0].createdAt), to: at(clips[clips.length - 1].createdAt) } : null,
  );
  // On running tracks it fades out towards today
  const live = $derived.by(() => {
    if (info.done) return null;
    const from = clips.length ? at(clips[clips.length - 1].createdAt) : earlier ? 0 : null;
    return from === null ? null : { from, to: range.pct(now) };
  });
  // Tracks without a version get a diamond on the day they were created
  const created = $derived(!info.versions.length && inRange(info.track.createdAt) ? at(info.track.createdAt) : null);

  function clipClass(v: OverviewVersion) {
    if (v.status === 'approved') return 'approved';
    if (v.status === 'rejected') return 'rejected';
    return v.id === info.latest?.id ? 'latest' : 'ready';
  }

  function clipTip(v: OverviewVersion) {
    const count = (ix.commentsOf.get(v.id) ?? []).filter((c) => !c.parentId).length;
    return [
      `${info.track.name} V${v.versionNumber}${versionName(v) ? ` · ${versionName(v)}` : ''}`,
      `${personName(ix, v.createdById)}, ${formatDate(v.createdAt)}`,
      decisionText(ix, v),
      count ? `${count} ${count === 1 ? 'Kommentar' : 'Kommentare'}` : '',
      'Klick spielt ab',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const dotTip = (c: OverviewComment) => `${personName(ix, c.userId, c.guestName)}, ${formatDate(c.createdAt)}\n„${c.body}“`;
</script>

<div class="trow" class:done={info.done}>
  <a class="name" href={trackHref(info.project.id, info.track.id)}>
    <span class="dot" style="background: {STATUS_COLORS[info.track.status]}" title={TRACK_STATUS_LABELS[info.track.status]}></span>
    <span class="nm">{info.track.name}</span>
    {#if info.isNew}<span class="newdot" title="Neu seit deinem letzten Besuch"></span>{/if}
  </a>
  <div class="lane">
    {#each range.ticks as t (t)}<i class="gl" style="left: {range.pct(t)}%"></i>{/each}
    <i class="today" style="left: {range.pct(now)}%"></i>
    {#if line}<i class="line" style="left: {line.from}%; width: {line.to - line.from}%"></i>{/if}
    {#if live}<i class="line live" style="left: {live.from}%; width: {live.to - live.from}%"></i>{/if}
    {#each dots as { c, v } (c.id)}
      <button
        type="button"
        class="cm"
        style="left: {at(c.createdAt)}%"
        data-tt={dotTip(c)}
        aria-label={dotTip(c).split('\n').join(': ')}
        onclick={() => onplay(v, c.timestampSeconds ?? 0)}
      ></button>
    {/each}
    {#each clips as v (v.id)}
      <button
        type="button"
        class="clip {clipClass(v)}"
        class:playing={dockedId === v.id}
        style="left: {at(v.createdAt)}%"
        data-tt={clipTip(v)}
        aria-label="{info.track.name} V{v.versionNumber} abspielen"
        onclick={() => onplay(v)}
      >
        V{v.versionNumber}
        {#if v.status === 'approved'}<Icon name="check" size={10} stroke={3.2} />{:else if v.status === 'rejected'}<Icon name="x" size={10} stroke={3.2} />{/if}
      </button>
    {/each}
    {#if created !== null}
      <a
        class="new"
        href={trackHref(info.project.id, info.track.id)}
        style="left: {created}%"
        data-tt={`${info.track.name}\nangelegt ${formatDate(info.track.createdAt)}, noch keine Version`}
        aria-label="{info.track.name}: angelegt {formatDate(info.track.createdAt)}, noch keine Version"
      ><i></i></a>
    {/if}
  </div>
  <div class="stage">
    <StageLabel stage={info.stage} small />
    <TurnLabel {ix} {info} />
  </div>
</div>

<style>
  .trow {
    display: grid;
    grid-template-columns: var(--tl-cols);
    align-items: stretch;
    min-height: 40px;
  }
  .trow:hover {
    background: rgba(255, 255, 255, 0.02);
  }
  /* The track names stay in place when the lanes scroll sideways */
  .name {
    position: sticky;
    left: 0;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 0 12px 0 var(--space-5);
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    font-size: var(--text-sm);
    font-weight: 500;
    text-decoration: none;
  }
  .done .name {
    color: var(--color-text-secondary);
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .newdot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 20%, transparent);
    flex-shrink: 0;
  }
  .lane {
    position: relative;
    min-height: 40px;
  }
  .gl {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--color-border);
  }
  .today {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: color-mix(in srgb, var(--color-accent) 50%, transparent);
  }
  .line {
    position: absolute;
    top: 50%;
    height: 2px;
    margin-top: -1px;
    border-radius: 1px;
    background: var(--color-border-hover);
  }
  .line.live {
    background: linear-gradient(90deg, var(--color-border-hover), transparent);
  }
  .clip {
    position: absolute;
    top: 50%;
    z-index: 2;
    transform: translate(-50%, -50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 22px;
    min-width: 30px;
    padding: 0 6px;
    border-radius: 6px;
    font: inherit;
    font-size: 11px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    box-shadow: 0 0 0 2px var(--color-bg-raised);
    cursor: pointer;
    transition: transform 0.12s;
  }
  .clip:hover,
  .clip:focus-visible {
    transform: translate(-50%, -50%) scale(1.12);
    z-index: 3;
  }
  .clip.ready {
    background: color-mix(in srgb, var(--color-accent) 14%, var(--color-bg-raised));
    color: var(--color-text-primary);
    border: 1px solid color-mix(in srgb, var(--color-accent) 55%, transparent);
  }
  .clip.latest {
    background: var(--color-accent);
    color: var(--color-on-accent);
    border: 1px solid transparent;
  }
  .clip.approved {
    background: color-mix(in srgb, var(--color-success) 14%, var(--color-bg-raised));
    color: var(--color-text-primary);
    border: 1px solid color-mix(in srgb, var(--color-success) 50%, transparent);
  }
  .clip.approved :global(svg) {
    color: var(--color-success);
  }
  .clip.rejected {
    background: color-mix(in srgb, var(--color-error) 14%, var(--color-bg-raised));
    color: var(--color-text-primary);
    border: 1px solid color-mix(in srgb, var(--color-error) 55%, transparent);
  }
  .clip.rejected :global(svg) {
    color: var(--color-error);
  }
  .clip.playing {
    box-shadow: 0 0 0 2px var(--color-bg-raised), 0 0 0 4px color-mix(in srgb, var(--color-accent) 60%, transparent);
  }
  .cm {
    position: absolute;
    top: 6px;
    z-index: 1;
    width: 7px;
    height: 7px;
    margin-left: -3.5px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--color-series-2);
    box-shadow: 0 0 0 2px var(--color-bg-raised);
    cursor: pointer;
  }
  .cm::after {
    content: '';
    position: absolute;
    inset: -7px;
  }
  .new {
    position: absolute;
    top: 50%;
    z-index: 2;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    display: grid;
    place-items: center;
  }
  .new i {
    width: 10px;
    height: 10px;
    transform: rotate(45deg);
    border: 2px solid var(--color-text-tertiary);
    border-radius: 2px;
    background: var(--color-bg-raised);
  }
  .stage {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
    padding: 4px var(--space-5) 4px 14px;
    overflow: hidden;
  }
  @media (max-width: 640px) {
    .name {
      padding-left: var(--space-4);
      font-size: 13px;
    }
    .stage {
      display: none;
    }
  }
</style>
