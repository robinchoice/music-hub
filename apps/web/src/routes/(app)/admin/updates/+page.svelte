<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { type UpdateContent, type UpdateSummary, updateComplete } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { user } from '$lib/stores/auth.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';

  // Agents write drafts as updates/<slug>.md, the API imports them on start.
  // Only admins from ADMIN_EMAILS send, see README „Update-Mails“.
  let list = $state<UpdateSummary[]>([]);
  let subscribers = $state(0);
  let selectedId = $state<string | null>(null);
  // The draft being edited, features as one line each
  let title = $state('');
  let features = $state('');
  let image = $state<string | null | undefined>(undefined);
  let busy = $state('');
  let confirming = $state(false);
  let previewKey = $state(0);
  let poll: ReturnType<typeof setInterval> | undefined;

  const selected = $derived(list.find((update) => update.id === selectedId));
  const drafts = $derived(list.filter((update) => !update.sentAt));
  const sent = $derived(list.filter((update) => update.sentAt));
  const content = $derived<UpdateContent>({
    title,
    features: features
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  });
  const date = (iso: string) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
  const total = (update: UpdateSummary) => update.sent + update.failed + update.pending;

  async function load() {
    const res = await api.get<{ updates: UpdateSummary[]; subscribers: number }>('/updates');
    list = res.updates;
    subscribers = res.subscribers;
    if (!selected && list[0]) select(list[0]);
    // The API sends in the background, the numbers follow it
    if (list.some((update) => update.pending > 0)) poll ??= setInterval(refresh, 3000);
    else {
      clearInterval(poll);
      poll = undefined;
    }
  }

  async function refresh() {
    await load().catch(() => {});
  }

  function select(update: UpdateSummary) {
    selectedId = update.id;
    title = update.content.title;
    features = update.content.features.join('\n');
    image = undefined;
    confirming = false;
  }

  async function run(name: string, action: () => Promise<void>) {
    busy = name;
    try {
      await action();
    } catch {
      // The API client already shows the error as a toast
    } finally {
      busy = '';
    }
  }

  const create = () =>
    run('create', async () => {
      const { update } = await api.post<{ update: UpdateSummary }>('/updates', { content: { title: '', features: [] } });
      list = [update, ...list];
      select(update);
    });

  // Actions keep the id they started with, the list stays locked while they run
  async function save(id: string) {
    const { update } = await api.put<{ update: UpdateSummary }>(`/updates/${id}`, { content, image });
    list = list.map((item) => (item.id === update.id ? update : item));
    image = undefined;
    previewKey++;
  }

  const saveDraft = () =>
    run('save', async () => {
      await save(selectedId!);
      toastSuccess('Gespeichert');
    });
  const testMail = () =>
    run('test', async () => {
      const id = selectedId!;
      if (!selected?.sentAt) await save(id);
      await api.post(`/updates/${id}/test`);
      toastSuccess(`Testmail an ${$user?.email} gesendet`);
    });
  const send = () =>
    run('send', async () => {
      const id = selectedId!;
      await save(id);
      await api.post(`/updates/${id}/send`);
      confirming = false;
      await load();
    });
  const remove = () =>
    run('delete', async () => {
      const id = selectedId!;
      await api.delete(`/updates/${id}`);
      list = list.filter((item) => item.id !== id);
      selectedId = null;
      if (list[0]) select(list[0]);
    });

  function pickImage(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      image = String(reader.result).split(',')[1];
    };
    reader.readAsDataURL(file);
  }

  onMount(refresh);
  onDestroy(() => clearInterval(poll));
</script>

<TopBar crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Updates' }]} />

