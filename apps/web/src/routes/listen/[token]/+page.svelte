<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import WaveformPlayer from '$lib/components/audio/WaveformPlayer.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import PleasanceFooter from '$lib/components/PleasanceFooter.svelte';
  import Tile from '$lib/components/ui/Tile.svelte';
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
    streamUrl: string;
    waveformUrl: string | null;
    downloadUrl: string | null;
    allowComments: boolean;
    comments: Comment[];
    /** Guest reviews of the version, to tell which of your comments the next "Fertig" sends */
    reviews: { guestName: string | null; createdAt: string }[];
    uploaderName: string | null;
  };

  const token = ($page.params as Record<string, string>).token;
  let data = $state<ShareData | null>(null);
  let peaks = $state<number[]>([]);
  let loading = $state(true);
  let error = $state('');
  let commentError = $state('');
  let passwordRequired = $state(false);
  let password = $state('');

  let guestName = $state('');
  let body = $state('');
  let commentTimestamp = $state<number | null>(null);
  let submitting = $state(false);
  let playerRef = $state<WaveformPlayer>();
  let reviewOpen = $state(false);
  // The name the last "Fertig" went out under; a new name starts over
  let reviewSentAs = $state<string | null>(null);
  // Your comments since your last "Fertig", recognised by the name you comment with
  const guestPass = $derived(data && guestName.trim() ? openPass(data.comments, data.reviews ?? [], `guest:${guestName.trim()}`) : []);

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
          error = password ? 'Das Passwort ist nicht richtig. Bitte versuche es erneut.' : '';
          return;
        }
      }
      if (!res.ok) {
        error = res.status === 404 ? 'Dieser Link wurde nicht gefunden.'
          : res.status === 410 ? 'Dieser Link ist gerade nicht verfügbar.'
          : res.status === 429 ? 'Zu viele Versuche. Bitte warte etwas und versuche es erneut.'
          : 'Der Link konnte nicht geladen werden. Bitte versuche es erneut.';
        loading = false;
        return;
      }
      const share: ShareData = await res.json();
      // Fetched before the player renders, which needs the peaks when it starts
      peaks = share.waveformUrl
        ? await fetch(share.waveformUrl).then((r) => (r.ok ? r.json() : [])).catch(() => [])
        : [];
      data = share;
      passwordRequired = false;
      if (!eventId) await createListenEvent();
    } catch {
      error = 'Keine Verbindung. Bitte prüfe dein Internet und versuche es erneut.';
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
  }

  onMount(() => {
    load();

    const saved = localStorage.getItem('listenName');
    if (saved) guestName = saved;

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
          res.status === 429 ? 'Zu viele Rückmeldungen, bitte später noch einmal.'
          : res.status === 409 ? 'Inzwischen gibt es eine neuere Version. Lade die Seite neu, um sie zu hören.'
          : 'Rückmeldung fehlgeschlagen';
        toastError(message);
        throw new Error(message);
      }
    } catch (err) {
      if (err instanceof TypeError) toastError('Keine Verbindung. Bitte versuche es erneut.');
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
        commentError = res.status === 409 ? 'Inzwischen gibt es eine neuere Version. Lade die Seite neu, um sie zu hören.'
          : res.status === 429 ? 'Zu viele Kommentare. Bitte warte etwas und versuche es erneut.'
          : 'Kommentar nicht gesendet. Bitte versuche es erneut.';
        return;
      }
      body = '';
      commentTimestamp = null;
      await load();
    } catch {
      commentError = 'Keine Verbindung. Dein Kommentar bleibt hier, bitte versuche es erneut.';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>{data ? `${data.track.name} — ${data.project.name}` : 'Music Hub'}</title>
</svelte:head>

<div class="shell">
  <div class="listen-page">
    <a class="sender" href="/"><Tile size={26} /> Music Hub</a>
    {#if loading && !passwordRequired}
      <p class="muted">Lädt…</p>
    {:else if passwordRequired}
      <form class="password-gate" onsubmit={(e) => { e.preventDefault(); load(); }}>
        <h1>🔒 Geschützter Link</h1>
        <p>Bitte Passwort eingeben:</p>
        <input type="password" bind:value={password} placeholder="Passwort" aria-label="Passwort" autocomplete="current-password" required />
        <Button type="submit" {loading}>Öffnen</Button>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </form>
    {:else if error && !data}
      <p class="error" role="alert">{error}</p>
      <Button onclick={load}>Erneut versuchen</Button>
    {:else if data}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <header>
        <p class="project">{data.project.name}</p>
        <h1>{data.track.name}</h1>
        {#if data.version.label}<p class="version-label">{data.version.label}</p>{/if}
      </header>

      <WaveformPlayer
        bind:this={playerRef}
        url={data.streamUrl}
        {peaks}
        audioDuration={data.version.duration}
        markers={commentMarkers(data.comments)}
        session={{ title: data.track.name, artist: data.project.name }}
        onTimeClick={(t) => (commentTimestamp = Math.round(t * 10) / 10)}
        onPlay={onPlay}
        onPause={onPause}
        onFinish={onFinish}
      />

      {#if showNamePrompt}
        <div class="name-prompt">
          <p>Wie heißt du? So wissen die Künstler, wer zugehört hat.</p>
          <div class="name-prompt-row">
            <input
              type="text"
              bind:value={nameInput}
              placeholder="Dein Name"
              onkeydown={(e) => e.key === 'Enter' && submitName()}
              autofocus
            />
            <Button size="sm" onclick={submitName} disabled={!nameInput.trim()}>OK</Button>
            <button class="skip-btn" onclick={dismissName}>Überspringen</button>
          </div>
        </div>
      {/if}

      {#if data.downloadUrl}
        <div class="actions">
          <a href={data.downloadUrl} target="_blank" rel="noopener">
            <Button variant="ghost" size="sm">↓ Original herunterladen</Button>
          </a>
        </div>
      {/if}

      {#if data.allowComments}
        <form class="comment-form" onsubmit={submitComment}>
          <h2>Feedback hinterlassen</h2>
          <input type="text" bind:value={guestName} placeholder="Dein Name" required />
          {#if commentTimestamp !== null}
            <span class="ts-badge">
              bei {formatTime(commentTimestamp)}
              <button type="button" onclick={() => (commentTimestamp = null)}>×</button>
            </span>
          {/if}
          <textarea
            bind:value={body}
            placeholder="Was denkst du? (Klick auf die Wellenform für Timestamp)"
            rows="3"
            required
          ></textarea>
          {#if commentError}<p class="error" role="alert">{commentError}</p>{/if}
          <Button type="submit" loading={submitting} disabled={!body.trim() || !guestName.trim()}>
            Senden
          </Button>
        </form>

        {#if guestName.trim()}
          <div class="finish">
            <p>
              {#if reviewSentAs === guestName.trim() && guestPass.length === 0}
                Danke, deine Rückmeldung ist angekommen.
              {:else if guestPass.length > 0}
                {guestPass.length === 1 ? 'Deine Anmerkung geht' : `Deine ${guestPass.length} Anmerkungen gehen`} gesammelt raus, sobald du fertig bist.
              {:else}
                Durchgehört? Sag kurz, wie du es findest.
              {/if}
            </p>
            <Button variant={guestPass.length > 0 ? 'primary' : 'secondary'} onclick={() => (reviewOpen = true)}>Fertig mit dem Song</Button>
          </div>
          <ReviewSheet
            bind:open={reviewOpen}
            title="Fertig mit dem Song"
            versionNumber={data.version.versionNumber}
            uploaderName={data.uploaderName ?? 'Wer hochgeladen hat'}
            guest
            pass={guestPass}
            onSubmit={submitReview}
          />
        {/if}
      {/if}

      {#snippet commentContent(c: Comment)}
        <div class="comment-head">
          <strong>{c.user?.name ?? c.guestName ?? 'Gast'}</strong>
          {#if !c.user}<span class="guest">Gast</span>{/if}
          {#if c.timestampSeconds !== null}
            <button class="ts" onclick={() => playerRef?.seekToTime(c.timestampSeconds!)}>
              {formatTime(c.timestampSeconds)}
            </button>
          {/if}
        </div>
        <p>{c.body}</p>
      {/snippet}

      <section class="comments">
        <h2>Kommentare ({data.comments.length})</h2>
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
          <p class="muted">Noch keine Kommentare.</p>
        {/if}
      </section>

      <footer>
        <p class="muted">Geteilt über Music Hub</p>
      </footer>
    {/if}
    <p class="legal"><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></p>
  </div>
  <PleasanceFooter />
</div>

<style>
  .listen-page {
    flex: 1;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .sender {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    align-self: flex-start;
    color: var(--color-text-primary);
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    font-stretch: 76%;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .sender:hover {
    color: var(--color-text-primary);
  }
  header { text-align: center; }
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
  .legal {
    margin: var(--space-4) 0 0;
    text-align: center;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .legal a {
    color: var(--color-text-tertiary);
  }
  .legal a:hover {
    color: var(--color-text-primary);
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

  .finish p {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
</style>
