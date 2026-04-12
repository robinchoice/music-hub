<script lang="ts">
  import { goto } from '$app/navigation';
  import { user, register } from '$lib/stores/auth.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let passwordConfirm = $state('');
  let loading = $state(false);
  let error = $state('');

  $effect(() => {
    if ($user) goto('/dashboard');
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';

    if (password !== passwordConfirm) {
      error = 'Passwörter stimmen nicht überein';
      return;
    }
    if (password.length < 8) {
      error = 'Passwort muss mindestens 8 Zeichen haben';
      return;
    }

    loading = true;
    try {
      await register(name, email, password);
      goto('/dashboard');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Registrierung fehlgeschlagen';
    } finally {
      loading = false;
    }
  }
</script>

<div class="register-page">
  <a href="/" class="back">← Zurück</a>

  <div class="card">
    <p class="brand">Music Hub</p>
    <h1>Konto erstellen</h1>
    <p class="card-sub">Kostenlos. Kein Abo, keine Kreditkarte.</p>

    <form onsubmit={handleSubmit}>
      <Input label="Name" bind:value={name} placeholder="Dein Name" />
      <Input label="E-Mail" type="email" bind:value={email} placeholder="deine@email.de" />
      <Input label="Passwort" type="password" bind:value={password} placeholder="Mindestens 8 Zeichen" />
      <Input label="Passwort wiederholen" type="password" bind:value={passwordConfirm} placeholder="Nochmal eingeben" />

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <Button type="submit" size="lg" {loading} disabled={!name || !email || !password}>
        Registrieren
      </Button>
    </form>

    <p class="switch">Schon ein Konto? <a href="/login">Einloggen</a></p>
  </div>
</div>

<style>
  .register-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: var(--space-8) var(--space-4);
    gap: var(--space-6);
  }

  .back {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    text-decoration: none;
  }
  .back:hover {
    color: var(--color-text-primary);
  }

  .card {
    background: var(--color-bg-overlay);
    border-radius: var(--radius-lg);
    padding: var(--space-10);
    border: 1px solid var(--color-border);
    box-shadow: 0 20px 60px rgba(244, 63, 94, 0.08);
    width: 100%;
    max-width: 440px;
  }

  .brand {
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: var(--text-xs);
    margin: 0 0 var(--space-2);
  }

  h1 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-2xl);
  }

  .card-sub {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0 0 var(--space-6);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .error {
    color: var(--color-error);
    font-size: var(--text-sm);
    margin: 0;
  }

  .switch {
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: var(--space-5) 0 0;
  }
  .switch a {
    color: var(--color-accent);
  }
</style>
