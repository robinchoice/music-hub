<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import ListenTrack from '$lib/components/listen/ListenTrack.svelte';
  import PleasanceFooter from '$lib/components/PleasanceFooter.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Tile from '$lib/components/ui/Tile.svelte';
  import { formatTime } from '$lib/utils/format.js';
  import { formatEuro, type GuestPaymentResponse, type ProjectPublicDeliveryFields, type PublicDelivery, type PublicDeliveryTrack } from '@music-hub/shared';
  import DecisionDialog from '$lib/components/delivery/DecisionDialog.svelte';
  import PayDialog from '$lib/components/delivery/PayDialog.svelte';
  import { toastError } from '$lib/stores/toast.js';
  import { CLIENT_STATE_LABELS, guestRequest, plural, roundDots, roundsText } from '$lib/utils/delivery.js';

  type Album = ProjectPublicDeliveryFields & {
    project: { name: string; artist: string | null; coverUrl: string | null };
    allowComments: boolean;
    tracks: {
      id: string;
      name: string;
      /** The track's own share link, which plays and takes the comments */
      token: string;
      coverUrl: string | null;
      version: { id: string; versionNumber: number; label: string | null; duration: number | null };
      comments: number;
    }[];
  };

  const token = ($page.params as Record<string, string>).token;
  let album = $state<Album | null>(null);
  let loading = $state(true);
  let error = $state('');
  let passwordRequired = $state(false);
  let password = $state('');
  let current = $state(0);
  // Playback starts on its own only after the guest pressed play once
  let playing = $state(false);

  const track = $derived(album?.tracks[current]);
  // A delivery turns the page into the client's order: decide per song, pay, then download
  const delivery = $derived(album?.delivery);
  const dtOf = (trackId: string) => delivery?.tracks.find((t) => t.trackId === trackId);
  const currentDt = $derived(track ? dtOf(track.id) : undefined);
  // Songs of the order without a version to hear yet
  const waiting = $derived(delivery && album ? delivery.tracks.filter((t) => !album!.tracks.some((a) => a.id === t.trackId)).length : 0);
  const openNames = $derived(
    delivery && album ? album.tracks.filter((t) => { const s = dtOf(t.id)?.state; return s && s !== 'approved'; }).map((t) => t.name) : [],
  );
  let decision = $state<'approve' | 'round' | null>(null);
  let decisionOpen = $state(false);
  let decisionVersion = $state<{ id: string; number: number }>({ id: '', number: 0 });
  let decisionName = $state('');
  let payOpen = $state(false);
  let whyOpen = $state(false);
  const total = $derived(album?.tracks.reduce((s, t) => s + (t.version.duration ?? 0), 0) ?? 0);

  async function load() {
    loading = !album;
    error = '';
    try {
      const res = await fetch(`/api/v1/share/project/public/${token}`, {
        headers: password ? { 'X-Share-Password': password } : {},
      });
      if (res.status === 401) {
        passwordRequired = true;
        error = password ? 'Das Passwort ist nicht richtig. Bitte versuche es erneut.' : '';
        return;
      }
      if (!res.ok) {
        error = res.status === 404 ? 'Dieser Link wurde nicht gefunden.'
          : res.status === 410 ? 'Dieser Link ist gerade nicht verfügbar.'
          : res.status === 429 ? 'Zu viele Versuche. Bitte warte etwas und versuche es erneut.'
          : 'Der Link konnte nicht geladen werden. Bitte versuche es erneut.';
        return;
      }
      album = await res.json();
      passwordRequired = false;
    } catch {
      error = 'Keine Verbindung. Bitte prüfe dein Internet und versuche es erneut.';
    } finally {
      loading = false;
    }
  }

  let listen = $state<ListenTrack>();

  function play(i: number) {
    if (i === current) listen?.play();
    current = i;
    playing = true;
  }

  onMount(load);

  function decide(mode: 'approve' | 'round', versionId: string, guestName: string) {
    const v = album?.tracks[current]?.version;
    decision = mode;
    decisionVersion = { id: versionId, number: v?.id === versionId ? v.versionNumber : (v?.versionNumber ?? 0) };
    decisionName = guestName;
    decisionOpen = true;
  }

  function updateDelivery(next: PublicDelivery) {
    if (album) album = { ...album, delivery: next };
  }

  async function decided(next: PublicDelivery) {
    updateDelivery(next);
    await listen?.reload();
  }

  function payClick() {
    if (!delivery) return;
    if (delivery.payable || delivery.openPayment) {
      payOpen = true;
      whyOpen = false;
    } else {
      whyOpen = !whyOpen;
    }
  }

  // The studio confirms a transfer on its side; the page notices without a reload
  $effect(() => {
    const p = delivery?.openPayment;
    if (!p || p.status !== 'announced' || payOpen) return;
    const id = p.id;
    const check = setInterval(async () => {
      try {
        const res = await guestRequest<GuestPaymentResponse>(token, `/payments/${id}`, password);
        updateDelivery(res.delivery);
      } catch {
        // The next check tries again
      }
    }, 60_000);
    return () => clearInterval(check);
  });

  // Links with a password can't carry it in a plain link, so the file comes through fetch
  async function download(e: MouseEvent, trackId: string, stems: boolean, name: string) {
    if (!password) return;
    e.preventDefault();
    try {
      const headers = { 'X-Share-Password': password };
      if (!stems) {
        // The WAV comes straight from the bucket through a short-lived URL, not through this page
        const res = await fetch(`${downloadPath(trackId, false)}?redirect=0`, { headers });
        if (!res.ok) throw new Error();
        const body: unknown = await res.json();
        if (!body || typeof body !== 'object' || !('url' in body) || typeof body.url !== 'string') throw new Error();
        window.location.href = body.url;
        return;
      }
      const res = await fetch(downloadPath(trackId, true), { headers });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = stems ? `${name} Spuren.zip` : `${name}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toastError('Der Download hat nicht geklappt. Bitte versuche es erneut.');
    }
  }
  const downloadPath = (trackId: string, stems: boolean) =>
    `/api/v1/share/project/public/${token}/delivery/download/${trackId}${stems ? '/stems' : ''}`;
</script>

<svelte:head>
  <title>{album ? album.project.name : 'Music Hub'}</title>
</svelte:head>

<div class="shell">
  <div class="album-page" class:order-page={!!delivery}>
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
    {:else if error}
      <p class="error" role="alert">{error}</p>
      <Button onclick={load}>Erneut versuchen</Button>
    {:else if album && delivery}
      <header class="order-head">
        <p class="kicker">Ablieferung für {delivery.clientName}{delivery.reference ? ` · ${delivery.reference}` : ''}</p>
        <h1>{album.project.name}</h1>
        <p class="meta">
          von <b>{delivery.studioName}</b>{album.project.artist ? ` · ${album.project.artist}` : ''} · {plural(delivery.totals.trackCount, 'Song', 'Songs')}
        </p>
      </header>

      <div class="order">
        <aside class="songs">
          {#if album.tracks.length === 0}
            <p class="muted">Hier ist noch nichts zu hören. Das Studio lädt die ersten Versionen bald hoch.</p>
          {:else}
            <ol class="tracklist">
              {#each album.tracks as t, i (t.id)}
                {@const dt = dtOf(t.id)}
                <li>
                  <button class="row" class:active={i === current} aria-current={i === current} onclick={() => play(i)}>
                    <span class="name">
                      <b>{t.name}</b>
                      <small>V{t.version.versionNumber}{t.version.duration ? ` · ${formatTime(t.version.duration)}` : ''}</small>
                    </span>
                    {#if dt}
                      <span class="state">
                        <span class="chip {dt.state}">{CLIENT_STATE_LABELS[dt.state]}</span>
                        {@render dots(dt)}
                      </span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ol>
          {/if}
          {#if waiting > 0}
            <p class="muted">{waiting === 1 ? 'Ein weiterer Song kommt noch.' : `${waiting} weitere Songs kommen noch.`}</p>
          {/if}
        </aside>

        <main class="listen">
          {#if track}
            {#key track.token}
              <ListenTrack
                bind:this={listen}
                token={track.token}
                {password}
                inAlbum
                paywall
                commenting={!currentDt || currentDt.state === 'review'}
                actions={currentDt ? decide_ : undefined}
                autoPlay={playing}
                previous={current > 0 ? () => play(current - 1) : undefined}
                next={current < album.tracks.length - 1 ? () => play(current + 1) : undefined}
              />
            {/key}
          {/if}
        </main>
      </div>

      <div class="paybar" class:paid={delivery.status === 'paid'}>
        <div class="sum">
          <b>{delivery.status === 'paid' ? `Bezahlt · ${formatEuro(delivery.totals.totalCents)}` : formatEuro(delivery.totals.totalCents)}</b>
          <small>
            {#if delivery.status === 'paid'}
              Danke! WAVs{delivery.includeStems ? ' und Spuren' : ''} stehen bei jedem Song bereit.
            {:else}
              {plural(delivery.totals.trackCount, 'Song', 'Songs')}{delivery.totals.extraRounds ? ` + ${plural(delivery.totals.extraRounds, 'Zusatzrunde', 'Zusatzrunden')} (${formatEuro(delivery.totals.extraCents)})` : ''}
              · {delivery.totals.approvedCount} von {delivery.totals.trackCount} freigegeben{delivery.totals.paidCents ? ` · ${formatEuro(delivery.totals.paidCents)} schon bezahlt` : ''}
            {/if}
          </small>
        </div>
        {#if delivery.status === 'open'}
          {#if delivery.openPayment?.status === 'announced'}
            <Button variant="secondary" onclick={payClick}>Überweisung angekündigt · Details</Button>
          {:else if delivery.payable}
            <Button onclick={payClick}>Bezahlen und herunterladen · {formatEuro(delivery.totals.dueCents)}</Button>
          {:else}
            <Button variant="secondary" onclick={payClick}><Icon name="lock" size={14} /> Bezahlen und herunterladen</Button>
          {/if}
        {/if}
        {#if whyOpen && !delivery.payable && delivery.status === 'open'}
          <p class="why" role="status">
            Bezahlen geht, sobald alle Songs freigegeben sind.
            {#if openNames.length}Noch offen: {openNames.join(', ')}{waiting ? ` und ${plural(waiting, 'Song', 'Songs')}, die noch kommen` : ''}.{:else if waiting}Es {waiting === 1 ? 'kommt noch ein Song' : `kommen noch ${waiting} Songs`}.{/if}
          </p>
        {/if}
      </div>

      {#if decision && currentDt && track}
        <DecisionDialog
          bind:open={decisionOpen}
          mode={decision}
          {token}
          {password}
          trackName={track.name}
          versionId={decisionVersion.id}
          versionNumber={decisionVersion.number}
          track={currentDt}
          extraRoundCents={delivery.extraRoundCents}
          announced={delivery.openPayment?.status === 'announced' ? delivery.openPayment.amountCents : null}
          name={decisionName}
          ondone={decided}
        />
      {/if}
      <PayDialog bind:open={payOpen} {token} {password} {delivery} ondelivery={updateDelivery} />
    {:else if album}
      <header class="hero">
        <div class="cover"><CoverImage src={album.project.coverUrl} name={album.project.name} size="fill" rounded="lg" /></div>
        <div class="hero-text">
          <h1>{album.project.name}</h1>
          <p class="meta">
            {[album.project.artist, `${album.tracks.length} ${album.tracks.length === 1 ? 'Song' : 'Songs'}`, total ? formatTime(total) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {#if album.tracks.length > 0}
            <Button onclick={() => play(0)}><Icon name="play" size={14} /> Alles abspielen</Button>
          {/if}
        </div>
      </header>

      {#if album.tracks.length === 0}
        <p class="muted">Hier ist noch nichts zu hören.</p>
      {:else}
        <ol class="tracklist">
          {#each album.tracks as t, i (t.id)}
            <li>
              <button class="row" class:active={i === current} aria-current={i === current} onclick={() => play(i)}>
                <span class="n">{#if i === current}<Icon name="play" size={12} />{:else}{i + 1}{/if}</span>
                <CoverImage src={t.coverUrl ?? album.project.coverUrl} name={t.name} size="sm" rounded="sm" />
                <span class="name">
                  <b>{t.name}</b>
                  <small>V{t.version.versionNumber}{t.version.label ? ` · ${t.version.label}` : ''}</small>
                </span>
                {#if album.allowComments && t.comments > 0}
                  <span class="count" title="Kommentare"><Icon name="comment" size={12} /> {t.comments}</span>
                {/if}
                <span class="dur">{t.version.duration ? formatTime(t.version.duration) : ''}</span>
              </button>
            </li>
          {/each}
        </ol>

        {#if track}
          {#key track.token}
            <ListenTrack
              bind:this={listen}
              token={track.token}
              {password}
              inAlbum
              autoPlay={playing}
              previous={current > 0 ? () => play(current - 1) : undefined}
              next={current < album.tracks.length - 1 ? () => play(current + 1) : undefined}
            />
          {/key}
        {/if}
      {/if}
    {/if}
    <p class="legal"><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></p>
  </div>
  <PleasanceFooter />
</div>

{#snippet dots(t: PublicDeliveryTrack)}
  <span class="dots" title={roundsText(t)}>
    {#each roundDots(t) as dot, k (k)}<i class:used={dot.used} class:extra={dot.extra} class:gifted={dot.gifted}></i>{/each}
  </span>
{/snippet}

{#snippet decide_({ versionId, guestName }: { versionId: string; guestName: string })}
  {#if delivery && currentDt && track}
    {@const dt = currentDt}
    <div class="decide">
      <div class="rounds">
        {@render dots(dt)}
        <span>
          {roundsText(dt)}{dt.nextRoundExtra && dt.state !== 'approved' && delivery.status === 'open' ? ` · jede weitere ${formatEuro(delivery.extraRoundCents)}` : ''}
        </span>
      </div>
      {#if delivery.status === 'paid'}
        {#if dt.approvedVersionId}
          <div class="buttons">
            <Button variant="secondary" href={downloadPath(dt.trackId, false)} onclick={(e) => download(e, dt.trackId, false, track.name)}>
              <Icon name="download" size={14} /> WAV
            </Button>
            {#if dt.hasStems}
              <Button variant="secondary" href={downloadPath(dt.trackId, true)} onclick={(e) => download(e, dt.trackId, true, track.name)}>
                <Icon name="download" size={14} /> Spuren (ZIP)
              </Button>
            {/if}
          </div>
        {/if}
      {:else if delivery.status === 'open'}
        {#if dt.state === 'review' && versionId !== dt.shownVersionId}
          <p class="lockline">Inzwischen gibt es eine neuere Version. <button type="button" class="link" onclick={load}>Neu laden</button></p>
        {:else if dt.state === 'review'}
          <div class="buttons">
            <Button onclick={() => decide('approve', versionId, guestName)}><Icon name="check" size={14} /> Freigeben</Button>
            <Button variant="secondary" onclick={() => decide('round', versionId, guestName)}>
              {dt.nextRoundExtra ? `Zusatzrunde anfordern · ${formatEuro(delivery.extraRoundCents)}` : `Änderungen anfordern · Runde ${dt.roundsUsed + 1} von ${dt.roundsIncluded}`}
            </Button>
          </div>
        {:else if dt.state === 'changes'}
          <p class="lockline">Das Studio arbeitet an deinen Anmerkungen. Die nächste Version erscheint hier.</p>
        {:else}
          <p class="lockline">
            <Icon name="check" size={14} /> Freigegeben{dt.approvedByName ? ` von ${dt.approvedByName}` : ''}. Der Download kommt nach der Zahlung.
            {#if versionId === dt.shownVersionId}
              <button type="button" class="link" onclick={() => decide('round', versionId, guestName)}>Doch Änderungen anfordern</button>
            {/if}
          </p>
        {/if}
        <p class="lockline"><Icon name="lock" size={14} /> WAV{delivery.includeStems ? ' und Spuren gibt' : ' gibt'} es nach der Zahlung. Bis dahin hörst du eine MP3-Vorschau.</p>
      {/if}
    </div>
  {/if}
{/snippet}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .album-page {
    flex: 1;
    width: 100%;
    max-width: 820px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
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
  .sender:hover { color: var(--color-text-primary); }

  .hero {
    display: flex;
    gap: var(--space-6);
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .cover {
    width: min(220px, 45vw);
    aspect-ratio: 1;
    flex: none;
  }
  .hero-text {
    flex: 1 1 16rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
  }
  .hero h1 {
    margin: 0;
    font-size: clamp(2.75rem, 9vw, 4rem);
    font-weight: 800;
    font-stretch: 75%;
    line-height: 0.95;
  }
  .meta { margin: 0; color: var(--color-text-secondary); }

  .tracklist {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .tracklist li + li { border-top: 1px solid var(--color-border); }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover { background: var(--color-bg-raised); }
  .row.active { background: var(--color-accent-subtle); }
  .row.active b { color: var(--color-accent); }
  .n {
    width: 1.5rem;
    text-align: center;
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    flex: none;
  }
  .row.active .n { color: var(--color-accent); }
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name b {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name small { color: var(--color-text-tertiary); font-size: var(--text-xs); }
  .count, .dur {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }

  .password-gate {
    text-align: center;
    padding: var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: center;
  }
  .password-gate input {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    width: 100%;
  }
  .muted { color: var(--color-text-tertiary); font-size: var(--text-sm); }
  .error { color: var(--color-error); }
  .legal {
    margin: var(--space-4) 0 0;
    text-align: center;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .legal a { color: var(--color-text-tertiary); }
  .legal a:hover { color: var(--color-text-primary); }

  @media (max-width: 640px) {
    .hero { gap: var(--space-4); }
  }

  /* ---------- A delivery: the client's order ---------- */
  .album-page.order-page {
    max-width: 1100px;
    padding-bottom: 0;
  }
  .order-head h1 {
    margin: var(--space-1) 0 var(--space-2);
    font-size: clamp(2.25rem, 7vw, 3.25rem);
    font-weight: 800;
    font-stretch: 75%;
    line-height: 0.95;
  }
  .kicker {
    margin: 0;
    color: var(--color-accent);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .order-head .meta b { color: var(--color-text-primary); font-weight: 600; }
  .order {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    gap: var(--space-6);
    align-items: start;
  }
  .songs {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    position: sticky;
    top: var(--space-4);
  }
  .songs .row { align-items: flex-start; padding: var(--space-3); }
  .state {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    flex: none;
  }
  .chip {
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 1px 8px;
    border-radius: var(--radius-full);
    white-space: nowrap;
  }
  .chip.review { color: var(--color-accent); background: var(--color-accent-subtle); }
  .chip.changes { color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 14%, transparent); }
  .chip.approved { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 14%, transparent); }
  .dots {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .dots i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--color-text-tertiary);
  }
  .dots i.used { background: var(--color-text-secondary); border-color: var(--color-text-secondary); }
  .dots i.extra { border-color: var(--color-warning); }
  .dots i.extra.used { background: var(--color-warning); }
  .dots i.gifted { border-color: var(--color-success); }
  .dots i.gifted.used { background: var(--color-success); }
  .listen { min-width: 0; }
  .decide {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .rounds {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-raised);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .buttons {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .lockline {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--color-accent);
    font: inherit;
    cursor: pointer;
  }
  .paybar {
    position: sticky;
    bottom: 0;
    z-index: 3;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-5);
    margin: 0 calc(-1 * var(--space-4));
    padding: var(--space-3) var(--space-4);
    background: color-mix(in srgb, var(--color-bg-raised) 94%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-top: 1px solid var(--color-border);
  }
  .sum {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .sum b {
    color: var(--color-text-primary);
    font-size: var(--text-xl);
    font-variant-numeric: tabular-nums;
  }
  .sum small { color: var(--color-text-secondary); font-size: var(--text-xs); }
  .paybar.paid .sum b { color: var(--color-success); }
  .why {
    flex-basis: 100%;
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  @media (max-width: 800px) {
    .order { grid-template-columns: minmax(0, 1fr); }
    .songs { position: static; }
    .paybar :global(.btn) { width: 100%; }
    .buttons :global(.btn) { flex: 1 1 100%; }
  }
</style>
