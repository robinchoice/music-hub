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
      error = err instanceof Error ? err.message : 'Something went wrong';
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-page">
  <div class="login-card">
    <h1>Music Hub</h1>
    <p class="subtitle">Collaboration for music production</p>

    {#if sent}
      <div class="success">
        <p>Check your email for the login link.</p>
        <Button variant="secondary" onclick={() => { sent = false; email = ''; }}>Try again</Button>
      </div>
    {:else}
      <form onsubmit={handleSubmit}>
        <Input type="email" bind:value={email} placeholder="your@email.com" {error} />
        <Button type="submit" size="lg" {loading}>Send Login Link</Button>
      </form>
    {/if}
  </div>
</div>

<style>
  .login-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: var(--space-4);
  }

  .login-card {
    background: var(--color-bg-overlay);
    border-radius: var(--radius-lg);
    padding: var(--space-10);
    width: 100%;
    max-width: 400px;
    text-align: center;
    border: 1px solid var(--color-border);
  }

  h1 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-2xl);
  }

  .subtitle {
    color: var(--color-text-tertiary);
    margin: 0 0 var(--space-8);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .success p {
    color: var(--color-success);
    margin-bottom: var(--space-4);
  }
</style>
