<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api } from '$lib/api/client.js';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import LoadFailed from '$lib/components/overview/LoadFailed.svelte';
  import DashCard from '$lib/components/overview/DashCard.svelte';
  import MixerStrip from '$lib/components/overview/MixerStrip.svelte';
  import PeakBars from '$lib/components/overview/PeakBars.svelte';
  import { Mixer } from '$lib/audio/mixer.js';
  import { overviewIndex, overviewFailed, loadOverview } from '$lib/stores/overview.js';
  import { formatTime, formatWhen } from '$lib/utils/format.js';
  import { onKey } from '$lib/utils/shortcuts.js';
  import { byPosition, type TrackComment } from '$lib/utils/track.js';
  import { firstName, isRejection, matchGains, mixerTracks, projectGroups, type Marker } from '$lib/utils/overview.js';

  // Legend of the fader scale from −12 to +6 dB
  const SCALE = [
    [100, '+6'],
    [66.67, '0 dB'],
    [33.33, '−6'],
    [0, '−12'],
  ] as const;

  onMount(() => {
    void loadOverview(true);
    const update = () => (online = navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  });

  // Track and solo version live in the URL: /mixer?track=…&v=…
  const ix = $derived($overviewIndex);
  const candidates = $derived(ix ? mixerTracks(projectGroups(ix)) : []);
  const info = $derived(candidates.find((i) => i.track.id === $page.url.searchParams.get('track')) ?? candidates[0] ?? null);
  const versions = $derived(info?.versions ?? []);
  const solo = $derived(versions.find((v) => v.id === $page.url.searchParams.get('v')) ?? info?.latest ?? null);
  const trackId = $derived(info?.track.id ?? null);
  const versionKey = $derived(versions.map((v) => v.id).join(','));

  // A listening preference of this device, on by default
  let match = $state(localStorage.getItem('mixer-match') !== '0');
  let online = $state(navigator.onLine);
  const gains = $derived(matchGains(versions, match));
  const measured = $derived(versions.map((v) => v.integratedLufs).filter((x): x is number => x !== null));
  const reference = $derived(measured.length ? Math.min(...measured) : null);

  let mixer = $state.raw<Mixer | null>(null);
  let comments = $state.raw<Record<string, TrackComment[]>>({});
  let playing = $state(false);
  let position = $state(0);
  let levels = $state.raw(new Map<string, [number, number]>());
  // Versions without a stream or with a file the browser cannot play
  let broken = $state.raw(new Set<string>());

  // One mixer per track; it streams every version of it
  $effect(() => {
    const id = trackId;
    if (!id || !versionKey || !online) return;
    const list = untrack(() => versions);
    const first = untrack(() => solo?.id ?? list[list.length - 1].id);
    let cancelled = false;
    let created: Mixer | null = null;
    Promise.all([
      Promise.allSettled(list.map((v) => api.get<{ url: string }>(`/versions/${v.id}/stream-url`, true))),
      Promise.all(
        list.map((v) =>
          api
            .get<{ comments: TrackComment[] }>(`/comments/version/${v.id}`, true)
            .then((r) => r.comments.filter((c) => !isRejection(c.body)))
            .catch(() => [] as TrackComment[]),
        ),
      ),
    ])
      .then(([urls, lists]) => {
        if (cancelled) return;
        const url = (i: number) => (urls[i].status === 'fulfilled' ? urls[i].value.url : null);
        const m = new Mixer(list.map((v, i) => ({ id: v.id, url: url(i), duration: v.duration })), first);
        m.setGains(untrack(() => gains));
        m.onchange = () => {
          playing = m.playing;
          position = m.position();
          if (!m.playing) levels = new Map();
          broken = m.broken();
        };
        broken = m.broken();
        comments = Object.fromEntries(list.map((v, i) => [v.id, lists[i]]));
        created = m;
        mixer = m;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      created?.destroy();
      mixer = null;
      playing = false;
      position = 0;
      levels = new Map();
      broken = new Set();
    };
  });

  $effect(() => {
    if (mixer && solo) mixer.setSolo(solo.id);
  });

  $effect(() => {
    mixer?.setGains(gains);
  });

  // Position and meters follow the sound while it plays
  $effect(() => {
    const m = mixer;
    if (!playing || !m) return;
    let frame = requestAnimationFrame(function step() {
      position = m.position();
      levels = m.levels();
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  });

  function select(track: string, version?: string) {
    void goto(`/mixer?track=${track}${version ? `&v=${version}` : ''}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function toggle() {
    if (!mixer) return;
    if (playing) mixer.pause();
    else void mixer.play();
  }

  // Comments and clicks into the waveform jump there and play
  function jump(seconds: number) {
    if (!mixer) return;
    mixer.seek(seconds);
    position = seconds;
    if (!playing) void mixer.play();
  }

  function toggleMatch() {
    match = !match;
    localStorage.setItem('mixer-match', match ? '1' : '0');
  }

  onKey({
    ' ': toggle,
    ...Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [String(i + 1), () => info && versions[i] && !broken.has(versions[i].id) && select(info.track.id, versions[i].id)]),
    ),
  });

  const soloDuration = $derived(solo?.duration ?? 0);
  const author = (c: TrackComment) =>
    c.user ? (c.user.id === ix?.me ? 'Du' : firstName(c.user.name)) : `${c.guestName ?? 'Gast'} (Gast)`;
  const topLevel = (list: TrackComment[]) => list.filter((c) => !c.parentId);
  // Comments of the solo version: open first, then by position
  const listed = $derived(
    topLevel(solo ? (comments[solo.id] ?? []) : []).sort(
      (a, b) => Number(!!a.resolvedAt) - Number(!!b.resolvedAt) || byPosition(a, b),
    ),
  );
  const openCount = $derived(listed.filter((c) => !c.resolvedAt).length);
  const markers = $derived<Marker[]>(
    listed
      .filter((c) => c.timestampSeconds !== null)
      .map((c) => ({
        id: c.id,
        seconds: c.timestampSeconds!,
        tip: `${author(c)} bei ${formatTime(c.timestampSeconds!)}: ${c.body.length > 46 ? `${c.body.slice(0, 45)}…` : c.body}`,
        done: !!c.resolvedAt,
      })),
  );
</script>

<TopBar crumbs={[{ label: 'Mischpult' }]} />

<div class="page">
  <div class="head">
    <h1>Mischpult</h1>
    <span class="sub">Alle Versionen eines Tracks nebeneinander. „Solo“ schaltet an derselben Stelle um.</span>
  </div>

  {#if !online}
    <EmptyState title="Keine Verbindung" description="Das Mischpult braucht eine Verbindung, weil es alle Versionen gleichzeitig streamt." />
  {:else if !ix && $overviewFailed}
    <LoadFailed />
  {:else if !ix}
    <Skeleton height="24rem" variant="rect" />
  {:else if !info || !solo}
    <div class="none">Noch kein Track mit mehreren Versionen.</div>
  {:else}
    <div class="tracks">
      {#each candidates as c (c.track.id)}
        <button
          type="button"
          class="pill"
          class:on={c.track.id === info.track.id}
          aria-pressed={c.track.id === info.track.id}
          onclick={() => select(c.track.id)}
        >
          <CoverImage src={c.track.coverUrl ?? c.project.coverUrl} name={c.track.name} size="xs" rounded="lg" />
          <b>{c.track.name}</b>
          <small>{c.versions.length} Versionen</small>
        </button>
      {/each}
    </div>

    <div class="transport">
      <button type="button" class="play" aria-label={playing ? 'Stopp' : 'Start'} disabled={!mixer} onclick={toggle}>
        <Icon name={playing ? 'pause' : 'play'} size={20} />
      </button>
      <div class="now">
        <b>{info.track.name} V{solo.versionNumber}</b>
        <span>{formatTime(Math.min(position, soloDuration))} / {formatTime(soloDuration)}</span>
      </div>
      <div class="wave">
        <PeakBars
          versionId={solo.id}
          duration={soloDuration}
          count={200}
          progress={soloDuration ? Math.min(1, position / soloDuration) : 0}
          started
          {markers}
          onseek={jump}
        />
      </div>
      <div class="opts">
        <button type="button" class="switch" class:on={match} role="switch" aria-checked={match} onclick={toggleMatch}>
          <i></i>Lautheit angleichen
        </button>
        <span class="kbd"><kbd>1</kbd>–<kbd>{Math.min(9, versions.length)}</kbd> wechselt, <kbd>Leertaste</kbd> startet</span>
      </div>
    </div>

    <section class="desk" aria-label="Kanalzüge">
      <div class="legend-strip" aria-hidden="true">
        <div class="lbl" style="height: 52px">Version</div>
        <div class="lbl" style="height: 22px">Von</div>
        <div class="lbl" style="height: 26px">Stand</div>
        <div class="lbl" style="height: 150px">Pegel L/R</div>
        <div class="lbl" style="height: 16px">Lautheit</div>
        <div class="scale">
          <div class="marks">
            {#each SCALE as [p, label] (label)}<span style="bottom: {p}%">{label}</span>{/each}
          </div>
        </div>
        <div class="lbl" style="height: 16px">Angleich</div>
        <div class="lbl" style="height: 36px">Hören</div>
        <div class="lbl" style="height: 16px">Kommentare</div>
      </div>
      {#each versions as v, i (v.id)}
        <MixerStrip
          {ix}
          version={v}
          index={i}
          solo={v.id === solo.id}
          latest={v.id === info.latest?.id}
          gain={gains.get(v.id) ?? 0}
          {reference}
          {match}
          levels={levels.get(v.id) ?? [0, 0]}
          comments={topLevel(comments[v.id] ?? [])}
          broken={broken.has(v.id)}
          onsolo={() => select(info.track.id, v.id)}
        />
      {/each}
    </section>

    <DashCard
      icon="comment"
      title="Kommentare zu V{solo.versionNumber}"
      sub={listed.length ? (openCount ? `${openCount} offen` : 'alle erledigt') : ''}
    >
      {#if listed.length}
        <ul class="cms">
          {#each listed as c (c.id)}
            <li>
              <button type="button" disabled={c.timestampSeconds === null} onclick={() => c.timestampSeconds !== null && jump(c.timestampSeconds)}>
                <Avatar name={c.user?.name ?? c.guestName ?? 'Gast'} src={c.user?.avatarUrl ?? null} size="xs" />
                {#if c.timestampSeconds !== null}<span class="tchip">{formatTime(c.timestampSeconds)}</span>{/if}
                <span class="body"><b>{author(c)}</b>{c.body}{#if c.resolvedAt}<span class="dim">{' '}· erledigt</span>{/if}</span>
                <span class="when">{formatWhen(c.createdAt)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">Zu dieser Version gibt es keine Kommentare.</p>
      {/if}
    </DashCard>
  {/if}
</div>

<style>
  .page {
    padding: var(--space-6);
  }
  .head {
    margin-bottom: var(--space-5);
  }
  h1 {
    margin: 0;
    font-size: var(--text-xl);
    line-height: 1.25;
  }
  .sub {
    display: block;
    margin-top: 2px;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
  .none {
    padding: var(--space-8) var(--space-4);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-lg);
  }
  .tracks {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    margin-bottom: var(--space-4);
    padding-bottom: 2px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    height: 34px;
    padding: 0 12px 0 6px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    background: var(--color-bg-raised);
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: pointer;
  }
  .pill:hover {
    border-color: var(--color-border-hover);
    color: var(--color-text-primary);
  }
  .pill.on {
    border-color: rgba(244, 63, 94, 0.55);
    background: var(--color-bg-overlay);
    color: var(--color-text-primary);
  }
  .pill b {
    font-weight: 500;
  }
  .pill small {
    color: var(--color-text-tertiary);
    font-size: 12px;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: var(--space-4);
    padding: 14px 18px;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
  }
  .play {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50%;
    background: var(--gradient-accent);
    color: #fff;
    box-shadow: 0 6px 20px rgba(244, 63, 94, 0.3);
    cursor: pointer;
  }
  .play:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .now {
    min-width: 128px;
  }
  .now b {
    display: block;
    color: var(--color-text-primary);
    font-size: var(--text-base);
    font-weight: 600;
    white-space: nowrap;
  }
  .now span {
    font-size: 12px;
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .wave {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 58px;
    --bars-top: 16px;
    --marker-line: 46px;
  }
  .opts {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    flex-shrink: 0;
  }
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: 13px;
    color: var(--color-text-primary);
    white-space: nowrap;
    cursor: pointer;
  }
  .switch i {
    position: relative;
    width: 32px;
    height: 18px;
    flex-shrink: 0;
    border-radius: 9px;
    background: #3a3646;
    transition: background 0.15s;
  }
  .switch i::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #f4f0ec;
    transition: transform 0.18s var(--ease-out);
  }
  .switch.on i {
    background: var(--color-accent);
  }
  .switch.on i::after {
    transform: translateX(14px);
  }
  .kbd {
    font-size: 11.5px;
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
  .kbd kbd {
    font: 600 10.5px var(--font-sans);
    padding: 0 4px;
    border: 1px solid #3a3646;
    border-bottom-width: 2px;
    border-radius: 4px;
    background: #17151f;
    color: var(--color-text-secondary);
  }
  .desk {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    margin-bottom: var(--space-4);
    padding: 14px;
    background: linear-gradient(180deg, #16141e, #0f0e15);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    scrollbar-width: thin;
    scrollbar-color: #2a2735 transparent;
  }
  .legend-strip {
    position: sticky;
    left: 0;
    z-index: 2;
    width: 84px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 9px 6px 9px 0;
    background: linear-gradient(90deg, #15131c 82%, rgba(21, 19, 28, 0));
  }
  .lbl {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    font-size: 11px;
    line-height: 1.2;
    color: var(--color-text-axis);
    text-align: right;
  }
  .scale {
    height: 110px;
    padding: 8px 0;
  }
  .marks {
    position: relative;
    height: 100%;
    font-size: 11px;
    color: var(--color-text-axis);
  }
  .marks span {
    position: absolute;
    right: 0;
    transform: translateY(50%);
    white-space: nowrap;
  }
  .cms {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .cms button {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: calc(100% + 16px);
    margin: 0 -8px;
    padding: 6px 8px;
    border: none;
    border-radius: 8px;
    background: none;
    font: inherit;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-align: left;
    cursor: pointer;
  }
  .cms button:hover:not(:disabled) {
    background: var(--color-bg-overlay);
  }
  .cms button:disabled {
    cursor: default;
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .body b {
    color: var(--color-text-primary);
    font-weight: 600;
    margin-right: 5px;
  }
  .dim {
    color: var(--color-text-tertiary);
  }
  .when {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    margin-top: 2px;
  }
  /* Phone: strips swipe sideways, no legend and no key hints */
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4) var(--space-4) var(--space-8);
    }
    .transport {
      flex-wrap: wrap;
      gap: 12px;
      padding: 12px 14px;
    }
    .wave {
      order: 3;
      flex-basis: 100%;
    }
    .opts {
      order: 4;
      flex-direction: row;
      align-items: center;
    }
    .kbd,
    .legend-strip {
      display: none;
    }
  }
</style>
