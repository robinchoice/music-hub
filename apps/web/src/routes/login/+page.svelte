<script lang="ts">
  import { goto } from '$app/navigation';
  import { user, sendMagicLink } from '$lib/stores/auth.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';

  let email = $state('');
  let sent = $state(false);
  let loading = $state(false);
  let error = $state('');

  $effect(() => {
    if ($user) goto('/dashboard');
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;
    try {
      await sendMagicLink(email);
      sent = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Etwas ist schiefgelaufen';
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-page">
  <a href="/" class="back">← Zurück</a>

  <div class="login-card">
    <p class="brand">Music Hub</p>
    <h1>Einloggen</h1>
    <p class="card-sub">Magic Link per E-Mail. Kein Passwort, keine Hürden.</p>

    {#if sent}
      <div class="success">
        <p>📬 Check deine E-Mails — der Link ist unterwegs.</p>
        <Button variant="secondary" onclick={() => { sent = false; email = ''; }}>Andere Adresse</Button>
      </div>
    {:else}
      <form onsubmit={handleSubmit}>
        <Input type="email" bind:value={email} placeholder="deine@email.de" {error} />
        <Button type="submit" size="lg" {loading}>Login-Link senden</Button>
      </form>
    {/if}
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

  .login-card {
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

  .success p {
    color: var(--color-text-primary);
    margin-bottom: var(--space-4);
  }
</style>
