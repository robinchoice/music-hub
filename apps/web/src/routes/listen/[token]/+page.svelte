<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import WaveformPlayer from '$lib/components/audio/WaveformPlayer.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { formatTime } from '$lib/utils/format.js';

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
  };

  const token = ($page.params as Record<string, string>).token;
  let data = $state<ShareData | null>(null);
  let loading = $state(true);
  let error = $state('');
  let passwordRequired = $state(false);
  let password = $state('');

  let guestName = $state('');
  let body = $state('');
  let commentTimestamp = $state<number | null>(null);
  let submitting = $state(false);
  let playerRef = $state<WaveformPlayer>();

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
    loading = true;
    error = '';
    try {
      const res = await fetch(`/api/v1/share/public/${token}`, {
        headers: password ? { 'X-Share-Password': password } : {},
      });
      if (res.status === 401) {
        const j = await res.json();
        if (j.passwordRequired) { passwordRequired = true; loading = false; return; }
      }
      if (!res.ok) {
        error = (await res.json().catch(() => ({}))).error || 'Link nicht verfügbar';
        loading = false;
        return;
      }
      data = await res.json();
      passwordRequired = false;
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
    load().then(() => createListenEvent());

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

  async function submitComment(e: Event) {
    e.preventDefault();
    if (!body.trim() || !guestName.trim() || !data) return;
    submitting = true;
    try {
      const res = await fetch(`/api/v1/share/public/${token}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(password ? { 'X-Share-Password': password } : {}),
        },
        body: JSON.stringify({ body, guestName, timestampSeconds: commentTimestamp ?? undefined }),
      });
      if (!res.ok) { error = 'Kommentar fehlgeschlagen'; return; }
      body = '';
      commentTimestamp = null;
      await load();
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>{data ? `${data.track.name} — ${data.project.name}` : 'Music Hub'}</title>
</svelte:head>

<div class="listen-page">
  {#if loading}
    <p class="muted">Lädt…</p>
  {:else if passwordRequired}
    <div class="password-gate">
      <h1>🔒 Geschützter Link</h1>
      <p>Bitte Passwort eingeben:</p>
      <input type="password" bind:value={password} placeholder="Passwort" />
      <Button onclick={load}>Öffnen</Button>
      {#if error}<p class="error">{error}</p>{/if}
    </div>
  {:else if error}
    <p class="error">{error}</p>
  {:else if data}
    <header>
      <p class="project">{data.project.name}</p>
      <h1>{data.track.name}</h1>
      {#if data.version.label}<p class="version-label">{data.version.label}</p>{/if}
    </header>

    <WaveformPlayer
      bind:this={playerRef}
      url={data.streamUrl}
      markers={data.comments
        .filter((c) => c.timestampSeconds !== null)
        .map((c) => ({
          id: c.id,
          timestampSeconds: c.timestampSeconds!,
          body: c.body,
          userName: c.user?.name ?? c.guestName ?? 'Gast',
        }))}
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
        <Button type="submit" loading={submitting} disabled={!body.trim() || !guestName.trim()}>
          Senden
        </Button>
      </form>
    {/if}

    <section class="comments">
      <h2>Kommentare ({data.comments.length})</h2>
      {#each data.comments.filter((c) => !c.parentId) as c}
        <div class="comment">
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
</div>

<style>
  .listen-page {
    max-width: 720px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  header { text-align: center; }
  .project { color: var(--color-text-tertiary); font-size: var(--text-sm); margin: 0; }
  h1 { margin: var(--space-1) 0; font-size: var(--text-2xl); }
  .version-label { color: var(--color-text-secondary); font-size: var(--text-sm); margin: 0; }
  .muted { color: var(--color-text-tertiary); font-size: var(--text-sm); }
  .error { color: var(--color-error, #ef4444); }

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
    gap: var(--space-2);
    align-items: center;
  }
  .name-prompt-row input {
    flex: 1;
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
  .comment-form h2 { margin: 0 0 var(--space-2); font-size: var(--text-base); }
  .ts-badge {
    align-self: flex-start;
    background: rgba(251, 191, 36, 0.15);
    border: 1px solid rgba(251, 191, 36, 0.3);
    color: var(--color-warning);
    border-radius: var(--radius-sm);
    padding: 0.15rem var(--space-2);
    font-size: var(--text-xs);
  }
  .ts-badge button { background: none; border: none; color: inherit; cursor: pointer; margin-left: var(--space-1); }
  .comments { display: flex; flex-direction: column; gap: var(--space-2); }
  .comments h2 { font-size: var(--text-base); margin: 0 0 var(--space-2); }
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
    background: rgba(251, 191, 36, 0.15);
    border: 1px solid rgba(251, 191, 36, 0.3);
    color: var(--color-warning);
    border-radius: var(--radius-sm);
    padding: 0.05rem 0.4rem;
    font-size: var(--text-xs);
    cursor: pointer;
    font-family: inherit;
  }
  .comment p { margin: 0; font-size: var(--text-sm); }
  footer {
    text-align: center;
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }
</style>
