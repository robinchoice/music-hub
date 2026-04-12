<script lang="ts">
  import { goto } from '$app/navigation';
  import { user, login, sendMagicLink } from '$lib/stores/auth.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';

  let tab = $state<'password' | 'magic'>('password');

  // Password
  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state('');

  // Magic Link
  let magicEmail = $state('');
  let magicSent = $state(false);
  let magicLoading = $state(false);
  let magicError = $state('');

  $effect(() => {
    if ($user) goto('/dashboard');
  });

  async function handleLogin(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;
    try {
      await login(email, password);
      goto('/dashboard');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Login fehlgeschlagen';
    } finally {
      loading = false;
    }
  }

  async function handleMagicLink(e: Event) {
    e.preventDefault();
    magicError = '';
    magicLoading = true;
    try {
      await sendMagicLink(magicEmail);
      magicSent = true;
    } catch (err) {
      magicError = err instanceof Error ? err.message : 'Fehler beim Senden';
    } finally {
      magicLoading = false;
    }
  }
</script>

<div class="login-page">
  <a href="/" class="back">← Zurück</a>

  <div class="card">
    <p class="brand">Music Hub</p>
    <h1>Einloggen</h1>

    <div class="tabs">
      <button class:active={tab === 'password'} onclick={() => (tab = 'password')}>Passwort</button>
      <button class:active={tab === 'magic'} onclick={() => (tab = 'magic')}>Magic Link</button>
    </div>

    {#if tab === 'password'}
      <form onsubmit={handleLogin}>
        <Input type="email" bind:value={email} placeholder="deine@email.de" label="E-Mail" />
        <Input type="password" bind:value={password} placeholder="Dein Passwort" label="Passwort" />
        {#if error}
          <p class="error">{error}</p>
        {/if}
        <Button type="submit" size="lg" {loading} disabled={!email || !password}>
          Einloggen
        </Button>
      </form>
    {:else}
      {#if magicSent}
        <div class="success">
          <p>Check deine E-Mails — der Link ist unterwegs.</p>
          <Button variant="secondary" onclick={() => { magicSent = false; magicEmail = ''; }}>
            Andere Adresse
          </Button>
        </div>
      {:else}
        <form onsubmit={handleMagicLink}>
          <p class="hint">Kein Passwort? Wir schicken dir einen Login-Link per E-Mail.</p>
          <Input type="email" bind:value={magicEmail} placeholder="deine@email.de" label="E-Mail" error={magicError} />
          <Button type="submit" size="lg" loading={magicLoading}>
            Login-Link senden
          </Button>
        </form>
      {/if}
    {/if}

    <p class="switch">Noch kein Konto? <a href="/register">Registrieren</a></p>
  </div>
</div>

<style>
  .login-page {
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
    max-width: 420px;
  }

  .brand {
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: var(--text-xs);
    margin: 0 0 var(--space-2);
  }
  h1 {
    margin: 0 0 var(--space-5);
    font-size: var(--text-2xl);
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: var(--space-5);
  }
  .tabs button {
    flex: 1;
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    padding: var(--space-3) var(--space-2);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: all var(--transition-fast);
  }
  .tabs button:hover {
    color: var(--color-text-primary);
  }
  .tabs button.active {
    color: var(--color-text-primary);
    border-bottom-color: var(--color-accent);
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
  .hint {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }
  .success p {
    color: var(--color-text-primary);
    margin-bottom: var(--space-4);
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
