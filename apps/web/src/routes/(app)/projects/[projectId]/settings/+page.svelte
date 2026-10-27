<script lang="ts">
  import { t, locale } from '$lib/i18n/index.js';
  import { getContext, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api, isApiError } from '$lib/api/client.js';
  import { toast, toastError, toastSuccess } from '$lib/stores/toast.js';
  import { ROLE_LABELS, PROJECT_ROLES, type ProjectRole } from '@music-hub/shared';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import CoverUpload from '$lib/components/ui/CoverUpload.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import { overviewIndex } from '$lib/stores/overview.js';
  import { artistNames, artistToSave } from '$lib/utils/overview.js';
  import ArtistInput from '$lib/components/workspace/ArtistInput.svelte';

  type Member = {
    id: string;
    role: string;
    roles: string[];
    user: { id: string; email: string; name: string; avatarUrl: string | null };
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
      inviteEmail = '';
      toastSuccess(t().workspace.settings.invited);
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
    } catch (e) {
      if (!isApiError(e)) {
        toastError(e instanceof Error ? e.message : t().workspace.settings.rolesFailed);
      }
    }
  }

  async function removeMember(memberId: string) {
    try {
      await api.delete(`/projects/${projectId}/members/${memberId}`);
      toastSuccess(t().workspace.settings.removed);
      members = members.filter((m) => m.id !== memberId);
    } catch (e) {
      if (!isApiError(e)) {
        toastError(e instanceof Error ? e.message : t().workspace.settings.removeFailed);
      }
    }
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

<TopBar
  crumbs={[
    { label: t().workspace.nav.projects, href: '/dashboard' },
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
      <div class="cover-row">
        <CoverUpload currentUrl={project.coverUrl} name={project.name} onChange={saveCover} />
        <form class="details-form" onsubmit={(e) => { e.preventDefault(); saveProject(); }}>
          <ArtistInput bind:value={editArtist} />
          <Input label={t().common.name} bind:value={editName} />
          <label class="textarea-group">
            <span class="input-label">{t().workspace.settings.description}</span>
            <textarea bind:value={editDesc} rows="3" placeholder={t().workspace.settings.descriptionPlaceholder}></textarea>
          </label>
          <Button type="submit" loading={saving}>{t().common.save}</Button>
        </form>
      </div>
    </section>

    <!-- Mitwirkende -->
    <section class="section">
      <h2>{t().workspace.settings.contributors}</h2>

      <div class="member-list">
        {#each members as member}
          <div class="member-row">
            <Avatar name={member.user.name} src={member.user.avatarUrl} />
            <div class="member-info">
              <span class="member-name">{member.user.name}</span>
              <span class="member-email">{member.user.email}</span>
            </div>
            {#if member.role === 'owner'}
              <Badge variant="accent">{ROLE_LABELS[locale()].owner}</Badge>
            {:else if role === 'owner'}
              <Button variant="ghost" size="sm" onclick={() => removeMember(member.id)}>
                <span style="color: var(--color-error)">{t().common.remove}</span>
              </Button>
              {@render roleChips(member.roles, (r) => updateRoles(member.id, toggled(member.roles, r)))}
            {:else}
              {#each member.roles as r}
                <Badge>{ROLE_LABELS[locale()][r as ProjectRole] || r}</Badge>
              {/each}
            {/if}
          </div>
        {/each}
      </div>

      <!-- Invite -->
      {#if roles.includes('owner') || roles.includes('management')}
        <form class="invite-form" onsubmit={(e) => { e.preventDefault(); inviteMember(); }}>
          <Input type="email" bind:value={inviteEmail} placeholder={t().workspace.settings.emailPlaceholder} />
          <Button type="submit" loading={inviting} size="sm">{t().common.invite}</Button>
          {@render roleChips(inviteRoles, (r) => (inviteRoles = toggled(inviteRoles, r)))}
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

{#snippet roleChips(selected: string[], toggle: (r: string) => void)}
  <div class="role-chips" role="group" aria-label={t().workspace.settings.roles}>
    {#each assignableRoles as r}
      {@const on = selected.includes(r)}
      <button
        type="button"
        class="chip"
        class:on
        aria-pressed={on}
        disabled={on && selected.length === 1}
        onclick={() => toggle(r)}
      >{ROLE_LABELS[locale()][r]}</button>
    {/each}
  </div>
{/snippet}

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
  .member-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .member-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-raised);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
  }

  .member-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .member-name {
    color: var(--color-text-primary);
    font-weight: 500;
    font-size: var(--text-sm);
  }

  .member-email {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }

  /* Several roles per person, toggled one by one */
  .role-chips {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .chip {
    height: 30px;
    padding: 0 12px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--color-border-hover);
    color: var(--color-text-primary);
  }
  .chip.on {
    background: var(--color-bg-overlay);
    border-color: var(--color-accent);
    color: var(--color-text-primary);
  }
  .chip:disabled {
    cursor: default;
  }

  .invite-form {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: flex-start;
    flex-direction: row;
  }

  .invite-form :global(.input-group) {
    flex: 1;
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