<div class="page">
  <p class="intro">
    Mails zu neuen Funktionen an alle mit Opt-in, gerade {subscribers === 1 ? '1 Person' : `${subscribers} Personen`}.
    Agenten legen Entwürfe als Datei in <code>updates/</code> an, senden kannst nur du.
  </p>
  <div class="layout">
    <nav>
      <Button onclick={create} loading={busy === 'create'}>Neues Update</Button>
      {#each [['Entwürfe', drafts], ['Versendet', sent]] as const as [heading, items] (heading)}
        {#if items.length}
          <h3>{heading}</h3>
          {#each items as update (update.id)}
            <button type="button" class="item" class:on={update.id === selectedId} disabled={!!busy} onclick={() => select(update)}>
              <strong>{update.content.title || 'Ohne Titel'}</strong>
              <small>{update.sentAt ? date(update.sentAt) : update.slug ? `aus updates/${update.slug}.md` : date(update.createdAt)}</small>
            </button>
          {/each}
        {/if}
      {/each}
      {#if !list.length}<p class="muted">Noch keine Updates.</p>{/if}
    </nav>

    {#if selected}
      <section>
        {#if selected.sentAt}
          <p>Versendet am {date(selected.sentAt)} · {total(selected)} Empfänger · {selected.failed} Fehler</p>
          {#if selected.pending}
            <progress max={total(selected)} value={selected.sent + selected.failed}></progress>
            <p class="muted">{selected.sent + selected.failed} von {total(selected)} versendet</p>
          {/if}
          <p class="muted">Versendete Updates lassen sich nicht mehr ändern.</p>
        {:else}
          <div class="form">
            <Input label="Titel" bind:value={title} />
            <label>
              <span>Features, eins pro Zeile</span>
              <textarea rows="5" bind:value={features}></textarea>
            </label>
            <div class="image">
              <span>Bild (optional)</span>
              {#if image === undefined ? selected.hasImage : image}
                <img src={image ? `data:image/png;base64,${image}` : `/api/v1/updates/${selected.id}/image?v=${previewKey}`} alt="" />
                <Button variant="secondary" size="sm" onclick={() => (image = null)}>Bild entfernen</Button>
              {:else}
                <input type="file" accept="image/png,image/jpeg" aria-label="Bild wählen" onchange={pickImage} />
              {/if}
            </div>
          </div>
        {/if}

        <div class="actions">
          {#if !selected.sentAt}
            <Button variant="secondary" onclick={saveDraft} loading={busy === 'save'}>Speichern</Button>
          {/if}
          <Button variant="secondary" onclick={testMail} loading={busy === 'test'}>Testmail an mich</Button>
          {#if !selected.sentAt}
            <Button variant="ghost" onclick={remove} loading={busy === 'delete'}>Entwurf löschen</Button>
            <span class="spacer"></span>
            <Button onclick={() => (confirming = true)} disabled={!updateComplete(content) || !subscribers}>
              An {subscribers} senden
            </Button>
          {/if}
        </div>
        {#if !selected.sentAt && !updateComplete(content)}
          <p class="muted">Zum Senden braucht das Update einen Titel und ein Feature.</p>
        {/if}
        {#if confirming}
          <div class="confirm">
            <strong>{subscribers} Mails an alle mit Opt-in senden?</strong>
            <p>Der Versand läuft gedrosselt im Hintergrund, die Seite darf zu. Danach lässt sich das Update nicht mehr ändern.</p>
            <div class="actions">
              <Button onclick={send} loading={busy === 'send'}>Jetzt senden</Button>
              <Button variant="secondary" onclick={() => (confirming = false)}>Abbrechen</Button>
            </div>
          </div>
        {/if}

        <h3>Vorschau</h3>
        {#key `${selected.id}-${previewKey}`}
          <iframe title="Vorschau" src="/api/v1/updates/{selected.id}/preview"></iframe>
        {/key}
      </section>
    {/if}
  </div>
</div>

<style>
  .page {
    padding: var(--space-6);
    max-width: 1080px;
  }
  .intro,
  .muted {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .intro {
    margin: 0 0 var(--space-5);
  }
  .layout {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: var(--space-6);
    align-items: start;
  }
  @media (max-width: 760px) {
    .page {
      padding: var(--space-4);
    }
    .layout {
      grid-template-columns: 1fr;
    }
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  h3 {
    margin: var(--space-4) 0 var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .item {
    display: flex;
    flex-direction: column;
    padding: 0.55rem 0.7rem;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .item.on {
    border-color: var(--color-border);
    background: var(--color-bg-raised);
  }
  .item small {
    color: var(--color-text-tertiary);
  }
  section {
    padding: var(--space-5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-overlay);
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  label,
  .image {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }
  label span,
  .image span {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-secondary);
  }
  textarea {
    width: 100%;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    font: inherit;
  }
  textarea:focus {
    outline: 2px solid var(--color-accent);
    outline-offset: -1px;
  }
  .image img {
    max-width: 240px;
    border-radius: var(--radius-md);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }
  .spacer {
    flex: 1;
  }
  .confirm {
    margin-top: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-md);
  }
  .confirm p {
    margin: var(--space-1) 0 0;
    color: var(--color-text-secondary);
  }
  .confirm .actions {
    margin-top: var(--space-3);
  }
  progress {
    width: 100%;
    accent-color: var(--color-accent);
  }
  iframe {
    width: 100%;
    height: 760px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: #0a0910;
  }
</style>
