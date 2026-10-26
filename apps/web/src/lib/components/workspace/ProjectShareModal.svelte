<script lang="ts">
  import { ROLE_LABELS, PROJECT_ROLES, type ProjectRole } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { toastError, toastSuccess } from '$lib/stores/toast.js';
  import { formatDate } from '$lib/utils/format.js';
  import { capabilities } from '$lib/utils/track.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';

  type Link = {
    id: string;
    token: string;
    expiresAt: string | null;
    allowComments: boolean;
    allowDownload: boolean;
    hasPassword: boolean;
    follows: 'latest' | 'approved';
    trackIds: string[] | null;
  };

  let {
    open = $bindable(false),
    projectId,
    projectName,
    roles,
    archived,
    tracks,
  }: {
    open: boolean;
    projectId: string;
    projectName: string;
    roles: string[];
    archived: boolean;
    tracks: { id: string; name: string }[];
  } = $props();

  const DAY = 24 * 60 * 60 * 1000;
  // The API caps a link at the creator's rights; the dialog doesn't offer more either
  const may = $derived(capabilities(roles));
  const canComment = $derived(may.canComment && !archived);
  const canInvite = $derived(roles.includes('owner') || roles.includes('management'));
  const assignableRoles = PROJECT_ROLES.filter((r) => r !== 'owner');

  let link = $state<Link | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let password = $state('');
  let inviteEmail = $state('');
  let inviteRole = $state<ProjectRole>('viewer');
  let inviting = $state(false);

  const url = $derived(link ? `${window.location.origin}/album/${link.token}` : '');
  const shownCount = $derived(link?.trackIds ? tracks.filter((t) => link!.trackIds!.includes(t.id)).length : tracks.length);

  $effect(() => {
    if (!open) return;
    loading = true;
    api
      .get<{ link: Link | null }>(`/share/project/${projectId}`)
      .then((res) => (link = res.link))
      .finally(() => (loading = false));
  });

  // The first copy makes the link, so sharing is one click
  async function copy() {
    if (!link) {
      busy = true;
      try {
        link = (await api.post<{ link: Link }>(`/share/project/${projectId}`, {})).link;
      } catch {
        return;
      } finally {
        busy = false;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess('Link kopiert');
    } catch {
      toastError('Kopieren ging nicht, bitte den Link markieren und kopieren.');
    }
  }

  async function update(patch: Record<string, unknown>, done?: string) {
    if (!link) return;
    busy = true;
    try {
      link = (await api.patch<{ link: Link }>(`/share/project-link/${link.id}`, patch)).link;
      if (done) toastSuccess(done);
    } catch {
      // The API client already showed the error
    } finally {
      busy = false;
    }
  }

  async function switchOff() {
    if (!link) return;
    if (!confirm('Link ausschalten? Wer ihn hat, kann das Projekt dann nicht mehr hören. Ein neuer Link hat eine andere Adresse.')) return;
    try {
      await api.delete(`/share/project-link/${link.id}`);
    } catch {
      // The API client already showed the error, e.g. a delivery hangs on the link
      return;
    }
    link = null;
    toastSuccess('Link ausgeschaltet');
  }

  function expiry(e: Event) {
    const days = Number((e.target as HTMLSelectElement).value);
    void update({ expiresAt: days ? new Date(Date.now() + days * DAY).toISOString() : null });
  }

  function toggleTrack(id: string, on: boolean) {
    const current = link?.trackIds ?? tracks.map((t) => t.id);
    void update({ trackIds: on ? [...current, id] : current.filter((x) => x !== id) });
  }

  async function invite(e: Event) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    inviting = true;
    try {
      await api.post(`/projects/${projectId}/members`, { email: inviteEmail.trim(), roles: [inviteRole] });
      toastSuccess(`Einladung an ${inviteEmail.trim()} verschickt`);
      inviteEmail = '';
    } catch {
      // The API client already showed the error
    } finally {
      inviting = false;
    }
  }
