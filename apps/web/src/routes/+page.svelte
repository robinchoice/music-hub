<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { authLoading, user } from '$lib/stores/auth.js';
  import { toast, toastError } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Tile from '$lib/components/ui/Tile.svelte';
  import WaveformPlayer from '$lib/components/audio/WaveformPlayer.svelte';
  import DemoFrame from '$lib/components/landing/DemoFrame.svelte';
  import SiteFooter from '$lib/components/landing/SiteFooter.svelte';
  import { DEMO, demoRequest } from '$lib/demo/backend.js';
  import { locale, t } from '$lib/i18n/index.js';
  import ReviewSheet from '$lib/components/review/ReviewSheet.svelte';
  import {
    feedbackRows,
    isDecided,
    commentMarkers,
    openPass,
    predecessorOf,
    versionTitle,
    type Person,
    type Review,
    type ReviewVerdict,
    type TrackComment,
    type Version,
  } from '$lib/utils/track.js';
  // The landing page shows the components of the real track page, filled with the demo data
  import VersionList from './(app)/projects/[projectId]/tracks/[trackId]/components/VersionList.svelte';
  import VersionCard from './(app)/projects/[projectId]/tracks/[trackId]/components/VersionCard.svelte';
  import CommentSection from './(app)/projects/[projectId]/tracks/[trackId]/components/CommentSection.svelte';
  import FeedbackList from './(app)/projects/[projectId]/tracks/[trackId]/components/FeedbackList.svelte';

  const REPO = 'https://github.com/robinchoice/music-hub';
  const SELF_HOSTING = `${REPO}#self-hosting`;

  let { data } = $props();
  const signedIn = $derived($authLoading ? data.signedIn : !!$user);

  let mounted = $state(false);
  let small = $state(false);
  let heroOpen = $state(false);
  let versions = $state<Version[]>([]);
  let comments = $state<Record<string, TrackComment[]>>({});
  let listId = $state<string | null>(null);
  let feedbackId = $state<string | null>(null);
  let decisionId = $state<string | null>(null);
  let feedbackVisible = $state(false);
  let currentTime = $state(0);
  let commentTimestamp = $state<number | null>(42);
  let player = $state<WaveformPlayer>();
  let reviews = $state<Record<string, { reviews: Review[]; waiting: Person[]; uploader: { id: string; name: string } | null }>>({});
  let reviewOpen = $state(false);
  let introDone = false;

  const byId = (id: string | null) => versions.find((v) => v.id === id) ?? versions[0] ?? null;
  const listed = $derived(byId(listId));
  const feedback = $derived(byId(feedbackId));
  const decision = $derived(byId(decisionId));
  const feedbackPred = $derived(feedback ? predecessorOf(feedback, versions) : null);
  // The demo listener's comments on V4 that "Fertig" would send, and everyone's feedback on it
  const decisionPass = $derived(decision ? openPass(comments[decision.id] ?? [], reviews[decision.id]?.reviews ?? [], DEMO.userId) : []);
  const decisionRows = $derived(
    decision
      ? feedbackRows(
          comments[decision.id] ?? [],
          reviews[decision.id]?.reviews ?? [],
          isDecided(decision) ? [] : (reviews[decision.id]?.waiting ?? []),
          decision.createdById ?? null,
        )
      : [],
  );

  onMount(() => {
    const mq = matchMedia('(max-width: 759px)');
    small = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      small = e.matches;
      if (!small) heroOpen = false;
    };
    mq.addEventListener('change', onChange);
    mounted = true;
    return () => mq.removeEventListener('change', onChange);
  });

  // While the fullscreen demo is open on a phone, the page behind it stays put
  $effect(() => {
    if (!heroOpen) return;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
    };
  });

  // The sample data follows the language: reload it once the switch has gone through
  $effect(() => {
    locale();
    if (mounted) untrack(load);
  });

  async function load() {
    const res = await demoRequest<{ versions: Version[] }>('GET', `/versions/track/${DEMO.trackId}`);
    const lists = await Promise.all(
      res.versions.map((v) =>
        demoRequest<{ comments: TrackComment[]; reviews: Review[]; waiting: Person[]; uploader: { id: string; name: string } | null }>(
          'GET',
          `/comments/version/${v.id}`,
        ),
      ),
    );
    versions = res.versions;
    comments = Object.fromEntries(res.versions.map((v, i) => [v.id, lists[i].comments]));
    reviews = Object.fromEntries(res.versions.map((v, i) => [v.id, lists[i]]));
  }

  // Same requests as the track page; the demo data answers them in this window
  async function send(method: string, path: string, body?: unknown) {
    try {
      await demoRequest(method, path, body);
    } catch (e) {
      toastError((e as Error).message);
    }
    await load();
  }

  const elsewhere = () => toast(t().landing.demo.elsewhere);
  const card = {
    narrow: false,
    canUpload: false,
    canDownload: true,
    isOwner: false,
    offlineAvailable: false,
    offlineDownloading: false,
    offlineProgress: 0,
    onOpenVersions: elsewhere,
    onUpload: elsewhere,
    onCompare: elsewhere,
    onEdit: elsewhere,
    onDownload: elsewhere,
    onOfflineDownload: elsewhere,
    onOfflineRemove: elsewhere,
    onBranch: elsewhere,
    onPromote: elsewhere,
    onDelete: elsewhere,
    onApprove: elsewhere,
  };

  function audioOf(v: Version) {
    return `/demo/nachtbus-v${v.versionNumber}.mp3`;
  }

  function markersOf(v: Version) {
    return commentMarkers(comments[v.id] ?? []);
  }

  async function submitReview(verdict: ReviewVerdict, note: string) {
    if (!decision) return;
    const { id, versionNumber } = decision;
    await send('POST', `/versions/${id}/reviews`, { verdict, note: note || undefined });
    if (verdict === 'approve') {
      toast(t().landing.demo.approved(versionNumber), 'success', 8000, { label: t().common.undo, run: () => send('POST', `/versions/${id}/unapprove`) });
    } else {
      toast(t().landing.demo.notified(reviews[id]?.uploader?.name ?? 'Kai'), 'success');
    }
  }

  function visible(node: HTMLElement, onVisible: () => void) {
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        io.disconnect();
        onVisible();
      }
    }, { rootMargin: '200px' });
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  // First impression in the hero: jump to 0:47 in the real player and write a comment there.
  // Uses the markup of WaveformPlayer and CommentSection; if that changes, the demo simply stays still.
  async function intro(win: Window & typeof globalThis) {
    if (introDone || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    introDone = true;
    const doc = win.document;
    let stopped = false;
    doc.addEventListener('pointerdown', () => (stopped = true), { once: true });
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    async function find<T>(get: () => T | null | undefined): Promise<T | null> {
      for (let i = 0; i < 150 && !stopped; i++) {
        const found = get();
        if (found) return found;
        await wait(100);
      }
      return null;
    }

    const wave = await find(() => doc.querySelector('.waveform > div')?.shadowRoot?.querySelector<HTMLElement>('[part="wrapper"]'));
    const ready = await find(() => doc.querySelector('.play-btn:not(:disabled)'));
    if (!wave || !ready || stopped) return;
    await wait(1000);
    const box = wave.getBoundingClientRect();
    wave.dispatchEvent(
      new win.MouseEvent('click', {
        bubbles: true,
        clientX: box.left + (box.width * 47) / DEMO.duration,
        clientY: box.top + box.height / 2,
      }),
    );
    const input = await find(() => doc.querySelector<HTMLInputElement>('.composer input'));
    if (!input || stopped) return;
    await wait(900);
    const setValue = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
    for (const ch of t().landing.demo.typedComment) {
      if (stopped || !setValue) return;
      setValue.call(input, input.value + ch);
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
      await wait(35 + Math.random() * 55);
    }
    await wait(500);
    if (!stopped) input.form?.requestSubmit();
  }
</script>

<svelte:head>
  <title>{t().landing.meta.title}</title>
  <meta name="description" content={t().landing.meta.description} />
  <link rel="preload" href="/fonts/bricolage-grotesque-latin.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

{#snippet noPlayer()}{/snippet}

{#snippet feedbackPlayer()}
  {#if feedbackVisible && feedback}
    {#key feedback.id}
      <WaveformPlayer
        bind:this={player}
        url={audioOf(feedback)}
        audioDuration={feedback.duration}
        markers={markersOf(feedback)}
        onTimeClick={(time) => (commentTimestamp = Math.round(time * 10) / 10)}
        onSeek={(time) => (currentTime = time)}
      />
    {/key}
  {:else}
    <div class="wave-placeholder"></div>
  {/if}
{/snippet}

<div class="landing">
  <div class="page">
    <nav class="nav">
      <a href="/" class="wordmark"><Tile size={32} /> Music Hub</a>
      <div class="nav-right">
        {#if signedIn}
          <Button href="/dashboard" size="sm">{t().landing.dashboard}</Button>
        {:else}
          <div class="nav-auth">
            <Button href="/login" size="sm" variant="secondary">{t().common.logIn}</Button>
            <Button href="/register" size="sm">{t().common.signUp}</Button>
          </div>
        {/if}
      </div>
    </nav>

    <header class="hero">
      <h1>{t().common.claim}</h1>
      <div class="hero-side">
        <p class="lede">{t().landing.hero.lede}</p>
        <div class="ctas">
          {#if signedIn}
            <Button href="/dashboard" size="lg">{t().landing.dashboard}</Button>
          {:else}
            <Button href="/register" size="lg">{t().common.signUp}</Button>
          {/if}
          <a class="textlink" href={SELF_HOSTING} target="_blank" rel="noopener">{t().landing.hero.openSource}</a>
        </div>
        <p class="fine">{t().landing.hero.fine}</p>
      </div>
    </header>
  </div>

  <div class="stage">
    {#if mounted && small}
      <div class="phone-demo" class:open={heroOpen}>
        {#if heroOpen}
          <div class="phone-demo-bar">
            <span>{t().landing.demo.phoneBar}</span>
            <button onclick={() => (heroOpen = false)}>{t().common.close}</button>
          </div>
        {/if}
        <div class="phone-demo-frame">
          {#key locale()}
            <DemoFrame src={DEMO.trackPath} title={t().landing.demo.phoneTitle} interactive={heroOpen} onready={intro} />
          {/key}
        </div>
        {#if !heroOpen}
          <button class="phone-demo-open" onclick={() => (heroOpen = true)}>{t().landing.demo.tryIt}</button>
        {/if}
      </div>
    {:else if mounted}
      <div class="window">
        <div class="window-bar" aria-hidden="true">
          <i></i><i></i><i></i>
          <span class="url"><Icon name="lock" size={11} /> hub.pleasance.org</span>
        </div>
        {#key locale()}
          <DemoFrame
            src={DEMO.trackPath}
            title={t().landing.demo.desktopTitle}
            width={1440}
            height={880}
            fit
            onready={intro}
          />
        {/key}
      </div>
    {:else}
      <div class="window placeholder" aria-hidden="true"></div>
    {/if}
    <p class="try">
      <span class="dot"></span>
      <span>
        <b>{t().landing.demo.tryLabel}</b>
        {small ? t().landing.demo.tryPhone : t().landing.demo.tryDesktop}
        {t().landing.demo.tryNote}
      </span>
    </p>
  </div>

  <main class="page">
    <section class="sec">
      <h2>{t().landing.chaos.title}</h2>
      <p class="body">{t().landing.chaos.body}</p>
      <div class="ba">
        <div class="ba-col before">
          <h3>{t().landing.chaos.before}</h3>
          <div class="chaos" aria-hidden="true">
            <div class="file f1"><Icon name="music" size={15} /> {t().landing.chaos.file1}</div>
            <div class="bubble voice"><Icon name="play" size={14} /><i></i><small>0:47</small></div>
            <div class="file f2"><Icon name="music" size={15} /> {t().landing.chaos.file2}</div>
            <div class="bubble text">{t().landing.chaos.question}</div>
            <div class="file f3"><Icon name="music" size={15} /> {t().landing.chaos.file3}</div>
            <div class="file f4"><Icon name="music" size={15} /> <s>{t().landing.chaos.file4}</s></div>
          </div>
        </div>
        <div class="ba-col after">
          <h3>{t().landing.chaos.after}</h3>
          {#if listed}
            <VersionList {versions} selectedId={listed.id} onSelect={(v) => (listId = v.id)} />
            <p class="after-foot"><b>V{listed.versionNumber}</b> {listed.notes}</p>
          {/if}
        </div>
      </div>
    </section>

    <section class="feat">
      <div class="feat-text">
        <h3>{t().landing.feedback.title}</h3>
        <p>{t().landing.feedback.body}</p>
        <p class="hint">{t().landing.feedback.hint}</p>
      </div>
      <div class="frag frag-stack" use:visible={() => (feedbackVisible = true)}>
        {#if feedback}
          <VersionCard {...card} version={feedback} {versions} canApprove={false} onSelect={(v) => (feedbackId = v.id)} player={feedbackPlayer} />
          <CommentSection
            versionLabel={`V${feedback.versionNumber}`}
            versionTitle={versionTitle(feedback)}
            comments={comments[feedback.id] ?? []}
            carryLabel={feedbackPred ? `V${feedbackPred.versionNumber}` : null}
            carryTitle={feedbackPred ? versionTitle(feedbackPred) : null}
            carryComments={feedbackPred ? (comments[feedbackPred.id] ?? []) : []}
            canComment
            currentUserId={DEMO.userId}
            {currentTime}
            bind:commentTimestamp
            onSubmit={(body, timestamp) =>
              send('POST', `/comments/version/${feedback.id}`, { body, timestampSeconds: timestamp ?? undefined })}
            onReply={(parentId, body, onCarry) =>
              send('POST', `/comments/version/${onCarry && feedbackPred ? feedbackPred.id : feedback.id}`, { body, parentId })}
            onResolve={(id) => send('POST', `/comments/${id}/resolve`)}
            onReopen={(id) => send('POST', `/comments/${id}/reopen`)}
            onReact={(id, emoji) => send('POST', `/comments/${id}/reactions`, { emoji })}
            onEdit={(id, body) => send('PATCH', `/comments/${id}`, { body })}
            onDelete={(id) => send('DELETE', `/comments/${id}`)}
            onRestore={(id) => send('POST', `/trash/comment/${id}/restore`)}
            onSeek={(time) => player?.seekToTime(time)}
          />
        {/if}
      </div>
    </section>

    <section class="feat">
      <div class="feat-text">
        <h3>{t().landing.approval.title}</h3>
        <p>{t().landing.approval.body}</p>
        <p class="hint">{t().landing.approval.hint}</p>
      </div>
      <div class="frag frag-stack">
        {#if decision}
          <VersionCard
            {...card}
            version={decision}
            {versions}
            canApprove
            onSelect={(v) => (decisionId = v.id)}
            onApprove={async () => {
              const { id, versionNumber } = decision;
              await send('POST', `/versions/${id}/approve`);
              toast(t().landing.demo.approved(versionNumber), 'success', 8000, {
                label: t().common.undo,
                run: () => send('POST', `/versions/${id}/unapprove`),
              });
            }}
            finishCount={decisionPass.length}
            onFinish={() => (reviewOpen = true)}
            player={noPlayer}
            feedback={decisionFeedback}
          />
          <div class="frag-panel">
            <VersionList {versions} selectedId={decision.id} onSelect={(v) => (decisionId = v.id)} />
          </div>
        {/if}
      </div>
    </section>

    <section class="sec">
      <h2>{t().landing.audience.title}</h2>
      <div class="sides">
        <div class="side">
          <h3>{t().landing.audience.producers}</h3>
          <ul>
            {#each t().landing.audience.producersItems as item}
              <li><Icon name="check" size={18} /> {item}</li>
            {/each}
          </ul>
        </div>
        <div class="phone">
          <img
            src="/demo/nachtbus-handy.png"
            alt={t().landing.audience.phoneAlt}
            width="390"
            height="844"
            loading="lazy"
          />
        </div>
        <div class="side">
          <h3>{t().landing.audience.band}</h3>
          <ul>
            {#each t().landing.audience.bandItems as item}
              <li><Icon name="check" size={18} /> {item}</li>
            {/each}
          </ul>
        </div>
      </div>
    </section>

    <section class="final">
      <h2>{t().landing.final.title}</h2>
      <p>{t().landing.final.body}</p>
      {#if signedIn}
        <Button href="/dashboard" size="lg">{t().landing.dashboard}</Button>
      {:else}
        <Button href="/register" size="lg">{t().common.signUp}</Button>
      {/if}
      <p class="fine">{t().landing.final.fine}</p>
    </section>

    <p class="oss">
      <span>{t().landing.oss.text}</span>
      <a class="textlink" href={SELF_HOSTING} target="_blank" rel="noopener">{t().landing.oss.link}</a>
    </p>

    <SiteFooter />
  </main>
</div>

{#snippet decisionFeedback()}
  {#if decision && decisionRows.length > 0}
    <FeedbackList rows={decisionRows} versionNumber={decision.versionNumber} currentUserId={DEMO.userId} />
  {/if}
{/snippet}

{#if decision}
  <ReviewSheet
    bind:open={reviewOpen}
    versionNumber={decision.versionNumber}
    uploaderName={reviews[decision.id]?.uploader?.name ?? 'Kai'}
    canApprove
    pass={decisionPass}
    onSubmit={submitReview}
  />
{/if}

<style>
  /* The glow behind the demo is wider than phones */
  .landing {
    overflow-x: clip;
  }

  .page {
    max-width: 1280px;
    margin: 0 auto;
    padding: 0 var(--space-10);
  }

  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 22px 0;
  }
  .wordmark {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    color: var(--color-text-primary);
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 800;
    font-stretch: 76%;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .wordmark:hover {
    color: var(--color-text-primary);
  }
  .nav-right {
    display: flex;
    align-items: center;
    gap: var(--space-5);
  }
  .nav-auth {
    display: flex;
    gap: var(--space-2);
  }

  h1,
  h2,
  .feat-text h3,
  .side h3 {
    font-family: var(--font-display);
    font-stretch: 78%;
    text-wrap: balance;
  }

  /* Hero */
  .hero {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    gap: 56px;
    align-items: end;
    padding: 40px 0 0;
  }
  .hero h1 {
    margin: 0;
    font-size: clamp(52px, 7vw, 100px);
    font-weight: 800;
    font-stretch: 75%;
    letter-spacing: -0.03em;
    line-height: 0.9;
  }
  .lede {
    margin: 0;
    max-width: 36ch;
    font-size: 19px;
    line-height: 1.55;
    color: #b5b3bb;
  }
  .ctas {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-6);
    margin-top: 26px;
  }
  .textlink {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    border-bottom: 1px solid var(--color-border-hover);
  }
  .textlink:hover {
    color: var(--color-text-primary);
  }
  .fine {
    margin: 14px 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  .stage {
    position: relative;
    max-width: 1400px;
    margin: 56px auto 0;
    padding: 0 var(--space-10);
  }
  .window {
    max-width: 1320px;
    margin: 0 auto;
    border-radius: 14px;
    overflow: hidden;
    background: var(--color-bg-base);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.07), 0 40px 120px rgba(0, 0, 0, 0.7);
  }
  .window.placeholder {
    aspect-ratio: 1440 / 918;
  }
  .window-bar {
    height: 38px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background: #0f0d10;
    border-bottom: 1px solid #211f25;
  }
  .window-bar i {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #2d2a31;
  }
  .url {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    margin: 0 auto;
    padding: 0 14px;
    border-radius: 7px;
    background: #19171c;
    color: #7d7a83;
    font-size: 12.5px;
  }
  .try {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 1280px;
    margin: 22px auto 0;
    font-size: 14.5px;
    color: var(--color-text-tertiary);
  }
  .try b {
    color: var(--color-text-secondary);
    font-weight: 500;
  }
  .try .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent);
    box-shadow: 0 0 0 4px var(--color-accent-subtle);
  }

  /* Phone hero: preview, opens fullscreen */
  .phone-demo {
    position: relative;
    height: 600px;
    border-radius: 26px;
    overflow: hidden;
    border: 1px solid #26232a;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
  }
  .phone-demo-frame {
    height: 100%;
  }
  .phone-demo-open {
    position: absolute;
    left: 50%;
    bottom: 22px;
    transform: translateX(-50%);
    height: 44px;
    padding: 0 22px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--gradient-accent);
    color: var(--color-on-accent);
    font-family: inherit;
    font-size: var(--text-base);
    font-weight: 600;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }
  .phone-demo.open {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    height: 100dvh;
    border: none;
    border-radius: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-base);
  }
  .phone-demo.open .phone-demo-frame {
    flex: 1;
    min-height: 0;
  }
  .phone-demo-bar {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 var(--space-4);
    border-bottom: 1px solid var(--color-border);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .phone-demo-bar button {
    border: none;
    background: none;
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
  }

  /* Sections */
  .sec {
    padding: 140px 0 0;
  }
  .sec h2 {
    margin: 0;
    font-size: clamp(40px, 4.6vw, 64px);
    font-weight: 800;
    font-stretch: 75%;
    letter-spacing: -0.03em;
    line-height: 0.95;
  }
  .body {
    margin: 18px 0 0;
    max-width: 44ch;
    font-size: 18px;
    line-height: 1.6;
  }

  /* Before / after */
  .ba {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
    margin-top: 56px;
  }
  .ba-col {
    position: relative;
    min-width: 0;
    border-radius: 22px;
    padding: 26px;
  }
  .ba-col h3 {
    margin: 0 0 18px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0;
    color: var(--color-text-tertiary);
  }
  .before {
    overflow: hidden;
    background: repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.012) 0 12px, transparent 12px 24px), #0f0d10;
    border: 1px solid #1f1d22;
  }
  .after {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
  }
  .chaos {
    position: relative;
    height: 290px;
  }
  .chaos > * {
    position: absolute;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 10px;
    background: #19171c;
    border: 1px solid #26232a;
    font-size: 14px;
    color: #cac8cf;
    white-space: nowrap;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
  }
  .file :global(svg) {
    color: var(--color-text-tertiary);
  }
  .file s {
    color: var(--color-text-tertiary);
  }
  .f1 { left: 0; top: 0; transform: rotate(-2deg); }
  .f2 { left: 8%; top: 96px; transform: rotate(1.2deg); }
  .f3 { left: 2%; top: 196px; transform: rotate(-1.4deg); }
  .f4 { left: 22%; top: 248px; transform: rotate(2deg); }
  .bubble {
    max-width: 270px;
    padding: 10px 14px;
    border-radius: 16px 16px 16px 4px;
    background: #1f3b2a;
    color: #d8f5e1;
    font-size: 14px;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
  }
  .bubble.voice {
    right: 4%;
    top: 28px;
    width: 250px;
    display: flex;
    align-items: center;
    gap: 10px;
    transform: rotate(1.5deg);
  }
  .bubble.voice i {
    flex: 1;
    height: 18px;
    background: repeating-linear-gradient(90deg, rgba(216, 245, 225, 0.7) 0 2px, transparent 2px 5px);
    mask: linear-gradient(90deg, #000 0 40%, rgba(0, 0, 0, 0.4) 40%);
  }
  .bubble.voice small {
    color: rgba(216, 245, 225, 0.6);
    font-size: 12px;
  }
  .bubble.text {
    right: 2%;
    top: 150px;
    transform: rotate(-1deg);
  }
  .after-foot {
    display: flex;
    gap: 10px;
    margin: 18px 0 0;
    padding-top: 16px;
    border-top: 1px solid var(--color-border);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* Features: text left, a live piece of the track page right */
  .feat {
    display: grid;
    grid-template-columns: minmax(0, 4fr) minmax(0, 7fr);
    gap: 64px;
    align-items: start;
    padding: 120px 0 0;
  }
  .feat-text {
    position: sticky;
    top: 96px;
    padding-top: 12px;
  }
  .feat-text h3 {
    margin: 0;
    font-size: clamp(30px, 3vw, 44px);
    font-weight: 780;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .feat-text p {
    margin: 14px 0 0;
    font-size: 17.5px;
    line-height: 1.6;
  }
  .feat-text .hint {
    margin-top: 16px;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
  .frag {
    position: relative;
    min-width: 0;
    padding: 26px;
    border-radius: 22px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0)), #0d0b0e;
    border: 1px solid #211f25;
  }
  .frag-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .frag-panel {
    min-width: 0;
    padding: 14px 10px 8px;
    border-radius: 16px;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
  }
  .wave-placeholder {
    height: 96px;
  }

  /* Two sides */
  .sides {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 56px;
    align-items: center;
    margin-top: 64px;
  }
  .side h3 {
    margin: 0;
    font-size: 28px;
    font-weight: 780;
    letter-spacing: -0.02em;
  }
  .side ul {
    list-style: none;
    margin: 16px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .side li {
    display: flex;
    gap: 12px;
    font-size: 16.5px;
    line-height: 1.5;
  }
  .side li :global(svg) {
    flex: none;
    margin-top: 3px;
    color: var(--color-accent-2);
  }
  .phone {
    width: 356px;
    border: 10px solid #201e24;
    border-radius: 48px;
    overflow: hidden;
    background: var(--color-bg-base);
    box-shadow: 0 40px 100px rgba(0, 0, 0, 0.65), 0 0 0 1px #2d2a31;
  }
  .phone img {
    display: block;
    width: 100%;
    height: auto;
  }

  /* Closing band */
  .final {
    margin-top: 140px;
    padding: 72px var(--space-8);
    border-radius: 28px;
    text-align: center;
    background:
      radial-gradient(120% 140% at 0% 100%, color-mix(in srgb, var(--color-accent) 20%, transparent), transparent 55%),
      radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, var(--color-accent-2) 20%, transparent), transparent 55%),
      var(--color-bg-raised);
    border: 1px solid var(--color-border);
  }
  .final h2 {
    margin: 0;
    font-size: clamp(40px, 4.6vw, 64px);
    font-weight: 800;
    font-stretch: 75%;
    letter-spacing: -0.03em;
    line-height: 0.95;
  }
  .final > p:not(.fine) {
    margin: 18px auto 28px;
    max-width: 44ch;
    font-size: 18px;
    line-height: 1.6;
    color: var(--color-text-secondary);
  }
  /* The accent glow behind it is too bright for the tertiary text */
  .final > .fine {
    color: var(--color-text-secondary);
  }

  /* Open source, one quiet line */
  .oss {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3) var(--space-6);
    margin: 56px 0 72px;
    font-size: 15px;
    color: var(--color-text-secondary);
  }

  @media (max-width: 1100px) {
    .hero,
    .feat {
      grid-template-columns: minmax(0, 1fr);
      gap: 28px;
    }
    .feat {
      padding-top: 88px;
    }
    .feat-text {
      position: static;
    }
    .sides {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 32px;
    }
    .phone {
      grid-column: 1 / -1;
      order: 3;
      justify-self: center;
      width: 320px;
    }
  }

  @media (max-width: 759px) {
    .page,
    .stage {
      padding: 0 var(--space-5);
    }
    .nav {
      padding: 16px 0;
    }
    .hero {
      padding-top: 16px;
    }
    .hero h1 {
      font-size: 46px;
    }
    .lede {
      font-size: 17px;
    }
    .ctas :global(.btn) {
      flex: 1 1 100%;
    }
    .stage {
      margin-top: 36px;
    }
    .window.placeholder {
      aspect-ratio: auto;
      height: 600px;
      border-radius: 26px;
    }
    .try {
      font-size: 13.5px;
    }
    .sec {
      padding-top: 96px;
    }
    .body {
      font-size: 16.5px;
    }
    .ba,
    .sides {
      grid-template-columns: minmax(0, 1fr);
    }
    .ba {
      gap: 16px;
      margin-top: 32px;
    }
    .ba-col {
      padding: 20px;
    }
    .bubble.voice {
      top: 52px;
      right: 0;
    }
    .f2 {
      top: 112px;
    }
    .frag {
      margin: 0 -6px;
      padding: 14px;
      border-radius: 18px;
    }
    .sides {
      gap: 36px;
      margin-top: 40px;
    }
    .phone {
      display: none;
    }
    .final {
      margin-top: 96px;
      padding: 48px var(--space-5);
      border-radius: 22px;
    }
    .final > p:not(.fine) {
      font-size: 16.5px;
    }
    .oss {
      margin-bottom: 56px;
    }
  }
</style>
