<script lang="ts">
  import { t, locale } from '$lib/i18n/index.js';
  import { getContext, onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api, isApiError } from '$lib/api/client.js';
  import { removeToast, toast, toastError, toastSuccess } from '$lib/stores/toast.js';
  import { ROLE_LABELS, PROJECT_ROLES, type ProjectRole } from '@music-hub/shared';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import CoverUpload from '$lib/components/ui/CoverUpload.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import { overviewIndex } from '$lib/stores/overview.js';
  import { artistNames, artistToSave } from '$lib/utils/overview.js';
  import ArtistInput from '$lib/components/workspace/ArtistInput.svelte';

  type Member = {
    id: string;
    role: string;
    roles: string[];
    user: { id: string; email: string; name: string; avatarUrl: string | null };
    // Invited and never logged in; older APIs leave it out
    invitePending?: boolean;
  };

  type Project = { id: string; name: string; description: string | null; artist: string | null; coverUrl: string | null; coverImageUrl: string | null };

  const projectId = $page.params.projectId!;
  const reloadSidebar = getContext<(() => void) | undefined>('reloadSidebar');

  let project = $state<Project | null>(null);
  let members = $state<Member[]>([]);
  let role = $state('');
  let roles = $state<string[]>([]);
  let loading = $state(true);

  // Edit project
  let editName = $state('');
  let editArtist = $state('');
  let editDesc = $state('');
  let saving = $state(false);

  // Invite
  let inviteEmail = $state('');
  let inviteRoles = $state<string[]>(['artist']);
  let inviting = $state(false);

  // Archive
  let showArchiveModal = $state(false);

  // The member whose roles are open in the dialog
  let editing = $state<Member | null>(null);
  let editOpen = $state(false);
  // Removals wait for the undo toast; the request goes out when it ends or the page is left
  const UNDO_MS = 8000;
  let removing = $state<Record<string, ReturnType<typeof setTimeout>>>({});
  // Their undo toasts, which must not outlive the page that can undo
  const undoToasts = new Map<string, string>();
  const shown = $derived(members.filter((m) => !(m.id in removing)));

  const assignableRoles = PROJECT_ROLES.filter((r) => r !== 'owner');

  onMount(async () => {
    try {
      const [projectRes, membersRes] = await Promise.all([
        api.get<{ project: Project; role: string; roles: string[] }>(`/projects/${projectId}`),
        api.get<{ members: Member[] }>(`/projects/${projectId}/members`),
      ]);
      project = projectRes.project;
      role = projectRes.role;
      roles = projectRes.roles;
      editName = project.name;
      editArtist = project.artist || '';
      editDesc = project.description || '';
      members = membersRes.members;
    } finally {
      loading = false;
    }
  });

  async function saveCover(key: string | null) {
    const res = await api.patch<{ project: Project }>(`/projects/${projectId}`, { coverImageUrl: key });
    project = res.project;
    toastSuccess(key ? t().workspace.projectPage.coverSaved : t().workspace.projectPage.coverRemoved);
  }

  async function saveProject() {
    saving = true;
    try {
      await api.patch(`/projects/${projectId}`, {
        name: editName,
        artist: artistToSave($overviewIndex ? artistNames($overviewIndex) : [], editArtist),
        description: editDesc,
      });
      toastSuccess(t().workspace.settings.saved);
      reloadSidebar?.();
    } catch {
      // The API client already showed the error
    } finally {
      saving = false;
    }
  }

  async function inviteMember() {
    if (!inviteEmail.trim()) return;
    inviting = true;
    try {
      await api.post(`/projects/${projectId}/members`, {
        email: inviteEmail,
        roles: inviteRoles,
      });
      toastSuccess(t().workspace.settings.invitedTo(inviteEmail.trim()));
      inviteEmail = '';
      const res = await api.get<{ members: Member[] }>(`/projects/${projectId}/members`);
      members = res.members;
    } catch {
      // The API client already showed the error
    } finally {
      inviting = false;
    }
  }

  // Adds or removes one role, the last one stays
  function toggled(roles: string[], r: string) {
    return roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r];
  }

  async function updateRoles(memberId: string, roles: string[]) {
    try {
      await api.patch(`/projects/${projectId}/members/${memberId}`, { roles });
      toastSuccess(t().workspace.settings.rolesUpdated);
      const res = await api.get<{ members: Member[] }>(`/projects/${projectId}/members`);
      members = res.members;
      if (editing) editing = members.find((m) => m.id === editing!.id) ?? null;
    } catch (e) {
      if (!isApiError(e)) {
        toastError(e instanceof Error ? e.message : t().workspace.settings.rolesFailed);
      }
    }
  }

  function editMember(member: Member) {
    editing = member;
    editOpen = true;
  }

  // Out of the list at once; gone for good only once the undo toast is over
  function removeMember(member: Member) {
    editOpen = false;
    removing = { ...removing, [member.id]: setTimeout(() => void commitRemoval(member.id), UNDO_MS) };
    const toastId = toast(t().workspace.settings.removedName(member.invitePending ? member.user.email : member.user.name), 'trash', UNDO_MS, {
      label: t().common.undo,
      run: () => {
        clearTimeout(removing[member.id]);
        const { [member.id]: _, ...rest } = removing;
        removing = rest;
      },
    });
    undoToasts.set(member.id, toastId);
  }

  async function commitRemoval(memberId: string) {
    if (!(memberId in removing)) return;
    clearTimeout(removing[memberId]);
    const { [memberId]: _, ...rest } = removing;
    removing = rest;
    try {
      await api.delete(`/projects/${projectId}/members/${memberId}`);
      members = members.filter((m) => m.id !== memberId);
    } catch (e) {
      if (!isApiError(e)) {
        toastError(e instanceof Error ? e.message : t().workspace.settings.removeFailed);
      }
    }
  }

  // Leaving the page ends the undo time: what waits goes out now
  onDestroy(() => {
    for (const id of Object.keys(removing)) {
      const toastId = undoToasts.get(id);
      if (toastId) removeToast(toastId);
      void commitRemoval(id);
    }
  });
  function flushOnUnload() {
    for (const id of Object.keys(removing)) {
      void fetch(`/api/v1/projects/${projectId}/members/${id}`, { method: 'DELETE', keepalive: true, credentials: 'same-origin' });
    }
    removing = {};
  }

  // Back from the browser's cache: the list may still show who was removed on the way out
  async function reloadMembers(e: PageTransitionEvent) {
    if (!e.persisted) return;
    members = (await api.get<{ members: Member[] }>(`/projects/${projectId}/members`)).members;
  }

  async function archiveProject() {
    try {
      await api.delete(`/projects/${projectId}`);
      toast(t().workspace.settings.archived, 'success', 6000, { label: t().workspace.settings.toArchive, run: () => goto('/archive') });
      reloadSidebar?.();
      await goto('/dashboard');
    } catch (e) {
      if (!isApiError(e)) {
        toastError(e instanceof Error ? e.message : t().workspace.settings.archiveFailed);
      }
    }
  }
