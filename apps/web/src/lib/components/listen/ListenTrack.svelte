<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import WaveformPlayer from '$lib/components/audio/WaveformPlayer.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { t } from '$lib/i18n/index.js';
  import { formatTime } from '$lib/utils/format.js';
  import { commentMarkers, openPass, type ReviewVerdict } from '$lib/utils/track.js';
  import ReviewSheet from '$lib/components/review/ReviewSheet.svelte';
  import { toastError } from '$lib/stores/toast.js';

  type Comment = {
    id: string;
    body: string;
    timestampSeconds: number | null;
    parentId: string | null;
    resolvedAt: string | null;
    createdAt: string;
    guestName: string | null;
    user: { id: string; name: string; avatarUrl: string | null } | null;
  };

  type ShareData = {
    project: { name: string };
    track: { id: string; name: string };
    version: {
      id: string;
      versionNumber: number;
      label: string | null;
      notes: string | null;
      duration: number | null;
      status: string;
      originalFileName: string;
    };
    /** null only behind a delivery while the MP3 preview is not there yet (processing) */
    streamUrl: string | null;
    processing?: boolean;
    waveformUrl: string | null;
    downloadUrl: string | null;
    allowComments: boolean;
    comments: Comment[];
    /** Guest reviews of the version, to tell which of your comments the next "Done" sends */
    reviews: { guestName: string | null; createdAt: string }[];
    uploaderName: string | null;
  };

  // One shared track: on its own page, or one track of a project link, which shows project and
  // track name itself and moves on to the next track when this one ends
  let {
    token,
    password: givenPassword = '',
    inAlbum = false,
    autoPlay = false,
    previous,
    next,
    onLoad,
    paywall = false,
    commenting = true,
    actions,
  }: {
    token: string;
    /** The password the project link was opened with; its track links share it */
    password?: string;
    inAlbum?: boolean;
    autoPlay?: boolean;
    previous?: (() => void) | undefined;
    next?: (() => void) | undefined;
    onLoad?: (data: { project: { name: string }; track: { name: string } }) => void;
    /** Part of a delivery: the client decides per song through `actions`, not with "Finish review" */
    paywall?: boolean;
    /** Whether the comment form shows; the comments themselves always do */
    commenting?: boolean;
    /** Under the player, with the version heard and the name the guest comments with */
    actions?: Snippet<[{ versionId: string; guestName: string }]> | undefined;
  } = $props();

  let data = $state<ShareData | null>(null);
  let peaks = $state<number[]>([]);
  let loading = $state(true);
  let error = $state('');
  let commentError = $state('');
  let passwordRequired = $state(false);
  // A guest may still type another one into the password gate
  // svelte-ignore state_referenced_locally
  let password = $state(givenPassword);

  let guestName = $state('');
  let body = $state('');
  let commentTimestamp = $state<number | null>(null);
  let submitting = $state(false);
  let playerRef = $state<WaveformPlayer>();
  let reviewOpen = $state(false);
  // The name the last "Done" went out under; a new name starts over
  let reviewSentAs = $state<string | null>(null);
  // Your comments since your last "Done", recognised by the name you comment with
  const guestPass = $derived(data && guestName.trim() ? openPass(data.comments, data.reviews ?? [], `guest:${guestName.trim()}`) : []);
  const reviewDone = $derived(reviewSentAs === guestName.trim() && guestPass.length === 0);

  // Analytics tracking
  let eventId = $state<string | null>(null);
  let listenSeconds = $state(0);
  let playStartedAt = $state<number | null>(null);
  let firstPlayFired = $state(false);
  let progressInterval = $state<ReturnType<typeof setInterval> | null>(null);

  // Name prompt
  let showNamePrompt = $state(false);
  let nameInput = $state('');
  let nameDismissed = $state(false);

  async function load() {
    loading = !data;
    error = '';
    try {
      const res = await fetch(`/api/v1/share/public/${token}`, {
        headers: password ? { 'X-Share-Password': password } : {},
      });
      if (res.status === 401) {
        const j = await res.json();
        if (j.passwordRequired) {
          passwordRequired = true;
          error = password ? t().guest.listenTrack.wrongPassword : '';
          return;
        }
      }
      if (!res.ok) {
        error = res.status === 404 ? t().guest.listenTrack.notFound
          : res.status === 410 ? t().guest.listenTrack.unavailable
          : res.status === 429 ? t().guest.listenTrack.tooManyAttempts
          : t().guest.listenTrack.loadFailed;
        loading = false;
        return;
      }
      const share: ShareData = await res.json();
      // Fetched before the player renders, which needs the peaks when it starts
      peaks = share.waveformUrl
        ? await fetch(share.waveformUrl).then((r) => (r.ok ? r.json() : [])).catch(() => [])
        : [];
      data = share;
      onLoad?.(share);
      passwordRequired = false;
      if (!eventId) await createListenEvent();
    } catch {
      error = t().guest.listenTrack.offline;
    } finally {
      loading = false;
    }
  }

  async function createListenEvent() {
    try {
      const res = await fetch(`/api/v1/share/public/${token}/listen`, { method: 'POST' });
      if (res.ok) {
        const j = await res.json();
        eventId = j.eventId;
      }
    } catch { /* fire and forget */ }
  }

  async function patchEvent(patch: Record<string, unknown>) {
    if (!eventId) return;
    try {
      await fetch(`/api/v1/share/public/${token}/listen/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch { /* fire and forget */ }
  }

  function onPlay() {
    playStartedAt = Date.now();
    if (!firstPlayFired) {
      firstPlayFired = true;
      patchEvent({ firstPlay: true });
      // Show name prompt after first play, if name not yet set
      const saved = localStorage.getItem('listenName');
      if (saved) {
        guestName = saved;
        patchEvent({ listenerName: saved });
      } else if (!nameDismissed) {
        showNamePrompt = true;
      }
    }
    progressInterval = setInterval(() => {
      if (playStartedAt !== null) {
        listenSeconds += 1;
        if (listenSeconds % 30 === 0) patchEvent({ listenSeconds });
      }
    }, 1000);
  }

  function onPause() {
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    patchEvent({ listenSeconds });
  }

  function onFinish() {
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    const duration = data?.version.duration ?? 0;
    const pct = duration > 0 ? listenSeconds / duration : 0;
    patchEvent({ listenSeconds, completed: pct >= 0.8 });
    // A comment being written keeps its song
    if (inAlbum && !body.trim()) next?.();
  }

  export function play() {
    playerRef?.play();
  }

  export function reload() {
    return load();
  }

  function submitName() {
    const name = nameInput.trim();
    if (name) {
      guestName = name;
      localStorage.setItem('listenName', name);
      patchEvent({ listenerName: name });
    }
    showNamePrompt = false;
    nameDismissed = true;
  }

  function dismissName() {
    showNamePrompt = false;
    nameDismissed = true;
    // The next track of a project asks no more
    sessionStorage.setItem('listenNameDismissed', '1');
  }

  onMount(() => {
    load();

    const saved = localStorage.getItem('listenName');
    if (saved) guestName = saved;
    nameDismissed = sessionStorage.getItem('listenNameDismissed') === '1';

    const handleUnload = () => {
      if (!eventId) return;
      navigator.sendBeacon(
        `/api/v1/share/public/${token}/listen/${eventId}`,
        new Blob([JSON.stringify({ listenSeconds })], { type: 'application/json' }),
      );
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  });

  async function submitReview(verdict: ReviewVerdict, note: string) {
    try {
      const res = await fetch(`/api/v1/share/public/${token}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(password ? { 'X-Share-Password': password } : {}),
        },
        body: JSON.stringify({ verdict, note: note || undefined, guestName: guestName.trim(), versionId: data?.version.id }),
      });
      if (!res.ok) {
        const message =
          res.status === 429 ? t().guest.listenTrack.tooManyReviews
          : res.status === 409 ? t().guest.listenTrack.newerVersion
          : t().guest.listenTrack.reviewFailed;
        toastError(message);
        throw new Error(message);
      }
    } catch (err) {
      if (err instanceof TypeError) toastError(t().guest.listenTrack.offlineRetry);
      throw err;
    }
    reviewSentAs = guestName.trim();
    await load();
  }

  async function submitComment(e: Event) {
    e.preventDefault();
    if (!body.trim() || !guestName.trim() || !data) return;
    submitting = true;
    commentError = '';
    try {
      const res = await fetch(`/api/v1/share/public/${token}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(password ? { 'X-Share-Password': password } : {}),
        },
        body: JSON.stringify({ body, guestName, timestampSeconds: commentTimestamp ?? undefined, versionId: data.version.id }),
      });
      // 409: the link follows the track and shows a newer version by now
      if (!res.ok) {
        commentError = res.status === 409 ? t().guest.listenTrack.newerVersion
          : res.status === 429 ? t().guest.listenTrack.tooManyComments
          : t().guest.listenTrack.commentFailed;
        return;
      }
      body = '';
      commentTimestamp = null;
      // The next track or link knows the name
      localStorage.setItem('listenName', guestName.trim());
      await load();
    } catch {
      commentError = t().guest.listenTrack.offlineComment;
    } finally {
      submitting = false;
    }
  }
</script>

<div class="listen-track">
    {#if loading && !passwordRequired}
      <p class="muted">{t().guest.listenTrack.loading}</p>
    {:else if passwordRequired}
      <form class="password-gate" onsubmit={(e) => { e.preventDefault(); load(); }}>
        <h1>{t().guest.listenTrack.protectedLink}</h1>
        <p>{t().guest.listenTrack.enterPassword}</p>
        <input type="password" bind:value={password} placeholder={t().common.password} aria-label={t().common.password} autocomplete="current-password" required />
        <Button type="submit" {loading}>{t().common.open}</Button>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </form>
    {:else if error && !data}
      <p class="error" role="alert">{error}</p>
      <Button onclick={load}>{t().common.retry}</Button>
    {:else if data}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if inAlbum}
        <header class="in-album">
          <h2>{data.track.name}</h2>
          <p class="version-label">V{data.version.versionNumber}{data.version.label ? ` · ${data.version.label}` : ''}</p>
        </header>
      {:else}
        <header>
          <p class="project">{data.project.name}</p>
          <h1>{data.track.name}</h1>
          {#if data.version.label}<p class="version-label">{data.version.label}</p>{/if}
        </header>
      {/if}

      <!-- In a project the player stays in view while the guest reads and writes comments -->
      <div class:sticky={inAlbum}>
        {#if data.streamUrl}
          <WaveformPlayer
            bind:this={playerRef}
            url={data.streamUrl}
            {peaks}
            {autoPlay}
            audioDuration={data.version.duration}
            markers={commentMarkers(data.comments)}
            session={{ title: data.track.name, artist: data.project.name, previous, next }}
            onTimeClick={(time) => (commentTimestamp = Math.round(time * 10) / 10)}
            onPlay={onPlay}
            onPause={onPause}
            onFinish={onFinish}
          />
        {:else}
          <p class="preparing" role="status">{t().guest.listenTrack.preparing}</p>
        {/if}
      </div>

      {#if showNamePrompt}
        <div class="name-prompt">
          <p>{t().guest.listenTrack.namePrompt}</p>
          <div class="name-prompt-row">
            <input
              type="text"
              bind:value={nameInput}
              maxlength={100}
              placeholder={t().guest.listenTrack.yourName}
              onkeydown={(e) => e.key === 'Enter' && submitName()}
              autofocus
            />
            <Button size="sm" onclick={submitName} disabled={!nameInput.trim()}>{t().guest.listenTrack.ok}</Button>
            <button class="skip-btn" onclick={dismissName}>{t().guest.listenTrack.skip}</button>
          </div>
        </div>
      {/if}

      {#if actions}
        {@render actions({ versionId: data.version.id, guestName: guestName.trim() })}
      {/if}

      {#if data.downloadUrl}
        <div class="actions">
          <a href={data.downloadUrl} target="_blank" rel="noopener">
            <Button variant="ghost" size="sm">{t().guest.listenTrack.downloadOriginal}</Button>
          </a>
        </div>
      {/if}

      {#if data.allowComments && commenting}
        <form class="comment-form" onsubmit={submitComment}>
          <h2>{t().guest.listenTrack.leaveFeedback}</h2>
          <p class="hint">{t().guest.listenTrack.feedbackHint}</p>
          <input type="text" bind:value={guestName} maxlength={100} placeholder={t().guest.listenTrack.yourName} required />
          {#if commentTimestamp !== null}
            <span class="ts-badge">
              {t().guest.listenTrack.atTime(formatTime(commentTimestamp))}
              <button type="button" onclick={() => (commentTimestamp = null)}>×</button>
            </span>
          {/if}
          <textarea
            bind:value={body}
            maxlength={5000}
            placeholder={t().guest.listenTrack.commentPlaceholder}
            rows="3"
            required
          ></textarea>
          {#if commentError}<p class="error" role="alert">{commentError}</p>{/if}
          <Button type="submit" loading={submitting} disabled={!body.trim() || !guestName.trim()}>
            {t().guest.listenTrack.saveComment}
          </Button>
        </form>

        {#if guestName.trim() && !paywall}
          <div class="finish">
            <p role="status">
              {#if reviewDone}
                {t().guest.listenTrack.thanks(guestName.trim())}
              {:else if guestPass.length > 0}
                {guestPass.length === 1 ? t().guest.listenTrack.savedOne : t().guest.listenTrack.savedMany(guestPass.length)}
                {t().guest.listenTrack.finishHint(data.uploaderName ?? t().guest.listenTrack.uploaderFallback)}
              {:else}
                {t().guest.listenTrack.listenedThrough}
              {/if}
            </p>
            {#if !reviewDone}
              <Button variant={guestPass.length > 0 ? 'primary' : 'secondary'} onclick={() => (reviewOpen = true)}>{t().guest.listenTrack.finishReview}</Button>
            {/if}
          </div>
          <ReviewSheet
            bind:open={reviewOpen}
            title={t().guest.listenTrack.finishReview}
            versionNumber={data.version.versionNumber}
            uploaderName={data.uploaderName ?? t().guest.listenTrack.uploaderSubject}
            guest
            pass={guestPass}
            onSubmit={submitReview}
          />
        {/if}
      {/if}

      {#snippet commentContent(c: Comment)}
        <div class="comment-head">
          <strong>{c.user?.name ?? c.guestName ?? t().common.guest}</strong>
          {#if !c.user}<span class="guest">{t().common.guest}</span>{/if}
          {#if c.timestampSeconds !== null}
            <button class="ts" onclick={() => playerRef?.seekToTime(c.timestampSeconds!)}>
              {formatTime(c.timestampSeconds)}
            </button>
          {/if}
        </div>
        <p>{c.body}</p>
      {/snippet}

      <section class="comments">
        <h2>{t().guest.listenTrack.commentsHeading(data.comments.length)}</h2>
        {#each data.comments.filter((c) => !c.parentId || !data?.comments.some((parent) => parent.id === c.parentId)) as c}
          <div class="comment">
            {@render commentContent(c)}
            {#each data.comments.filter((reply) => reply.parentId === c.id) as reply}
              <div class="reply">
                {@render commentContent(reply)}
              </div>
            {/each}
          </div>
        {/each}
        {#if data.comments.length === 0}
          <p class="muted">{t().guest.listenTrack.noComments}</p>
        {/if}
      </section>

      {#if !inAlbum}
        <footer>
          <p class="muted">{t().guest.listenTrack.sharedVia}</p>
        </footer>
      {/if}
    {/if}
</div>

<style>
  .listen-track {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  header { text-align: center; }
  header.in-album { text-align: left; }
  /* On a phone the player would take too much of the screen next to the keyboard */
  @media (min-width: 641px) {
    .sticky {
      position: sticky;
      top: 0;
      z-index: 2;
      padding: var(--space-2) 0;
      background: var(--color-bg-base);
    }
  }
  .in-album h2 {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 800;
    font-stretch: 75%;
    line-height: 1;
  }
  .project { color: var(--color-text-tertiary); font-size: var(--text-sm); margin: 0; }
  h1 { margin: var(--space-1) 0; font-size: 2rem; }
  header h1 {
    font-size: clamp(3rem, 12vw, 4.75rem);
    font-weight: 800;
    font-stretch: 75%;
    line-height: 0.9;
  }
  .version-label { color: var(--color-text-secondary); font-size: var(--text-sm); margin: 0; }
  .muted { color: var(--color-text-tertiary); font-size: var(--text-sm); }
  .preparing {
    margin: 0;
    padding: var(--space-6) var(--space-4);
    text-align: center;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    background: var(--color-bg-raised);
    border: 1px dashed var(--color-border-hover);
    border-radius: var(--radius-md);
  }
  .error { color: var(--color-error, var(--color-error)); }

  .name-prompt {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .name-prompt p { margin: 0; font-size: var(--text-sm); color: var(--color-text-secondary); }
  .name-prompt-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .name-prompt-row input {
    flex: 1 1 10rem;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
  }
  .skip-btn {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
  }
  .skip-btn:hover { color: var(--color-text-secondary); }

  .password-gate {
    text-align: center;
    padding: var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: center;
  }
  .password-gate input,
  .comment-form input,
  .comment-form textarea {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    width: 100%;
  }
  .actions { display: flex; justify-content: flex-end; }
  .comment-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .comment-form h2 { margin: 0 0 var(--space-2); font-size: 1.5rem; }
  .ts-badge {
    align-self: flex-start;
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    color: var(--color-accent);
    border-radius: var(--radius-sm);
    padding: 0.15rem var(--space-2);
    font-size: var(--text-xs);
  }
  .ts-badge button { background: none; border: none; color: inherit; cursor: pointer; margin-left: var(--space-1); }
  .comments { display: flex; flex-direction: column; gap: var(--space-2); }
  .comments h2 { font-size: 1.5rem; margin: 0 0 var(--space-2); }
  .comment {
    padding: var(--space-3);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  .comment-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    margin-bottom: var(--space-1);
  }
  .guest {
    font-size: var(--text-xs);
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    color: var(--color-text-tertiary);
    padding: 0 0.3rem;
    border-radius: var(--radius-sm);
  }
  .ts {
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    color: var(--color-accent);
    border-radius: var(--radius-sm);
    padding: 0.05rem 0.4rem;
    font-size: var(--text-xs);
    cursor: pointer;
    font-family: inherit;
  }
  .comment p { margin: 0; font-size: var(--text-sm); }
  .reply {
    margin-top: var(--space-3);
    padding-left: var(--space-3);
    border-left: 2px solid var(--color-border-hover);
  }
  footer {
    text-align: center;
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  /* A guest's "Fertig": their comments and verdict reach the uploader in one message */
  .finish {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    justify-content: space-between;
    margin-top: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-raised);
  }

  .hint {
    margin: calc(-1 * var(--space-1)) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .finish p {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
</style>
