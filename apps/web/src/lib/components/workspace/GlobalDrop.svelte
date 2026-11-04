<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/index.js';
  import { overviewIndex, loadOverview } from '$lib/stores/overview.js';
  import { pendingDrop } from '$lib/stores/pending-drop.js';
  import { UPLOAD_ROLES } from '$lib/utils/overview.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';

  // Files can be dropped anywhere in the app. On a project or a track they go there, elsewhere
  // only the project is asked, preselected with the one used last. Drop zones of a page handle
  // their own drops first (they call preventDefault), this only takes what nobody took.
  const LAST = 'musichub:drop-project';

  let open = $state(false);
  let files = $state<File[]>([]);
  let choice = $state('');
  let over = $state(false);
  let depth = 0;

  const projects = $derived(
    $overviewIndex ? $overviewIndex.data.projects.filter((p) => p.myRoles.some((r) => UPLOAD_ROLES.includes(r))) : [],
  );

  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

  function send(projectId: string, trackId?: string) {
    localStorage.setItem(LAST, projectId);
    pendingDrop.set({ projectId, trackId, files });
    files = [];
    open = false;
    if ($page.url.pathname !== `/projects/${projectId}`) void goto(`/projects/${projectId}`);
  }

  function dragenter(e: DragEvent) {
    if (!hasFiles(e)) return;
    depth++;
    over = true;
  }

  function dragleave(e: DragEvent) {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) over = false;
  }

  function dragover(e: DragEvent) {
    if (hasFiles(e)) e.preventDefault();
  }

  async function drop(e: DragEvent) {
    depth = 0;
    over = false;
    if (e.defaultPrevented || !hasFiles(e)) return;
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (!dropped.length) return;
    files = dropped;
    const { projectId, trackId } = $page.params;
    if (projectId) return send(projectId, trackId);
    if (!$overviewIndex) await loadOverview();
    const last = localStorage.getItem(LAST);
    choice = projects.some((p) => p.id === last) ? last! : projects[0]?.id ?? '';
    open = true;
  }
</script>

<svelte:window ondragenter={dragenter} ondragleave={dragleave} ondragover={dragover} ondrop={drop} />

{#if over && !$page.params.projectId}
  <div class="over" aria-hidden="true"><span>{t().workspace.globalDrop.release}</span></div>
{/if}

<Modal bind:open title={t().workspace.globalDrop.title(files.length)}>
  {#if projects.length}
    <label class="pick">
      <span>{t().workspace.globalDrop.project}</span>
      <select bind:value={choice}>
        {#each projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
    </label>
    <p class="hint">{t().workspace.globalDrop.hint}</p>
  {:else}
    <p class="hint">{t().workspace.globalDrop.noProject}</p>
  {/if}
  {#snippet actions()}
    <Button variant="ghost" onclick={() => { open = false; files = []; }}>{t().common.cancel}</Button>
    {#if projects.length}<Button onclick={() => send(choice)} disabled={!choice}>{t().workspace.globalDrop.upload}</Button>{/if}
  {/snippet}
</Modal>

<style>
  .over {
    position: fixed;
    inset: var(--space-3);
    z-index: 60;
    display: grid;
    place-items: center;
    border: 2px dashed var(--color-accent);
    border-radius: var(--radius-xl);
    background: color-mix(in srgb, var(--color-bg-base) 80%, transparent);
    pointer-events: none;
  }
  .over span {
    font-family: var(--font-display);
    font-size: 1.6rem;
    font-weight: 800;
  }
  .pick {
    display: grid;
    gap: var(--space-1);
  }
  .pick span {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  select {
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-size: 16px;
  }
  .hint {
    margin: var(--space-3) 0 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
</style>
