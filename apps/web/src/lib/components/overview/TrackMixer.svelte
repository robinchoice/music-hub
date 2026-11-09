<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { t } from '$lib/i18n/index.js';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import DashCard from './DashCard.svelte';
  import MixerStrip from './MixerStrip.svelte';
  import PeakBars from './PeakBars.svelte';
  import { Mixer } from '$lib/audio/mixer.js';
  import { formatTime, formatWhen } from '$lib/utils/format.js';
  import { onKey } from '$lib/utils/shortcuts.js';
  import { byPosition, type TrackComment } from '$lib/utils/track.js';
  import { firstName, isRejection, matchGains, type Marker, type OverviewIndex, type TrackInfo } from '$lib/utils/overview.js';

  // Legend of the fader scale from −12 to +6 dB
  const SCALE = [
    [100, '+6'],
    [66.67, '0 dB'],
    [33.33, '−6'],
    [0, '−12'],
  ] as const;

  // All versions of one track side by side; "Solo" switches at the same position
  let { ix, info, soloId, onsolo }: { ix: OverviewIndex; info: TrackInfo; soloId: string | null; onsolo: (versionId: string) => void } =
    $props();

  onMount(() => {
    const update = () => (online = navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  });

  const versions = $derived(info.versions);
  const solo = $derived(versions.find((v) => v.id === soloId) ?? info.latest);
  const trackId = $derived(info.track.id);
  const versionKey = $derived(versions.map((v) => v.id).join(','));

  // A listening preference of this device, on by default
  let match = $state(localStorage.getItem('mixer-match') !== '0');
  let online = $state(navigator.onLine);
  // Blind test: the chosen versions play as A, B, C … in random order until a pick reveals them
  let choosing = $state<string[] | null>(null);
  let blind = $state<{ ids: string[]; order: string[]; slot: number; picked: string | null; picks: string[] } | null>(null);
  const hidden = $derived(blind !== null && blind.picked === null);
  const byId = (id: string) => versions.find((v) => v.id === id);
  const letter = (i: number) => String.fromCharCode(65 + i);
  const gains = $derived(matchGains(versions, match || blind !== null));
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

  // What sounds: the blind slot, otherwise the solo version of the page
  const current = $derived(blind ? (byId(blind.order[blind.slot]) ?? solo) : solo);
  $effect(() => {
    if (mixer && current) mixer.setSolo(current.id);
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

  function startBlind() {
    const playable = versions.filter((v) => !broken.has(v.id)).sort((a, b) => a.versionNumber - b.versionNumber);
    if (playable.length === 2) shuffle(playable.map((v) => v.id), []);
    else choosing = playable.slice(-4).map((v) => v.id);
  }
  function shuffle(ids: string[], picks: string[]) {
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    choosing = null;
    blind = { ids, order, slot: 0, picked: null, picks };
  }
  function listenTo(slot: number) {
    if (blind && slot < blind.order.length) blind = { ...blind, slot };
  }
  function pick(slot: number) {
    if (blind) blind = { ...blind, picked: blind.order[slot], picks: [...blind.picks, blind.order[slot]] };
  }
  function endBlind() {
    const id = current?.id;
    blind = null;
    if (id) onsolo(id);
  }
  function choose(id: string) {
    if (choosing) choosing = choosing.includes(id) ? choosing.filter((x) => x !== id) : [...choosing, id];
  }
  const tally = $derived(
    blind ? blind.ids.map((id) => `V${byId(id)?.versionNumber} ${blind!.picks.filter((p) => p === id).length}×`).join(', ') : '',
  );

  function toggleMatch() {
    match = !match;
    localStorage.setItem('mixer-match', match ? '1' : '0');
  }

  onKey({
    ' ': toggle,
    ...Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        String(i + 1),
        () => (blind ? listenTo(i) : versions[i] && !broken.has(versions[i].id) && onsolo(versions[i].id)),
      ]),
    ),
  });

  // While hidden, the longest contender sets the length so it reveals nothing
  const soloDuration = $derived(
    hidden ? Math.max(...blind!.order.map((id) => byId(id)?.duration ?? 0)) : (current?.duration ?? 0),
  );
  const author = (c: TrackComment) =>
    c.user ? (c.user.id === ix.me ? t().common.you : firstName(c.user.name)) : t().overview.names.guestNamed(c.guestName ?? t().common.guest);
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
        tip: t().overview.marker(author(c), formatTime(c.timestampSeconds!), c.body.length > 46 ? `${c.body.slice(0, 45)}…` : c.body),
        done: !!c.resolvedAt,
      })),
  );
