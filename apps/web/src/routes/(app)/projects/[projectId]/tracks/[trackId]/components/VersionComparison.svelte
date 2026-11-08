<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { Mixer } from '$lib/audio/mixer.js';
  import { formatTime } from '$lib/utils/format.js';
  import { matchGains } from '$lib/utils/overview.js';
  import { versionTitle, type Version, type TrackComment } from '$lib/utils/track.js';
  import { onKey } from '$lib/utils/shortcuts.js';
  import { t } from '$lib/i18n/index.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';

  let { previous, version, comments, canComment, initialTime = 0, onResolve, onClose }: {
    previous: Version; version: Version; comments: TrackComment[]; canComment: boolean; initialTime?: number;
    onResolve: (id: string) => Promise<void>; onClose: (time: number) => void;
  } = $props();
  let mixer = $state.raw<Mixer | null>(null);
  let selected = $state(1);
  let playing = $state(false);
  let position = $state(0);
  let match = $state(true);
  let error = $state('');
  let broken = $state.raw(new Set<string>());
  let resolving = $state<string | null>(null);
  let waveforms = $state<number[][]>([[], []]);
  // Blind test: slots show the pair in a random order as X and Y until a pick reveals them
  let blind = $state<{ order: number[]; picked: string | null; picks: string[] } | null>(null);
  const pair = $derived([previous, version]);
  const shown = $derived(blind ? blind.order.map((i) => pair[i]) : pair);
  const active = $derived(shown[selected]);
  const hidden = $derived(blind !== null && blind.picked === null);
  const duration = $derived(hidden ? Math.max(...pair.map((v) => v.duration ?? 0)) : active.duration ?? 0);
  const wave = $derived(waveforms[pair.indexOf(active)] ?? []);
  const label = (i: number) => (blind ? (i === 0 ? 'X' : 'Y') : i === 0 ? 'A' : 'B');
  const open = $derived(comments.filter((c) => !c.parentId && !c.deletedAt && !c.resolvedAt));
  const measured = $derived(pair.every((v) => v.integratedLufs != null));

  onMount(() => {
    position = initialTime;
    let cancelled = false;
    let created: Mixer | null = null;
    Promise.all([
      Promise.all(pair.map((v) => api.get<{ url: string }>(`/versions/${v.id}/stream-url`, true))),
      Promise.all(pair.map((v) => api.get<number[]>(`/versions/${v.id}/waveform-data`, true).catch(() => []))),
    ]).then(([streams, waves]) => {
      if (cancelled) return;
      const m = new Mixer(pair.map((v, i) => ({ id: v.id, url: streams[i].url, duration: v.duration })), pair[selected].id);
      m.onchange = () => { playing = m.playing; broken = m.broken(); };
      m.seek(position);
      created = mixer = m;
      waveforms = waves;
    }).catch(() => { if (!cancelled) error = t().track.comparison.loadFailed; });
    return () => { cancelled = true; created?.destroy(); };
  });
  $effect(() => { mixer?.setGains(matchGains(pair.map((v) => ({ id: v.id, integratedLufs: v.integratedLufs ?? null })), (match || blind !== null) && measured)); });
  $effect(() => {
    if (!playing || !mixer) return;
    let frame = requestAnimationFrame(function update() { position = mixer!.position(); frame = requestAnimationFrame(update); });
    return () => cancelAnimationFrame(frame);
  });
  function select(i: number) { selected = i; mixer?.setSolo(shown[i].id); }
  function shuffle(picks: string[]) {
    blind = { order: Math.random() < 0.5 ? [0, 1] : [1, 0], picked: null, picks };
    select(0);
  }
  function endBlind() {
    const id = active.id;
    blind = null;
    select(pair.findIndex((v) => v.id === id));
  }
  function pick(i: number) {
    if (blind) blind = { ...blind, picked: shown[i].id, picks: [...blind.picks, shown[i].id] };
  }
  const tally = $derived(blind ? pair.map((v) => `V${v.versionNumber} ${blind!.picks.filter((id) => id === v.id).length}×`).join(', ') : '');
  const pickedVersion = $derived(pair.find((v) => v.id === blind?.picked));
  function toggle() { if (mixer?.playing) mixer.pause(); else void mixer?.play(); }
  function seek(time: number) { position = time; mixer?.seek(time); }
  async function resolve(id: string) {
    resolving = id;
    try { await onResolve(id); } finally { resolving = null; }
  }
  onKey({ '1': () => select(0), '2': () => select(1), ' ': toggle });
</script>