</script>

<svelte:window onpagehide={flushOnUnload} onpageshow={reloadMembers} />

<TopBar
  crumbs={[
    { label: t().workspace.nav.music, href: '/music' },
    { label: project?.name ?? '…', href: `/projects/${projectId}` },
    { label: t().workspace.settings.title },
  ]}
/>

<div class="settings-page">
  <header>
    <h1>{t().workspace.settings.title}</h1>
  </header>

  {#if !loading && project}
    <!-- Projekt-Details -->
    <section class="section">
      <h2>{t().workspace.settings.details}</h2>
      <!-- Only the owner may change the details, the API refuses everyone else -->
      {#if role !== 'owner'}
        <div class="cover-row">
          <CoverImage src={project.coverUrl} name={project.name} size="xl" rounded="lg" />
          <div class="details-text">
            {#if project.artist}<span class="details-artist">{project.artist}</span>{/if}
            <strong>{project.name}</strong>
            {#if project.description}<p>{project.description}</p>{/if}
          </div>
        </div>
      {:else}
        <div class="cover-row">
          <CoverUpload currentUrl={project.coverUrl} name={project.name} onChange={saveCover} />
          <form class="details-form" onsubmit={(e) => { e.preventDefault(); saveProject(); }}>
            <ArtistInput bind:value={editArtist} />
            <Input label={t().common.name} bind:value={editName} />
            <label class="textarea-group">
              <span class="input-label">{t().workspace.settings.description}</span>
              <textarea bind:value={editDesc} rows="3" placeholder={t().workspace.settings.descriptionPlaceholder}></textarea>
            </label>
            <Button type="submit" loading={saving} disabled={!editName.trim()}>{t().common.save}</Button>
          </form>
        </div>
      {/if}
    </section>

    <!-- Mitwirkende -->
    <section class="section">
      <h2>{t().workspace.settings.contributors} <span class="count">{shown.length}</span></h2>

      <ul class="member-list">
        {#each shown as member (member.id)}
          <li class="member-row" class:pending={member.invitePending}>
            {#if member.invitePending}
              <span class="pending-avatar" aria-hidden="true">?</span>
            {:else}
              <Avatar name={member.user.name} src={member.user.avatarUrl} />
            {/if}
            <div class="member-info">
              <span class="member-name">{member.invitePending ? member.user.email : member.user.name}</span>
              <span class="member-email">{member.invitePending ? t().workspace.settings.inviteSentSub : member.user.email}</span>
              <span class="pills">
                {#if member.role === 'owner'}
                  <span class="pill owner">{ROLE_LABELS[locale()].owner}</span>
                {:else}
                  {#if member.invitePending}<span class="pill open">{t().workspace.settings.invitePending}</span>{/if}
                  {#each member.roles as r}
                    <span class="pill">{ROLE_LABELS[locale()][r as ProjectRole] || r}</span>
                  {/each}
                {/if}
              </span>
            </div>
            {#if role === 'owner' && member.role !== 'owner'}
              {@const who = member.invitePending ? member.user.email : member.user.name}
              <button type="button" class="more" title={t().workspace.settings.editMember(who)} aria-label={t().workspace.settings.editMember(who)} onclick={() => editMember(member)}>
                <Icon name="more" size={16} />
              </button>
            {/if}
          </li>
        {/each}
      </ul>

      <!-- Invite -->
      {#if roles.includes('owner') || roles.includes('management')}
        <form class="invite-form" onsubmit={(e) => { e.preventDefault(); inviteMember(); }}>
          <h3>{t().workspace.settings.inviteTitle}</h3>
          <div class="invite-field">
            <Input type="email" bind:value={inviteEmail} placeholder={t().workspace.settings.emailPlaceholder} />
            <Button type="submit" loading={inviting} disabled={!inviteEmail.trim()}>{t().common.invite}</Button>
          </div>
          {@render roleTiles('invite', inviteRoles, (r) => (inviteRoles = toggled(inviteRoles, r)))}
        </form>
      {/if}
    </section>

    <!-- Achtung-Zone -->
    {#if role === 'owner'}
      <section class="section danger-zone">
        <h2>{t().workspace.settings.danger}</h2>
        <div class="danger-content">
          <div>
            <strong>{t().workspace.settings.archiveTitle}</strong>
            <p>{t().workspace.settings.archiveText}</p>
          </div>
          <Button variant="danger" onclick={() => showArchiveModal = true}>{t().workspace.settings.archive}</Button>
        </div>
      </section>
    {/if}
  {/if}
</div>

{#snippet roleTiles(id: string, selected: string[], toggle: (r: string) => void)}
  <div class="roles-block">
    <span class="roles-label" id="{id}-roles">{t().workspace.settings.rolesHeading}</span>
    <div class="role-tiles" role="group" aria-labelledby="{id}-roles">
      {#each assignableRoles as r}
        {@const on = selected.includes(r)}
        <button
          type="button"
          class="tile"
          class:on
          aria-pressed={on}
          aria-label={ROLE_LABELS[locale()][r]}
          aria-describedby="{id}-hint-{r}"
          disabled={on && selected.length === 1}
          onclick={() => toggle(r)}
        >
          <span class="tile-name">{ROLE_LABELS[locale()][r]}</span>
          <small id="{id}-hint-{r}">{t().workspace.settings.roleHints[r as Exclude<ProjectRole, 'owner'>]}</small>
        </button>
      {/each}
    </div>
    <small class="roles-note">{t().workspace.settings.rolesNote}</small>
  </div>
{/snippet}

<Modal bind:open={editOpen} title={editing ? t().workspace.settings.editMember(editing.invitePending ? editing.user.email : editing.user.name) : ''}>
  {#if editing}
    {@const member = editing}
    {@render roleTiles('member', member.roles, (r) => updateRoles(member.id, toggled(member.roles, r)))}
    <button type="button" class="remove-member" onclick={() => removeMember(member)}>
      <Icon name="trash" size={14} /> {t().workspace.settings.removeFromProject}
    </button>
  {/if}
  {#snippet actions()}
    <Button onclick={() => (editOpen = false)}>{t().common.close}</Button>
  {/snippet}
</Modal>

<Modal bind:open={showArchiveModal} title={t().workspace.settings.archiveTitle}>
  <p>{t().workspace.settings.archiveConfirmBefore}<strong>{project?.name}</strong>{t().workspace.settings.archiveConfirmAfter}</p>
  {#snippet actions()}
    <Button variant="secondary" onclick={() => showArchiveModal = false}>{t().common.cancel}</Button>
    <Button variant="danger" onclick={archiveProject}>{t().workspace.settings.archive}</Button>
  {/snippet}
</Modal>

<style>
  .settings-page {
    max-width: 720px;
    padding: var(--space-6);
  }
  @media (max-width: 640px) {
    .settings-page {
      padding: var(--space-4);
    }
    .section {
      padding: var(--space-4);
    }
  }

  header {
    margin-bottom: var(--space-8);
  }

  h1 {
    margin: 0;
    font-size: var(--text-2xl);
  }

  .section {
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    margin-bottom: var(--space-6);
  }

  h2 {
    margin: 0 0 var(--space-4);
    font-size: var(--text-lg);
  }

  form,
  .details-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;
  }
  .cover-row {
    display: flex;
    gap: var(--space-6);
    align-items: flex-start;
  }
  .cover-row .details-form {
    flex: 1;
  }
  @media (max-width: 600px) {
    .cover-row {
      flex-direction: column;
    }
  }

  .details-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .details-text strong {
    font-size: var(--text-lg);
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
  .details-artist {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .details-text p {
    margin: var(--space-1) 0 0;
    color: var(--color-text-secondary);
    white-space: pre-line;
  }

  form :global(.input-group) {
    width: 100%;
  }

  .textarea-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }

  textarea {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-size: var(--text-base);
    font-family: inherit;
    resize: vertical;
  }

  textarea:focus {
    outline: none;
    border-color: var(--color-border-focus);
  }

  /* Members */
  h2 .count {
    margin-left: var(--space-1);
    font-family: var(--font-body, inherit);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-tertiary);
  }

  .member-list {
    list-style: none;
    margin: 0 0 var(--space-6);
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .member-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--color-border);
  }
  .member-row:first-child {
    border-top: none;
  }

  .pending-avatar {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    border: 1px dashed var(--color-text-tertiary);
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }

  .member-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .member-name {
    color: var(--color-text-primary);
    font-weight: 500;
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .member-email {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .pill {
    font-size: var(--text-xs);
    padding: 1px 8px;
    border-radius: var(--radius-full);
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
  }
  .pill.owner {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    color: var(--color-accent);
  }
  .pill.open {
    background: none;
    border: 1px dashed var(--color-text-tertiary);
    color: var(--color-text-tertiary);
  }

  .more {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .more:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-hover);
  }

  /* Several roles per person, each says what it may do */
  .roles-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }
  .roles-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-tertiary);
  }
  .role-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-2);
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-height: 44px;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .tile-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }
  .tile small {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .tile:hover {
    border-color: var(--color-border-hover);
  }
  .tile.on {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    border-color: var(--color-accent);
  }
  .tile.on small {
    color: var(--color-text-secondary);
  }
  .tile:disabled {
    cursor: default;
  }
  .roles-note {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .invite-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: stretch;
    padding-top: var(--space-5);
    border-top: 1px solid var(--color-border);
  }
  .invite-form h3 {
    margin: 0;
    font-size: var(--text-base);
  }
  .invite-field {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
  }
  .invite-field :global(.input-group) {
    flex: 1;
  }

  .remove-member {
    margin-top: var(--space-5);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 40px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--color-error) 40%, transparent);
    background: none;
    color: var(--color-error);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .remove-member:hover {
    background: color-mix(in srgb, var(--color-error) 10%, transparent);
  }

  /* Danger Zone */
  .danger-zone {
    border-color: color-mix(in srgb, var(--color-error) 30%, transparent);
  }

  .danger-zone h2 {
    color: var(--color-error);
  }

  .danger-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
  }

  .danger-content p {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
</style>
