<script lang="ts">
  import { compareMeasurements, FLOOR_DB, predecessorOf, THIRD_OCTAVE_HZ, type Measurements } from '@music-hub/shared';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { dateLocale, t } from '$lib/i18n/index.js';
  import type { Version } from '$lib/utils/track.js';

  let { version, versions }: { version: Version & { measurements: Measurements }; versions: Version[] } = $props();

  const m = $derived(version.measurements);
  // The previous version, heard at the same loudness: what changed in the mix, not how loud it got
  const previous = $derived(predecessorOf(version, versions));
  const comparison = $derived(
    previous?.measurements
      ? compareMeasurements(
          { measurements: m, integratedLufs: version.integratedLufs ?? null, truePeak: version.truePeak ?? null },
          { measurements: previous.measurements, integratedLufs: previous.integratedLufs ?? null, truePeak: previous.truePeak ?? null },
        )
      : null,
  );

  const num = (x: number, digits: number, sign = false) =>
    x.toLocaleString(dateLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: sign ? 'exceptZero' : 'auto' }).replace('-', '−');
  const hz = (f: number) => (f >= 1000 ? `${num(f / 1000, f % 1000 ? 1 : 0)}k` : num(f, f % 1 ? 1 : 0));

  // 31 columns of 10 units; the spectrum shows the 60 dB below its loudest band
  const H = 64;
  const RANGE = 60;
  const top = $derived(Math.max(...m.bands));
  const levels = $derived(m.bands.map((b) => (b === FLOOR_DB ? 0 : Math.max(0, (b - top + RANGE) / RANGE))));
  // The differences fill ±3 dB at least, ±12 dB at most
  const span = $derived(comparison ? Math.min(12, Math.max(3, ...comparison.bandDiffDb.map(Math.abs))) : 3);
  const same = $derived(comparison?.bandDiffDb.every((d) => Math.abs(d) < 0.5) ?? false);
  const TICKS = [2, 8, 14, 20, 26];
</script>

<details class="measurements">
  <summary>
    <span class="toggle">{t().track.measurements.title}<Icon name="chevron-down" size={12} /></span>
    <span class="facts">
      <span title={t().track.measurements.widthHint}>{t().track.measurements.width} {num(m.width, 2)}</span>
      <span title={t().track.measurements.monoLossHint}>{t().track.measurements.monoLoss} {num(m.monoLossLu, 1)} LU</span>
    </span>
  </summary>

  <dl>
    <div title={t().track.measurements.widthHint}><dt>{t().track.measurements.width}</dt><dd>{num(m.width, 2)}</dd></div>
    <div title={t().track.measurements.correlationHint}><dt>{t().track.measurements.correlation}</dt><dd>{num(m.correlation, 2)}</dd></div>
    <div title={t().track.measurements.monoLossHint}><dt>{t().track.measurements.monoLoss}</dt><dd>{num(m.monoLossLu, 1)} LU</dd></div>
  </dl>

  <h3>{t().track.measurements.spectrum}</h3>
  <svg viewBox="0 0 310 {H}" preserveAspectRatio="none" role="img" aria-label={t().track.measurements.spectrumLabel(`${hz(THIRD_OCTAVE_HZ[m.bands.indexOf(top)]!)} Hz`)}>
    {#each levels as level, i}
      <g>
        <title>{hz(THIRD_OCTAVE_HZ[i]!)} Hz: {m.bands[i] === FLOOR_DB ? '–' : `${num(m.bands[i]!, 1)} dB`}</title>
        <rect class="hit" x={i * 10} y="0" width="10" height={H} />
        <rect class="bar" x={i * 10 + 1} y={H - level * H} width="8" height={level * H} rx="1.5" />
      </g>
    {/each}
  </svg>
  <div class="ticks" aria-hidden="true">
    {#each TICKS as i}<span style="left: {((i + 0.5) / 31) * 100}%">{hz(THIRD_OCTAVE_HZ[i]!)}</span>{/each}
  </div>

  {#if comparison && previous}
    <h3>{t().track.measurements.versus(previous.versionNumber)}</h3>
    <p class="deltas">
      {#if comparison.lufsDiff !== null}<span>{t().track.measurements.loudness} {num(comparison.lufsDiff, 1, true)} LU</span>{/if}
      {#if comparison.crestDiffDb !== null}<span>{t().track.measurements.crest} {num(comparison.crestDiffDb, 1, true)} dB</span>{/if}
      <span>{t().track.measurements.width} {num(comparison.widthDiff, 2, true)}</span>
      {#if same}<span>{t().track.measurements.same}</span>{/if}
    </p>
    <svg viewBox="0 0 310 {H}" preserveAspectRatio="none" role="img" aria-label={t().track.measurements.versusLabel(previous.versionNumber)}>
      <line class="zero" x1="0" x2="310" y1={H / 2} y2={H / 2} />
      {#each comparison.bandDiffDb as d, i}
        {@const h = (Math.min(span, Math.abs(d)) / span) * (H / 2)}
        <g>
          <title>{hz(THIRD_OCTAVE_HZ[i]!)} Hz: {num(d, 1, true)} dB</title>
          <rect class="hit" x={i * 10} y="0" width="10" height={H} />
          <rect class="bar" x={i * 10 + 1} y={d > 0 ? H / 2 - h : H / 2} width="8" height={h} rx="1.5" />
        </g>
      {/each}
    </svg>
    <div class="ticks" aria-hidden="true">
      {#each TICKS as i}<span style="left: {((i + 0.5) / 31) * 100}%">{hz(THIRD_OCTAVE_HZ[i]!)}</span>{/each}
      <span class="scale">±{num(span, 0)} dB</span>
    </div>
  {/if}
</details>

<style>
  .measurements {
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--space-2);
    cursor: pointer;
    color: var(--color-text-secondary);
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .measurements[open] .toggle :global(svg) {
    transform: rotate(180deg);
  }
  .facts {
    display: contents;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-tertiary);
  }
  .measurements[open] .facts {
    display: none;
  }
  dl {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-5);
    margin: var(--space-3) 0 0;
  }
  dt {
    color: var(--color-text-tertiary);
  }
  dd {
    margin: 0;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
  }
  h3 {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-secondary);
  }
  svg {
    display: block;
    width: 100%;
    height: 64px;
  }
  .hit {
    fill: transparent;
  }
  .bar {
    fill: color-mix(in srgb, var(--color-accent) 80%, transparent);
  }
  g:hover .bar {
    opacity: 0.7;
  }
  .zero {
    stroke: var(--color-border-hover);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .ticks {
    position: relative;
    height: 1.4em;
    margin-top: 2px;
    font-variant-numeric: tabular-nums;
  }
  .ticks span {
    position: absolute;
    transform: translateX(-50%);
  }
  .ticks .scale {
    right: 0;
    transform: none;
  }
  .deltas {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
    margin: 0 0 var(--space-2);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
  }
</style>