</script>

{#if !online}
  <EmptyState title={t().overview.mixer.offline} description={t().overview.mixer.offlineText} />
{:else if solo}
  <div class="transport">
    <button type="button" class="play" aria-label={playing ? t().overview.mixer.stop : t().overview.mixer.start} disabled={!mixer} onclick={toggle}>
      <Icon name={playing ? 'pause' : 'play'} size={20} />
    </button>
    <div class="now">
      <b>{hidden ? letter(blind!.slot) : `V${current?.versionNumber}`}</b>
      <span>{formatTime(Math.min(position, soloDuration))} / {formatTime(soloDuration)}</span>
    </div>
    <div class="wave">
      {#if hidden}
        <input class="seek" type="range" min="0" max={soloDuration} step="0.1" value={Math.min(position, soloDuration)} aria-label={t().overview.mixer.position} oninput={(e) => { const s = Number(e.currentTarget.value); position = s; mixer?.seek(s); }} />
      {:else}
      <PeakBars
        versionId={current?.id ?? solo.id}
        duration={soloDuration}
        count={200}
        progress={soloDuration ? Math.min(1, position / soloDuration) : 0}
        started
        markers={blind ? [] : markers}
        onseek={jump}
      />
      {/if}
    </div>
    <div class="opts">
      <button type="button" class="switch" class:on={match || blind !== null} role="switch" aria-checked={match || blind !== null} disabled={blind !== null} onclick={toggleMatch}>
        <i></i>{t().overview.mixer.matchLoudness}
      </button>
      {#if blind || choosing}
        <Button size="sm" variant="secondary" onclick={() => { if (blind) endBlind(); choosing = null; }}>{blind ? t().overview.mixer.endBlind : t().common.cancel}</Button>
      {:else}
        <Button size="sm" variant="secondary" onclick={startBlind}>{t().overview.mixer.blind}</Button>
      {/if}
      <span class="kbd"><kbd>1</kbd>–<kbd>{Math.min(9, blind ? blind.order.length : versions.length)}</kbd> {t().overview.mixer.keysSwitch}, <kbd>{t().overview.mixer.space}</kbd> {t().overview.mixer.keysStart}</span>
    </div>
  </div>

  {#if choosing}
    <section class="blind" aria-label={t().overview.mixer.blind}>
      <p>{t().overview.mixer.blindChoose}</p>
      <div class="row">
        {#each versions.filter((v) => !broken.has(v.id)) as v (v.id)}
          <label class="chip"><input type="checkbox" checked={choosing.includes(v.id)} onchange={() => choose(v.id)} /> V{v.versionNumber}</label>
        {/each}
      </div>
      <div class="row"><Button disabled={choosing.length < 2} onclick={() => shuffle(choosing!, [])}>{t().overview.mixer.blindStart}</Button></div>
    </section>
  {:else if blind}
    <section class="blind" aria-label={t().overview.mixer.blind}>
      {#if hidden}
        <p class="hint">{t().overview.mixer.blindHint}{#if blind.ids.some((id) => byId(id)?.integratedLufs == null)}{' '}{t().overview.mixer.blindUnmatched}{/if}</p>
      {/if}
      <div class="slots">
        {#each blind.order as id, i (id)}
          <div class="slot" class:on={blind.slot === i}>
            <button type="button" aria-pressed={blind.slot === i} onclick={() => listenTo(i)}>
              <b>{letter(i)}</b><kbd>{i + 1}</kbd><span>{hidden ? '?' : `V${byId(id)?.versionNumber}`}</span>
            </button>
            {#if hidden}<Button size="sm" variant="secondary" onclick={() => pick(i)}>{t().overview.mixer.better(letter(i))}</Button>{/if}
          </div>
        {/each}
      </div>
      {#if blind.picked}
        <div class="row">
          <p><b>{t().overview.mixer.picked(letter(blind.order.indexOf(blind.picked)), byId(blind.picked)?.versionNumber ?? 0)}</b> {t().overview.mixer.tally(tally)}</p>
          <Button size="sm" onclick={() => shuffle(blind!.ids, blind!.picks)}>{t().overview.mixer.nextRound}</Button>
        </div>
      {/if}
    </section>
  {:else}
  <section class="desk" aria-label={t().overview.mixer.strips}>
    <div class="legend-strip" aria-hidden="true">
      <div class="lbl" style="height: 52px">{t().overview.mixer.version}</div>
      <div class="lbl" style="height: var(--row-who)">{t().overview.mixer.from}</div>
      <div class="lbl" style="height: var(--row-lamp)">{t().overview.mixer.status}</div>
      <div class="lbl" style="height: 150px">{t().overview.mixer.level}</div>
      <div class="lbl" style="height: 16px">{t().overview.mixer.loudness}</div>
      <div class="scale">
        <div class="marks">
          {#each SCALE as [p, label] (label)}<span style="bottom: {p}%">{label}</span>{/each}
        </div>
      </div>
      <div class="lbl" style="height: 16px">{t().overview.mixer.match}</div>
      <div class="lbl" style="height: 36px">{t().overview.mixer.listen}</div>
      <div class="lbl" style="height: 16px">{t().overview.mixer.comments}</div>
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
        onsolo={() => onsolo(v.id)}
      />
    {/each}
  </section>

  <DashCard
    icon="comment"
    title={t().overview.mixer.commentsOn(solo.versionNumber)}
    sub={listed.length ? (openCount ? t().overview.mixer.openCount(openCount) : t().overview.mixer.allResolved) : ''}
  >
    {#if listed.length}
      <ul class="cms">
        {#each listed as c (c.id)}
          <li>
            <button type="button" disabled={c.timestampSeconds === null} onclick={() => c.timestampSeconds !== null && jump(c.timestampSeconds)}>
              <Avatar name={c.user?.name ?? c.guestName ?? t().common.guest} src={c.user?.avatarUrl ?? null} size="xs" />
              {#if c.timestampSeconds !== null}<span class="tchip">{formatTime(c.timestampSeconds)}</span>{/if}
              <span class="body"><b>{author(c)}</b>{c.body}{#if c.resolvedAt}<span class="dim">{' '}· {t().overview.mixer.resolved}</span>{/if}</span>
              <span class="when">{formatWhen(c.createdAt)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">{t().overview.mixer.noComments}</p>
    {/if}
  </DashCard>
  {/if}
{/if}

<style>
  .blind {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
  }
  .blind p {
    margin: 0;
  }
  .blind .hint {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .row p {
    flex: 1 1 16rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .slots {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-3);
  }
  .slot {
    display: grid;
    gap: var(--space-2);
  }
  .slot button {
    padding: var(--space-4);
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-2);
    text-align: left;
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .slot.on button {
    border-color: var(--color-accent);
    background: var(--color-accent-subtle);
  }
  .slot b {
    font: 800 1.75rem var(--font-display);
  }
  .slot kbd {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .slot span {
    grid-column: 1 / -1;
    font-size: var(--text-sm);
  }
  .seek {
    width: 100%;
    height: 100%;
    accent-color: var(--color-accent);
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
    /* Neutral like every play button, the gradient belongs to what is playing */
    background: var(--color-text-primary);
    color: var(--color-bg-base);
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
    --row-who: 36px;
    --row-lamp: 44px;
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
