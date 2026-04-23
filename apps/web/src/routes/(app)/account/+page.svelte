<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import { pushStore, initPush, subscribePush, unsubscribePush } from '$lib/stores/push.js';

  let name = $state('');
  let saving = $state(false);

  onMount(() => initPush());

  $effect(() => {
    if ($user && !name) name = $user.name;
  });

  async function save() {
    if (!name.trim()) return;
    saving = true;
    try {
      const res = await api.patch<{ user: typeof $user }>('/auth/me', { name: name.trim() });
      user.set(res.user);
      toastSuccess('Profil gespeichert');
    } finally {
      saving = false;
    }
  }
</script>

<TopBar crumbs={[{ label: 'Konto' }]} />

<div class="page">
  <header>
    <h1>Konto</h1>
    <p class="sub">Dein Profil — sichtbar für andere im Projekt.</p>
  </header>

  {#if pushStore.state !== 'unsupported'}
    <section class="card">
      <h2>Benachrichtigungen</h2>
      {#if pushStore.state === 'denied'}
        <p class="push-hint">Push-Benachrichtigungen wurden im Browser blockiert. Bitte in den Browser-Einstellungen erlauben.</p>
      {:else if pushStore.state === 'subscribed'}
        <div class="push-row">
          <span class="push-active">Push-Benachrichtigungen aktiv</span>
          <Button size="sm" variant="ghost" onclick={unsubscribePush} loading={pushStore.loading}>Deaktivieren</Button>
        </div>
      {:else}
        <div class="push-row">
          <span class="push-desc">Werde benachrichtigt wenn neue Versionen hochgeladen oder freigegeben werden.</span>
          <Button size="sm" onclick={subscribePush} loading={pushStore.loading}>Aktivieren</Button>
        </div>
      {/if}
    </section>
  {/if}

  {#if $user}
    <section class="card">
      <h2>Profil</h2>
      <div class="profile-row">
        <Avatar name={$user.name} src={$user.avatarUrl ?? null} size="lg" />
        <div class="form">
          <Input label="Anzeige-Name" bind:value={name} />
          <p class="email-line">E-Mail: <span>{$user.email}</span></p>
          <Button onclick={save} loading={saving} disabled={!name.trim() || name === $user.name}>
            Speichern
          </Button>
        </div>
      </div>
    </section>
  {/if}
</div>

<style>
  .page {
    padding: var(--space-6);
    max-width: 720px;
  }
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4);
    }
    .profile-row {
      flex-direction: column;
      align-items: stretch;
    }
  }
  header {
    margin-bottom: var(--space-8);
  }
  h1 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-2xl);
  }
  .sub {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }
  .card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }
  h2 {
    margin: 0 0 var(--space-5);
    font-size: var(--text-lg);
  }
  .profile-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-5);
  }
  .form {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;
  }
  .form :global(.input-group) {
    width: 100%;
  }
  .email-line {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }
  .email-line span {
    color: var(--color-text-primary);
    font-family: var(--font-mono);
  }
  .push-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .push-active {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    flex: 1;
  }
  .push-desc {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    flex: 1;
  }
  .push-hint {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }
  .card + .card {
    margin-top: var(--space-5);
  }
</style>