</script>

<Modal bind:open title="{projectName} teilen">
  <section>
    <div class="section-head">
      <div>
        <h3>Zum Reinhören</h3>
        <p class="hint">Alle mit dem Link hören das Projekt, ohne Konto.</p>
      </div>
      {#if link}
        <Button variant="ghost" size="sm" onclick={switchOff}>Ausschalten</Button>
      {/if}
    </div>

    {#if loading}
      <p class="muted">Lädt…</p>
    {:else}
      <div class="url-row">
        <input
          type="text"
          readonly
          value={link ? url : 'Der Link entsteht beim ersten Kopieren'}
          class:placeholder={!link}
          onclick={(e) => link && (e.target as HTMLInputElement).select()}
          aria-label="Link zum Reinhören"
        />
        <Button size="sm" onclick={copy} loading={busy && !link}>Link kopieren</Button>
      </div>

      {#if link}
        <div class="options">
          <label class="option">
            <span>
              Spielt
              <small>
                {link.trackIds ? `${shownCount} von ${tracks.length} Songs` : `Alle ${tracks.length} Songs, neue kommen automatisch dazu`}
              </small>
            </span>
            <select value={link.follows} onchange={(e) => update({ follows: (e.target as HTMLSelectElement).value })} disabled={busy}>
              <option value="latest">Neueste Version jedes Songs</option>
              <option value="approved">Nur freigegebene Versionen</option>
            </select>
          </label>
          {#if canComment}
            <label class="option">
              <span>Kommentare erlauben <small>Mit Namen, ohne Konto</small></span>
              <input type="checkbox" checked={link.allowComments} onchange={(e) => update({ allowComments: (e.target as HTMLInputElement).checked })} disabled={busy} />
            </label>
          {/if}
          {#if may.canDownload}
            <label class="option">
              <span>Originale zum Download <small>Die Dateien der gezeigten Versionen</small></span>
              <input type="checkbox" checked={link.allowDownload} onchange={(e) => update({ allowDownload: (e.target as HTMLInputElement).checked })} disabled={busy} />
            </label>
          {/if}

          <details class="more">
            <summary>
              Mehr: Passwort, Ablauf, Songs auswählen
              {#if link.hasPassword}<span class="flag">Passwort</span>{/if}
              {#if link.expiresAt}<span class="flag">läuft ab</span>{/if}
              {#if link.trackIds}<span class="flag">Auswahl</span>{/if}
            </summary>

            <div class="more-row">
              <span class="label">Passwort</span>
              {#if link.hasPassword}
                <span class="muted">ist gesetzt</span>
                <Button variant="ghost" size="sm" onclick={() => update({ password: null }, 'Passwort entfernt')}>Entfernen</Button>
              {:else}
                <form class="inline" onsubmit={(e) => { e.preventDefault(); void update({ password }, 'Passwort gesetzt').then(() => (password = '')); }}>
                  <input type="text" bind:value={password} placeholder="optional" aria-label="Passwort" />
                  <Button type="submit" variant="secondary" size="sm" disabled={!password}>Setzen</Button>
                </form>
              {/if}
            </div>

            <div class="more-row">
              <span class="label">Läuft ab</span>
              {#if link.expiresAt}
                <span class="muted">am {formatDate(link.expiresAt)}</span>
                <Button variant="ghost" size="sm" onclick={() => update({ expiresAt: null })}>Nie</Button>
              {:else}
                <select onchange={expiry} disabled={busy} aria-label="Läuft ab">
                  <option value="0">nie</option>
                  <option value="7">nach 7 Tagen</option>
                  <option value="30">nach 30 Tagen</option>
                </select>
              {/if}
            </div>

            <div class="songs">
              <label class="song">
                <input type="radio" checked={!link.trackIds} onchange={() => update({ trackIds: null })} disabled={busy} />
                <span>Alle Songs, auch spätere</span>
              </label>
              <label class="song">
                <input type="radio" checked={!!link.trackIds} onchange={() => update({ trackIds: tracks.map((t) => t.id) })} disabled={busy} />
                <span>Nur ausgewählte</span>
              </label>
              {#if link.trackIds}
                <ul>
                  {#each tracks as t (t.id)}
                    <li>
                      <label class="song">
                        <!-- The last song stays, a link without songs plays nothing -->
                        <input
                          type="checkbox"
                          checked={link.trackIds.includes(t.id)}
                          onchange={(e) => toggleTrack(t.id, (e.target as HTMLInputElement).checked)}
                          disabled={busy || (shownCount === 1 && link.trackIds.includes(t.id))}
                        />
                        <span>{t.name}</span>
                      </label>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </details>
        </div>
      {/if}
    {/if}
  </section>

  <section class="team">
    <h3>Zum Mitarbeiten</h3>
    {#if canInvite}
      <p class="hint">Eingeladene bekommen ein Konto und einen Login-Link per Mail.</p>
      <form class="invite" onsubmit={invite}>
        <input type="email" bind:value={inviteEmail} placeholder="name@beispiel.de" aria-label="E-Mail" required />
        <select bind:value={inviteRole} aria-label="Rolle">
          {#each assignableRoles as r}
            <option value={r}>{ROLE_LABELS[r]}</option>
          {/each}
        </select>
        <Button type="submit" variant="secondary" size="sm" loading={inviting}>Einladen</Button>
      </form>
      <a class="manage" href="/projects/{projectId}/settings">Mitglieder verwalten</a>
    {:else}
      <p class="hint">Einladen können der Besitzer und das Management des Projekts.</p>
    {/if}
  </section>

  {#snippet actions()}
    <Button variant="secondary" size="sm" onclick={() => (open = false)}>Schließen</Button>
  {/snippet}
</Modal>

<style>
  section { display: flex; flex-direction: column; gap: var(--space-3); }
  section + section {
    margin-top: var(--space-5);
    padding-top: var(--space-5);
    border-top: 1px solid var(--color-border);
  }
  h3 { margin: 0; font-size: var(--text-base); font-weight: 600; }
  .hint { margin: 2px 0 0; color: var(--color-text-secondary); font-size: var(--text-sm); }
  .muted { color: var(--color-text-tertiary); font-size: var(--text-sm); }
  .section-head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); }
  .flag {
    margin-left: var(--space-1);
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border-hover);
    border-radius: 99px;
    font-size: var(--text-xs);
    color: var(--color-accent);
  }

  input[type='text'],
  input[type='email'],
  select {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    min-width: 0;
  }
  input[type='checkbox'],
  input[type='radio'] { accent-color: var(--color-accent); }
  .url-row { display: flex; gap: var(--space-2); }
  .url-row input { flex: 1; font-family: var(--font-mono); }
  .url-row input.placeholder { font-family: inherit; color: var(--color-text-tertiary); }

  .options { display: flex; flex-direction: column; }
  .option {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--color-border);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .option:first-child { border-top: 0; }
  .option small { display: block; color: var(--color-text-tertiary); font-size: var(--text-xs); }
  .option input[type='checkbox'] { width: 18px; height: 18px; flex: none; }

  .more { border-top: 1px solid var(--color-border); padding-top: var(--space-3); font-size: var(--text-sm); }
  .more summary { cursor: pointer; color: var(--color-text-secondary); }
  .more-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
  .label { width: 5.5rem; color: var(--color-text-secondary); }
  .inline { display: flex; gap: var(--space-2); flex: 1; }
  .inline input { flex: 1; }
  .songs { margin-top: var(--space-3); display: flex; flex-direction: column; gap: var(--space-1); }
  .songs ul { list-style: none; margin: 0; padding: 0 0 0 var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); }
  .song { display: flex; align-items: center; gap: var(--space-2); cursor: pointer; }

  .invite { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .invite input { flex: 1 1 12rem; }
  .manage { font-size: var(--text-sm); align-self: flex-start; }
</style>
