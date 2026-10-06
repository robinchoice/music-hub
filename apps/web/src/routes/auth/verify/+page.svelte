<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { safeNextPath } from '@music-hub/shared';
  import { user, checkAuth, verifyToken } from '$lib/stores/auth.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';

  const token = $page.url.searchParams.get('token');
  const isRegistration = $page.url.searchParams.has('register');
  const next = safeNextPath($page.url.searchParams.get('next'));

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
      goto(next ?? '/dashboard');
    } catch (err) {
      // Links are single-use. Someone opening their invite again is usually
      // still logged in, so take them where the link points.
      await checkAuth();
      if ($user) {
        goto(next ?? '/dashboard');
        return;
      }
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
  import PleasanceFooter from '$lib/components/PleasanceFooter.svelte';
  import Tile from '$lib/components/ui/Tile.svelte';
</script>

<div class="shell">
  <div class="verify-page">
    {#if error}
      <div class="error-card">
        <h2>Login fehlgeschlagen</h2>
        <p>{error}</p>
        <a href={`/login?tab=magic${next ? `&next=${encodeURIComponent(next)}` : ''}`}>Neuen Login-Link anfordern</a>
      </div>
    {:else if isRegistration}
      <form class="card" onsubmit={confirmRegistration}>
        <p class="brand"><Tile size={36} /> Music Hub</p>
        <h1>Registrierung abschließen</h1>
        <p class="hint">Gib zur Bestätigung das Passwort ein, das du bei der Registrierung gewählt hast.</p>
        <Input type="password" bind:value={password} label="Passwort" placeholder="Dein Passwort" error={passwordError} />
        <Button type="submit" size="lg" {loading} disabled={!password}>Bestätigen</Button>
      </form>
    {:else}
      <p>Login läuft…</p>
    {/if}
  </div>
  <PleasanceFooter />
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .verify-page {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: var(--space-8) var(--space-4);
    color: var(--color-text-secondary);
  }

  .error-card {
    text-align: center;
  }

  .error-card h2 {
    color: var(--color-error);
  }

  a {
    color: var(--color-accent);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    background: var(--color-bg-overlay);
    border-radius: var(--radius-lg);
    padding: var(--space-10);
    border: 1px solid var(--color-border);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    width: 100%;
    max-width: 420px;
    color: var(--color-text-primary);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 var(--space-6);
    color: var(--color-text-primary);
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 800;
    font-stretch: 76%;
    letter-spacing: -0.02em;
    line-height: 1;
  }

  h1 {
    margin: 0;
    font-size: 2.75rem;
  }

  .hint {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }
</style>
