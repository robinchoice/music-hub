<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { safeNextPath } from '@music-hub/shared';
  import { t } from '$lib/i18n/index.js';
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
      error = t().guest.verify.noToken;
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
      error = err instanceof Error ? err.message : t().guest.verify.loginFailed;
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
      const message = err instanceof Error ? err.message : t().guest.verify.confirmFailed;
      // Only a wrong password can be fixed here
      if ((err as { status?: number }).status === 401) {
        passwordError = message;
        return;
      }
      // Opened the link a second time after confirming it
      await checkAuth();
      if ($user) {
        goto('/dashboard');
        return;
      }
      error = message;
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
        {#if isRegistration}
          <h2>{t().guest.verify.registrationIncomplete}</h2>
          <p>{error}</p>
          <a href="/register">{t().guest.verify.registerAgain}</a>
        {:else}
          <h2>{t().guest.verify.loginFailed}</h2>
          <p>{error}</p>
          <a href={`/login?tab=magic${next ? `&next=${encodeURIComponent(next)}` : ''}`}>{t().guest.verify.requestNewLink}</a>
        {/if}
      </div>
    {:else if isRegistration}
      <form class="card" onsubmit={confirmRegistration}>
        <p class="brand"><Tile size={36} /> Music Hub</p>
        <h1>{t().guest.verify.finishRegistration}</h1>
        <p class="hint">{t().guest.verify.lastStep}</p>
        <Input type="password" bind:value={password} label={t().common.password} placeholder={t().guest.verify.passwordPlaceholder} error={passwordError} />
        <Button type="submit" size="lg" {loading} disabled={!password}>{t().guest.verify.confirm}</Button>
      </form>
    {:else}
      <p>{t().guest.verify.loggingIn}</p>
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
