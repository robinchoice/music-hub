<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import { formatDay, formatDb, formatLufs } from '$lib/utils/format.js';
  import type { TrackComment } from '$lib/utils/track.js';
  import {
    avatarOf, decisionText, firstName, ledCount, versionLamp, versionName,
    type OverviewIndex, type OverviewVersion,
  } from '$lib/utils/overview.js';

  let {
    ix,
    version,
    index,
    solo,
    latest,
    gain,
    reference,
    match,
    levels,
    comments,
    broken = false,
    onsolo,
  }: {
    ix: OverviewIndex;
    version: OverviewVersion;
    /** Position from the left; keys 1 to 9 */
    index: number;
    solo: boolean;
    latest: boolean;
    /** Loudness match in dB */
    gain: number;
    /** Loudness all versions are matched to */
    reference: number | null;
    match: boolean;
    /** Peak left and right, 0 to 1 */
    levels: [number, number];
    /** Top-level comments of this version */
    comments: TrackComment[];
    /** The version cannot be played */
    broken?: boolean;
    onsolo: () => void;
  } = $props();

  // 16 LED segments from −36 to 0 dBFS: 11 green, 3 yellow, 2 red
  const SEGMENTS = Array.from({ length: 16 }, (_, k) => (k < 11 ? 'g' : k < 14 ? 'y' : 'r'));
  const TICKS = [100, 66.67, 33.33, 0];

  const lamp = $derived(versionLamp(version, latest, comments));
  const uploader = $derived(ix.users.get(version.createdById)?.name ?? 'Jemand');
  const lit = $derived(levels.map((level) => ledCount(level)));
  // Fader scale from −12 to +6 dB
  const cap = $derived(Math.max(0, Math.min(100, ((gain + 12) / 18) * 100)));
  // Variants show their variant name
  const name = $derived(version.branchLabel ?? versionName(version));
  const meterTip = $derived(
    `Pegel live, links und rechts${version.integratedLufs !== null ? `\nGemessene Lautheit: ${formatLufs(version.integratedLufs)} LUFS` : ''}`,
  );
  const faderTip = $derived(match && reference !== null ? `Angeglichen auf ${formatLufs(reference)} LUFS: ${formatDb(gain)}` : 'Kein Ausgleich');
</script>

