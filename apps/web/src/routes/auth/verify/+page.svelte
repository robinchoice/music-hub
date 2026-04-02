<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { verifyToken } from '$lib/stores/auth.js';

  let error = $state('');

  onMount(async () => {
    const token = $page.url.searchParams.get('token');
    if (!token) {
      error = 'No token provided';
      return;
    }
    try {
      await verifyToken(token);
      goto('/dashboard');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Verification failed';
    }
  });
</script>

<div class="verify-page">
  {#if error}
    <div class="error-card">
      <h2>Login Failed</h2>
      <p>{error}</p>
      <a href="/">Try again</a>
    </div>
  {:else}
    <p>Verifying...</p>
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
