<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import { ROLE_LABELS, PROJECT_ROLES } from '@music-hub/shared';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';

  type Member = {
    id: string;
    role: string;
    user: { id: string; email: string; name: string; avatarUrl: string | null };
  };

  type Project = { id: string; name: string; description: string | null };

  const projectId = $page.params.projectId!;

  let project = $state<Project | null>(null);
  let members = $state<Member[]>([]);
  let role = $state('');
  let loading = $state(true);

  // Edit project
  let editName = $state('');
  let editDesc = $state('');
  let saving = $state(false);

  // Invite
  let inviteEmail = $state('');
  let inviteRole = $state('artist');
  let inviting = $state(false);

  // Archive
  let showArchiveModal = $state(false);

  const assignableRoles = PROJECT_ROLES.filter((r) => r !== 'owner');

  onMount(async () => {
    try {
      const [projectRes, membersRes] = await Promise.all([
        api.get<{ project: Project; role: string }>(`/projects/${projectId}`),
        api.get<{ members: Member[] }>(`/projects/${projectId}/members`),
      ]);
      project = projectRes.project;
      role = projectRes.role;
      editName = project.name;
      editDesc = project.description || '';
      members = membersRes.members;
    } finally {
      loading = false;
    }
  });

  async function saveProject() {
    saving = true;
    try {
      await api.patch(`/projects/${projectId}`, {
        name: editName,
        description: editDesc || undefined,
      });
      toastSuccess('Project updated');
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
        role: inviteRole,
      });
      inviteEmail = '';
      toastSuccess('Member invited');
      const res = await api.get<{ members: Member[] }>(`/projects/${projectId}/members`);
      members = res.members;
    } finally {
      inviting = false;
    }
  }

  async function updateRole(memberId: string, newRole: string) {
    await api.patch(`/projects/${projectId}/members/${memberId}`, { role: newRole });
    toastSuccess('Role updated');
    const res = await api.get<{ members: Member[] }>(`/projects/${projectId}/members`);
    members = res.members;
  }

  async function removeMember(memberId: string) {
    await api.delete(`/projects/${projectId}/members/${memberId}`);
    toastSuccess('Member removed');
    members = members.filter((m) => m.id !== memberId);
  }

  async function archiveProject() {
    await api.delete(`/projects/${projectId}`);
    toastSuccess('Project archived');
    goto('/dashboard');
  }
</script>

<div class="settings-page">
  <header>
    <a href="/projects/{projectId}" class="back">&larr; Back to project</a>
    <h1>Settings</h1>
  </header>

  {#if !loading && project}
    <!-- Project Details -->
    <section class="section">
      <h2>Project Details</h2>
      <form onsubmit={(e) => { e.preventDefault(); saveProject(); }}>
        <Input label="Name" bind:value={editName} />
        <div class="textarea-group">
          <label class="textarea-label">Description</label>
          <textarea bind:value={editDesc} rows="3" placeholder="Project description..."></textarea>
        </div>
        <Button type="submit" loading={saving}>Save</Button>
      </form>
    </section>

    <!-- Members -->
    <section class="section">
      <h2>Members</h2>

      <div class="member-list">
        {#each members as member}
          <div class="member-row">
            <Avatar name={member.user.name} src={member.user.avatarUrl} />
            <div class="member-info">
              <span class="member-name">{member.user.name}</span>
              <span class="member-email">{member.user.email}</span>
            </div>
            {#if member.role === 'owner'}
              <Badge variant="accent">Owner</Badge>
            {:else if role === 'owner'}
              <select
                value={member.role}
                onchange={(e) => updateRole(member.id, (e.target as HTMLSelectElement).value)}
              >
                {#each assignableRoles as r}
                  <option value={r} selected={r === member.role}>{ROLE_LABELS[r]}</option>
                {/each}
              </select>
              <Button variant="ghost" size="sm" onclick={() => removeMember(member.id)}>
                <span style="color: var(--color-error)">Remove</span>
              </Button>
            {:else}
              <Badge>{ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] || member.role}</Badge>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Invite -->
      {#if role === 'owner' || role === 'management'}
        <form class="invite-form" onsubmit={(e) => { e.preventDefault(); inviteMember(); }}>
          <Input type="email" bind:value={inviteEmail} placeholder="email@example.com" />
          <select bind:value={inviteRole}>
            {#each assignableRoles as r}
              <option value={r}>{ROLE_LABELS[r]}</option>
            {/each}
          </select>
          <Button type="submit" loading={inviting} size="sm">Invite</Button>
        </form>
      {/if}
    </section>

    <!-- Danger Zone -->
    {#if role === 'owner'}
      <section class="section danger-zone">
        <h2>Danger Zone</h2>
        <div class="danger-content">
          <div>
            <strong>Archive this project</strong>
            <p>The project will be hidden from all members.</p>
          </div>
          <Button variant="danger" onclick={() => showArchiveModal = true}>Archive</Button>
        </div>
      </section>
    {/if}
  {/if}
</div>

<Modal bind:open={showArchiveModal} title="Archive Project">
  <p>Are you sure you want to archive <strong>{project?.name}</strong>? This will hide it from all members.</p>
  {#snippet actions()}
    <Button variant="secondary" onclick={() => showArchiveModal = false}>Cancel</Button>
    <Button variant="danger" onclick={archiveProject}>Archive</Button>
  {/snippet}
</Modal>

<style>
  .settings-page {
    max-width: 600px;
    margin: 0 auto;
    padding: var(--space-4);
  }

  header {
    margin-bottom: var(--space-8);
  }

  .back {
    color: var(--color-text-tertiary);
    text-decoration: none;
    font-size: var(--text-sm);
  }

  .back:hover {
    color: var(--color-text-primary);
  }

  h1 {
    margin: var(--space-2) 0 0;
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

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;
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

  .textarea-label {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
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

  select {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-size: var(--text-sm);
    font-family: inherit;
  }

  .invite-form {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    flex-direction: row;
  }

  .invite-form :global(.input-group) {
    flex: 1;
  }

  /* Danger Zone */
  .danger-zone {
    border-color: rgba(239, 68, 68, 0.3);
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
