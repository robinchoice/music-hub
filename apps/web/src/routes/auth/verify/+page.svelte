<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { verifyToken } from '$lib/stores/auth.js';

  let error = $state('');

  onMount(async () => {
    const token = $page.url.searchParams.get('token');
    if (!token) {
      error = 'Kein Token angegeben';
      return;
    }
    try {
      await verifyToken(token);
      goto('/dashboard');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Login fehlgeschlagen';
    }
  });
</script>

<div class="verify-page">
  {#if error}
    <div class="error-card">
      <h2>Login fehlgeschlagen</h2>
      <p>{error}</p>
      <a href="/login">Erneut versuchen</a>
    </div>
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
</style>
