<script lang="ts">
  import { goto } from '$app/navigation';
  import { SIGNUP_STORAGE_PER_USER } from '@music-hub/shared';
  import { t } from '$lib/i18n/index.js';
  import { user, register } from '$lib/stores/auth.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import { toastSuccess } from '$lib/stores/toast.js';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let passwordConfirm = $state('');
  // Unticked: update mails are opt-in, see README „Update-Mails“
  let updates = $state(false);
  let loading = $state(false);
  let error = $state('');
  let sent = $state(false);
  let resending = $state(false);

  $effect(() => {
    if ($user) goto('/dashboard');
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';

    if (password !== passwordConfirm) {
      error = t().guest.register.mismatch;
      return;
    }
    if (password.length < 8) {
      error = t().guest.register.tooShort;
      return;
    }

    loading = true;
    try {
      const registered = await register(name, email, password, updates);
      if (registered) goto('/dashboard');
      else sent = true;
    } catch (err) {
      error = err instanceof Error ? err.message : t().guest.register.failed;
    } finally {
      loading = false;
    }
  }
  async function resend() {
    error = '';
    resending = true;
    try {
      await register(name, email, password, updates);
      toastSuccess(t().guest.register.resent);
    } catch (err) {
      error = err instanceof Error ? err.message : t().guest.register.sendFailed;
    } finally {
      resending = false;
    }
  }
  import PleasanceFooter from '$lib/components/PleasanceFooter.svelte';
  import Tile from '$lib/components/ui/Tile.svelte';
</script>

<div class="shell">
  <div class="register-page">
    <a href="/" class="back">← {t().common.back}</a>

    <div class="card">
      <p class="brand"><Tile size={36} /> Music Hub</p>
      <h1>{t().common.signUp}</h1>
      <p class="card-sub">{t().guest.register.sub(SIGNUP_STORAGE_PER_USER / 1024 ** 3)}</p>

      {#if sent}
        <div class="sent">
          <p class="success">
            {t().guest.register.almostBefore} <strong>{email}</strong>{t().guest.register.almostAfter}
          </p>
          <p class="hint">{t().guest.register.linkValid}</p>
          {#if error}
            <p class="error">{error}</p>
          {/if}
          <div class="sent-actions">
            <Button variant="secondary" onclick={resend} loading={resending}>{t().guest.register.resend}</Button>
            <Button variant="ghost" onclick={() => (sent = false)}>{t().guest.register.changeAddress}</Button>
          </div>
        </div>
      {:else}
        <form onsubmit={handleSubmit}>
          <Input label={t().common.name} bind:value={name} placeholder={t().guest.register.namePlaceholder} />
          <Input label={t().common.email} type="email" bind:value={email} placeholder={t().guest.register.emailPlaceholder} />
          <Input label={t().common.password} type="password" bind:value={password} placeholder={t().guest.register.passwordPlaceholder} />
          <Input label={t().guest.register.repeatPassword} type="password" bind:value={passwordConfirm} placeholder={t().guest.register.repeatPlaceholder} />
          <label class="check">
            <input type="checkbox" bind:checked={updates} />
            <span>{t().guest.register.updatesOptIn}</span>
          </label>

          {#if error}
            <p class="error">{error}</p>
          {/if}

          <Button type="submit" size="lg" {loading} disabled={!name || !email || !password}>
            {t().common.signUp}
          </Button>
        </form>
      {/if}

      <p class="switch">{t().guest.register.haveAccount} <a href="/login">{t().common.logIn}</a></p>
    </div>

    <p class="legal"><a href="/impressum">{t().common.imprint}</a> · <a href="/datenschutz">{t().common.privacy}</a></p>
  </div>
  <PleasanceFooter />
</div>

<style>
  .check {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .check input {
    accent-color: var(--color-accent);
    margin-top: 3px;
  }
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .register-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
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
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    width: 100%;
    max-width: 440px;
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
    margin: 0 0 var(--space-1);
    font-size: 2.75rem;
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

  .sent {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .hint {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }

  .sent-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .success {
    color: var(--color-text-primary);
    line-height: 1.55;
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
  .legal {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .legal a {
    color: var(--color-text-tertiary);
  }
  .legal a:hover {
    color: var(--color-text-primary);
  }
</style>