<section class="comparison" aria-label={t().track.comparison.title}>
  <div class="heading"><h2>V{previous.versionNumber} ↔ V{version.versionNumber}</h2><div class="actions">{#if blind}<Button size="sm" variant="secondary" onclick={endBlind}>{t().track.comparison.endBlind}</Button>{:else}<Button size="sm" variant="secondary" onclick={() => shuffle([])}>{t().track.comparison.blind}</Button>{/if}<Button size="sm" variant="ghost" onclick={() => onClose(position)}>{t().common.back}</Button></div></div>
  {#if hidden}<p class="hint">{t().track.comparison.blindHint}{#if !measured}<br />{t().track.comparison.blindUnmatched}{/if}</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  <div class="choices">
    {#each shown as v, i}
      <button class:on={selected === i} aria-pressed={selected === i} onclick={() => select(i)}>
        <b>{label(i)}</b><kbd>{i + 1}</kbd><span>{hidden ? '?' : `V${v.versionNumber} · ${versionTitle(v)}`}</span>
      </button>
    {/each}
  </div>
  <div class="transport">
    <Button onclick={toggle} disabled={!mixer || broken.has(active.id)}><Icon name={playing ? 'pause' : 'play'} size={20} />{playing ? t().track.player.pause : t().track.player.play}</Button>
    <div class="wave" aria-hidden="true">{#if !hidden}{#each wave.filter((_, i) => i % Math.max(1, Math.floor(wave.length / 80)) === 0).slice(0, 80) as peak}<i style="height: {Math.max(4, Math.abs(peak) * 100)}%"></i>{/each}{/if}</div>
  </div>
  {#if broken.has(active.id)}<p role="alert">{t().track.comparison.cannotPlay}</p>{/if}
  <label class="seek">{t().track.comparison.position}
    <input type="range" min="0" max={duration} step="0.1" value={Math.min(position, duration)} oninput={(e) => seek(Number(e.currentTarget.value))} />
  </label>
  <p class="time" aria-live="off">{hidden ? t().track.comparison.listeningTo(label(selected)) : t().track.comparison.listening(active.versionNumber)} · {formatTime(position)} / {formatTime(duration)}</p>
  {#if blind}
    <div class="verdict" aria-live="polite">
      {#if pickedVersion}
        <p><b>{t().track.comparison.picked(label(shown.indexOf(pickedVersion)), pickedVersion.versionNumber)}</b> {t().track.comparison.tally(tally)}</p>
        <Button size="sm" onclick={() => shuffle(blind!.picks)}>{t().track.comparison.nextRound}</Button>
      {:else}
        {#each shown as _, i}<Button size="sm" variant="secondary" onclick={() => pick(i)}>{t().track.comparison.better(label(i))}</Button>{/each}
      {/if}
    </div>
  {/if}
  <label class="match"><input type="checkbox" checked={match || blind !== null} onchange={(e) => { match = e.currentTarget.checked; }} disabled={!measured || blind !== null} /> {t().track.comparison.matchLoudness}{!measured ? t().track.comparison.notMeasured : t().track.comparison.matched}</label>
  {#if open.length}
    <h3>{t().track.comparison.openPoints(open.length, previous.versionNumber, version.versionNumber)}</h3>
    <ul>{#each open as c}<li><p>{#if c.timestampSeconds !== null}<button class="timestamp" onclick={() => seek(c.timestampSeconds!)}>{formatTime(c.timestampSeconds)}</button>{/if} {c.body}</p>{#if canComment}<Button size="sm" variant="secondary" disabled={resolving !== null} onclick={() => resolve(c.id)}>{t().track.comparison.solved}</Button>{/if}</li>{/each}</ul>
  {/if}
</section>

<style>
  .comparison { padding: var(--space-5); display: grid; gap: var(--space-4); background: var(--color-bg-raised); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
  .heading, .transport { display: flex; gap: var(--space-3); align-items: center; }
  .heading { justify-content: space-between; flex-wrap: wrap; }
  .actions, .verdict { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
  .verdict p { flex: 1 1 16rem; }
  .hint { color: var(--color-text-secondary); font-size: var(--text-sm); }
  h2, h3, p { margin: 0; }
  h2 { font-family: var(--font-display); }
  h3 { font-size: var(--text-sm); }
  .choices { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
  .choices button { min-width: 0; padding: var(--space-4); border: 1px solid var(--color-border-hover); background: var(--color-bg-base); border-radius: var(--radius-md); display: grid; grid-template-columns: 1fr auto; text-align: left; gap: var(--space-2); cursor: pointer; color: var(--color-text-primary); }
  .choices button.on { border-color: var(--color-accent); background: var(--color-accent-subtle); }
  .choices b { font: 800 1.75rem var(--font-display); }
  .choices span { grid-column: 1 / -1; overflow-wrap: anywhere; font-size: var(--text-sm); }
  kbd, .time, .match { color: var(--color-text-secondary); font-size: var(--text-sm); }
  .wave { flex: 1; height: 64px; display: flex; align-items: center; gap: 2px; overflow: hidden; }
  .wave i { flex: 1; background: var(--color-accent); border-radius: 2px; }
  .seek { display: grid; gap: var(--space-2); font-size: var(--text-xs); color: var(--color-text-secondary); }
  .seek input { width: 100%; accent-color: var(--color-accent); }
  .match { display: flex; align-items: center; gap: var(--space-2); }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; gap: var(--space-3); align-items: center; border-top: 1px solid var(--color-border); padding: var(--space-3) 0; }
  li p { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .timestamp { padding: 0; border: 0; background: none; color: var(--color-accent); cursor: pointer; }
  @media (max-width: 540px) { .comparison { padding: var(--space-4); } .choices button { padding: var(--space-3); } }
</style>