<div class="strip" class:solo>
  <div class="lcd">
    <b>V{version.versionNumber}</b>
    {#if name}<small>{name}</small>{/if}
  </div>
  <div class="who">
    <Avatar name={uploader} src={avatarOf(ix, version.createdById)} size="xs" />
    <span>{firstName(uploader)}, {formatDay(version.createdAt)}</span>
  </div>
  {#if broken}
    <div class="lamp s-rejected" data-tt="Diese Version lässt sich gerade nicht abspielen."><span class="bulb"></span>nicht abspielbar</div>
  {:else}
    <div class="lamp s-{lamp.key}" data-tt={decisionText(ix, version) || lamp.text}><span class="bulb"></span>{lamp.text}</div>
  {/if}
  <div class="meters" data-tt={meterTip}>
    {#each lit as n, side (side)}
      <div class="led">
        {#each SEGMENTS as color, k (k)}<i class={color} class:on={k < n}></i>{/each}
      </div>
    {/each}
  </div>
  <div class="lufs">{version.integratedLufs !== null ? `${formatLufs(version.integratedLufs)} LUFS` : 'nicht gemessen'}</div>
  <div class="fader" data-tt={faderTip}>
    <div class="ft">
      {#each TICKS as p (p)}<i class="tick" style="bottom: {p}%"></i>{/each}
      <i class="cap" style="bottom: {cap}%"></i>
    </div>
  </div>
  <div class="db">{formatDb(gain)}</div>
  <button type="button" class="solo-btn" aria-pressed={solo} disabled={broken} onclick={onsolo}>
    Solo{#if index < 9}<kbd>{index + 1}</kbd>{/if}
  </button>
  <div class="foot">{comments.length === 1 ? '1 Kommentar' : `${comments.length} Kommentare`}</div>
</div>

<style>
  .strip {
    width: 124px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 8px;
    background: #18161f;
    border: 1px solid #2a2733;
    border-radius: 10px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .strip.solo {
    border-color: rgba(244, 63, 94, 0.75);
    box-shadow: 0 0 0 1px rgba(244, 63, 94, 0.45), 0 12px 34px rgba(244, 63, 94, 0.14);
  }
  .lcd {
    height: 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border-radius: 6px;
    background: #0c0b11;
    border: 1px solid #2a2733;
  }
  .lcd b {
    font-size: 20px;
    line-height: 1;
    font-weight: 650;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .lcd small {
    max-width: 100%;
    padding: 0 4px;
    font-size: 11px;
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .who {
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 11px;
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
  }
  .lamp {
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 6px;
    background: #0c0b11;
    border: 1px solid #2a2733;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .bulb {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 7px currentColor;
  }
  .s-open {
    color: var(--color-warning);
  }
  .s-rejected {
    color: var(--color-error);
  }
  .s-approved {
    color: var(--color-success);
  }
  .s-feedback {
    color: var(--color-text-primary);
  }
  .s-feedback .bulb {
    background: #f4f0ec;
    box-shadow: 0 0 6px rgba(244, 240, 236, 0.6);
  }
  .s-none {
    color: var(--color-text-tertiary);
  }
  .s-none .bulb {
    box-shadow: none;
  }
  .meters {
    height: 150px;
    display: flex;
    justify-content: center;
    gap: 4px;
    padding: 2px 0;
  }
  .led {
    width: 9px;
    display: flex;
    flex-direction: column-reverse;
    gap: 2px;
  }
  .led i {
    flex: 1;
    border-radius: 1.5px;
    background: #201d29;
  }
  .led i.g.on {
    background: #22c55e;
  }
  .led i.y.on {
    background: #fbbf24;
  }
  .led i.r.on {
    background: #ef4444;
  }
  /* The strips you don't hear show their level dimmed */
  .strip:not(.solo) .led i.on {
    opacity: 0.42;
  }
  .lufs,
  .db,
  .foot {
    height: 16px;
    font-size: 11px;
    text-align: center;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
  }
  .foot {
    color: var(--color-text-tertiary);
  }
  .fader {
    height: 110px;
    padding: 8px 0;
    display: flex;
    justify-content: center;
  }
  .ft {
    position: relative;
    width: 4px;
    height: 100%;
    border-radius: 2px;
    background: #0c0b11;
    box-shadow: inset 0 0 0 1px #2a2733;
  }
  .tick {
    position: absolute;
    left: 12px;
    width: 7px;
    height: 1px;
    background: #3a3646;
  }
  .cap {
    position: absolute;
    left: 50%;
    width: 30px;
    height: 16px;
    margin: 0 0 -8px -15px;
    border-radius: 4px;
    background: linear-gradient(180deg, #56516a, #2c2938);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    transition: bottom 0.45s var(--ease-out);
  }
  .cap::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    top: 50%;
    height: 2px;
    margin-top: -1px;
    background: var(--color-text-primary);
  }
  .solo-btn {
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 8px;
    background: #221f2c;
    border: 1px solid #2f2c3a;
    color: var(--color-text-primary);
    font: inherit;
    font-weight: 650;
    font-size: 13px;
    cursor: pointer;
  }
  .solo-btn:hover:not(:disabled) {
    border-color: #4a4658;
  }
  .solo-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .solo .solo-btn {
    background: var(--gradient-accent);
    border-color: transparent;
    color: #fff;
  }
  .solo-btn kbd {
    font: 600 10px var(--font-sans);
    padding: 1px 5px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    opacity: 0.75;
  }
  @media (max-width: 640px) {
    .solo-btn kbd {
      display: none;
    }
  }
</style>
