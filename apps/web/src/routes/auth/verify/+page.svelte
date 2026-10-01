<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { verifyToken } from '$lib/stores/auth.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';

  const token = $page.url.searchParams.get('token');
  const isRegistration = $page.url.searchParams.has('register');

  let error = $state('');
  let password = $state('');
  let passwordError = $state('');
  let loading = $state(false);

  onMount(async () => {
    if (!token) {
      error = 'Kein Token angegeben';
      return;
    }
    if (isRegistration) return;
    try {
      await verifyToken(token);
      goto('/dashboard');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Login fehlgeschlagen';
    }
  });

  async function confirmRegistration(e: Event) {
    e.preventDefault();
    passwordError = '';
    loading = true;
    try {
      await verifyToken(token!, password);
      goto('/dashboard');
    } catch (err) {
      passwordError = err instanceof Error ? err.message : 'Bestätigung fehlgeschlagen';
    } finally {
      loading = false;
    }
  }
</script>

<div class="verify-page">
  {#if error}
    <div class="error-card">
      <h2>Login fehlgeschlagen</h2>
      <p>{error}</p>
      <a href="/login">Erneut versuchen</a>
    </div>
  {:else if isRegistration}
    <form class="card" onsubmit={confirmRegistration}>
      <p class="brand">Music Hub</p>
      <h1>Registrierung abschließen</h1>
      <p class="hint">Gib zur Bestätigung das Passwort ein, das du bei der Registrierung gewählt hast.</p>
      <Input type="password" bind:value={password} label="Passwort" placeholder="Dein Passwort" error={passwordError} />
      <Button type="submit" size="lg" {loading} disabled={!password}>Bestätigen</Button>
    </form>
  {:else}
    <p>Login läuft…</p>
  {/if}
</div>

<style>
  .verify-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: var(--space-8) var(--space-4);
    color: #888;
  }

  .error-card {
    text-align: center;
  }

  .error-card h2 {
    color: #ef4444;
  }

  a {
    color: #6366f1;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    background: var(--color-bg-overlay);
    border-radius: var(--radius-lg);
    padding: var(--space-10);
    border: 1px solid var(--color-border);
    box-shadow: 0 20px 60px rgba(244, 63, 94, 0.08);
    width: 100%;
    max-width: 420px;
    color: var(--color-text-primary);
  }

  .brand {
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: var(--text-xs);
    margin: 0;
  }

  h1 {
    margin: 0;
    font-size: var(--text-2xl);
  }

  .hint {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }
</style>
