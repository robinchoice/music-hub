<script lang="ts">
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/auth.js';

  let { children } = $props();

  // The API refuses everyone else anyway; this only spares them an empty page
  $effect(() => {
    if ($user && !$user.isAdmin) goto('/dashboard', { replaceState: true });
  });
</script>

{#if $user?.isAdmin}
  {@render children()}
{/if}
