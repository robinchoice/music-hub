<script lang="ts">
  import { ask } from '$lib/stores/confirm.js';
  import { t, locale } from '$lib/i18n/index.js';
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
      toastSuccess(t().workspace.share.copied);
    } catch {
      toastError(t().workspace.share.copyFailed);
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
    if (!(await ask(t().workspace.share.confirmSwitchOff))) return;
    try {
      await api.delete(`/share/project-link/${link.id}`);
    } catch {
      // The API client already showed the error, e.g. a delivery hangs on the link
      return;
    }
    link = null;
    toastSuccess(t().workspace.share.switchedOff);
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
      toastSuccess(t().workspace.share.inviteSent(inviteEmail.trim()));
      inviteEmail = '';
    } catch {
      // The API client already showed the error
    } finally {
      inviting = false;
    }
  }
</script>

<Modal bind:open title={t().workspace.share.title(projectName)}>
  <section>
    <div class="section-head">
      <div>
        <h3>{t().workspace.share.listen}</h3>
        <p class="hint">{t().workspace.share.listenHint}</p>
      </div>
      {#if link}
        <Button variant="ghost" size="sm" onclick={switchOff}>{t().workspace.share.switchOff}</Button>
      {/if}
    </div>

    {#if loading}
      <p class="muted">{t().workspace.loading}</p>
    {:else}
      <div class="url-row">
        <input
          type="text"
          readonly
          value={link ? url : t().workspace.share.linkOnCopy}
          class:placeholder={!link}
          onclick={(e) => link && (e.target as HTMLInputElement).select()}
          aria-label={t().workspace.share.listenLinkLabel}
        />
        <Button size="sm" onclick={copy} loading={busy && !link}>{t().workspace.share.copyLink}</Button>
      </div>

      {#if link}
        <div class="options">
          <label class="option">
            <span>
              {t().workspace.share.plays}
              <small>
                {link.trackIds ? t().workspace.share.playsSome(shownCount, tracks.length) : t().workspace.share.playsAll(tracks.length)}
              </small>
            </span>
            <select value={link.follows} onchange={(e) => update({ follows: (e.target as HTMLSelectElement).value })} disabled={busy}>
              <option value="latest">{t().workspace.share.followsLatest}</option>
              <option value="approved">{t().workspace.share.followsApproved}</option>
            </select>
          </label>
          {#if canComment}
            <label class="option">
              <span>{t().workspace.share.allowComments} <small>{t().workspace.share.allowCommentsHint}</small></span>
              <input type="checkbox" checked={link.allowComments} onchange={(e) => update({ allowComments: (e.target as HTMLInputElement).checked })} disabled={busy} />
            </label>
          {/if}
          {#if may.canDownload}
            <label class="option">
              <span>{t().workspace.share.allowDownload} <small>{t().workspace.share.allowDownloadHint}</small></span>
              <input type="checkbox" checked={link.allowDownload} onchange={(e) => update({ allowDownload: (e.target as HTMLInputElement).checked })} disabled={busy} />
            </label>
          {/if}

          <details class="more">
            <summary>
              {t().workspace.share.more}
              {#if link.hasPassword}<span class="flag">{t().workspace.share.flagPassword}</span>{/if}
              {#if link.expiresAt}<span class="flag">{t().workspace.share.flagExpires}</span>{/if}
              {#if link.trackIds}<span class="flag">{t().workspace.share.flagSelection}</span>{/if}
            </summary>

            <div class="more-row">
              <span class="label">{t().workspace.share.password}</span>
              {#if link.hasPassword}
                <span class="muted">{t().workspace.share.passwordIsSet}</span>
                <Button variant="ghost" size="sm" onclick={() => update({ password: null }, t().workspace.share.passwordRemoved)}>{t().common.remove}</Button>
              {:else}
                <form class="inline" onsubmit={(e) => { e.preventDefault(); void update({ password }, t().workspace.share.passwordSetDone).then(() => (password = '')); }}>
                  <input type="text" bind:value={password} placeholder={t().workspace.share.passwordOptional} aria-label={t().workspace.share.password} />
                  <Button type="submit" variant="secondary" size="sm" disabled={!password}>{t().workspace.share.passwordSet}</Button>
                </form>
              {/if}
            </div>

            <div class="more-row">
              <span class="label">{t().workspace.share.expires}</span>
              {#if link.expiresAt}
                <span class="muted">{t().workspace.share.expiresOn(formatDate(link.expiresAt))}</span>
                <Button variant="ghost" size="sm" onclick={() => update({ expiresAt: null })}>{t().workspace.share.never}</Button>
              {:else}
                <select onchange={expiry} disabled={busy} aria-label={t().workspace.share.expires}>
                  <option value="0">{t().workspace.share.neverOption}</option>
                  <option value="7">{t().workspace.share.after7}</option>
                  <option value="30">{t().workspace.share.after30}</option>
                </select>
              {/if}
            </div>

            <div class="songs">
              <label class="song">
                <input type="radio" checked={!link.trackIds} onchange={() => update({ trackIds: null })} disabled={busy} />
                <span>{t().workspace.share.allSongs}</span>
              </label>
              <label class="song">
                <input type="radio" checked={!!link.trackIds} onchange={() => update({ trackIds: tracks.map((t) => t.id) })} disabled={busy} />
                <span>{t().workspace.share.selectedOnly}</span>
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
    <h3>{t().workspace.share.collaborate}</h3>
    {#if canInvite}
      <p class="hint">{t().workspace.share.inviteHint}</p>
      <form class="invite" onsubmit={invite}>
        <input type="email" bind:value={inviteEmail} placeholder={t().workspace.share.emailPlaceholder} aria-label={t().common.email} required />
        <select bind:value={inviteRole} aria-label={t().workspace.share.role}>
          {#each assignableRoles as r}
            <option value={r}>{ROLE_LABELS[locale()][r]}</option>
          {/each}
        </select>
        <Button type="submit" variant="secondary" size="sm" loading={inviting}>{t().common.invite}</Button>
      </form>
      <a class="manage" href="/projects/{projectId}/settings">{t().workspace.share.manageMembers}</a>
    {:else}
      <p class="hint">{t().workspace.share.onlyOwnerInvites}</p>
    {/if}
  </section>

  {#snippet actions()}
    <Button variant="secondary" size="sm" onclick={() => (open = false)}>{t().common.close}</Button>
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
