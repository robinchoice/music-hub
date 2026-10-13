<script lang="ts">
  import { goto } from '$app/navigation';
  import { getContext } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import { dropRequest, type ContactRequest } from '$lib/stores/requests.js';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { formatWhen } from '$lib/utils/format.js';

  type Membership = { project: { id: string; name: string }; role: string };

  let { request }: { request: ContactRequest } = $props();
  const reloadSidebar = getContext<(() => void) | undefined>('reloadSidebar');

  let busy = $state<'accept' | 'decline' | 'block' | null>(null);
  let inviteOpen = $state(false);
  let projects = $state<Membership[]>([]);
  let target = $state('');
  let blockOpen = $state(false);
  let report = $state(true);

  async function accept(projectId?: string) {
    busy = 'accept';
    try {
      const res = await api.post<{ projectId: string }>(`/requests/${request.id}/accept`, projectId ? { projectId } : {});
      dropRequest(request.id);
      reloadSidebar?.();
      toastSuccess(`${request.from.name} ist jetzt im Projekt`);
      await goto(`/projects/${res.projectId}`);
    } catch {
      // The API client already showed the error
    } finally {
      busy = null;
    }
  }

  async function chooseProject() {
    const res = await api.get<{ projects: Membership[] }>('/projects');
    projects = res.projects.filter((p) => p.role === 'owner' || p.role === 'management');
    target = projects[0]?.project.id ?? '';
    inviteOpen = true;
  }

  async function decline(block: boolean) {
    busy = block ? 'block' : 'decline';
    try {
      await (block ? api.post(`/requests/${request.id}/block`, { report }) : api.post(`/requests/${request.id}/decline`));
      dropRequest(request.id);
      blockOpen = false;
      toastSuccess(block ? `${request.from.name} kann dir keine Anfragen mehr schicken` : 'Abgelehnt');
    } catch {
      // The API client already showed the error
    } finally {
      busy = null;
    }
  }
</script>

<article class="req">
  <header>
    <Avatar src={request.from.avatarUrl} name={request.from.name} size="lg" />
    <div>
      <p class="who">
        {#if request.from.handle}<a href="/@{request.from.handle}">{request.from.name}</a>{:else}<b>{request.from.name}</b>{/if}
        {#if request.from.bio}<span class="faint"> · {request.from.bio}</span>{/if}
      </p>
      <p class="faint">
        Anfrage{#if request.track}{' zu '}<a href="/offen/{request.track.id}">„{request.track.name}“</a>{/if} · {formatWhen(request.createdAt)}
      </p>
    </div>
  </header>
  <blockquote>{request.message}</blockquote>
  <div class="actions">
    <Button onclick={() => accept()} loading={busy === 'accept'}>Annehmen: gemeinsames Projekt</Button>
    <Button variant="secondary" onclick={chooseProject}>In Projekt einladen…</Button>
    <Button variant="ghost" onclick={() => decline(false)} loading={busy === 'decline'}>Ablehnen</Button>
    <Button variant="ghost" onclick={() => (blockOpen = true)}>Blockieren</Button>
  </div>
</article>

<Modal bind:open={inviteOpen} title="In Projekt einladen">
  <div class="form">
    {#if projects.length}
      <p class="faint">{request.from.name} kommt als Artist dazu, kann hochladen und kommentieren.</p>
      {#each projects as p (p.project.id)}
        <label class="choice"><input type="radio" bind:group={target} value={p.project.id} /> {p.project.name}</label>
      {/each}
    {:else}
      <p class="faint">Du hast noch kein Projekt, in das du einladen darfst. „Annehmen“ legt eins für euch beide an.</p>
    {/if}
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (inviteOpen = false)}>Abbrechen</Button>
    <Button onclick={() => accept(target)} loading={busy === 'accept'} disabled={!target}>Einladen</Button>
  {/snippet}
</Modal>

<Modal bind:open={blockOpen} title="{request.from.name} blockieren?">
  <div class="form">
    <p class="faint">Die Anfrage verschwindet, und {request.from.name} kann dir keine neuen mehr schicken. {request.from.name} erfährt davon nichts.</p>
    <label class="choice"><input type="checkbox" bind:checked={report} /> Auch an die Admins melden, z. B. bei Spam oder Belästigung</label>
  </div>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (blockOpen = false)}>Abbrechen</Button>
    <Button onclick={() => decline(true)} loading={busy === 'block'}>Blockieren</Button>
  {/snippet}
</Modal>

<style>
  .req {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--color-bg-raised);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-border));
    border-radius: var(--radius-lg);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  p {
    margin: 0;
  }
  .who a,
  .who b {
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .faint {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .faint a {
    color: var(--color-text-secondary);
  }
  blockquote {
    margin: 0;
    padding: var(--space-3);
    border-left: 2px solid var(--color-accent);
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    background: var(--color-bg-base);
    font-size: var(--text-sm);
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .choice input {
    accent-color: var(--color-accent);
  }
</style>
