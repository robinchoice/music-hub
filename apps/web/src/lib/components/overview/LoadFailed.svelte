<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { loadOverview } from '$lib/stores/overview.js';
</script>

<EmptyState title="Gerade nicht erreichbar" description="Die Daten ließen sich nicht laden. Prüf deine Verbindung und versuch es noch einmal.">
  {#snippet action()}
    <Button onclick={() => loadOverview(true)}>Erneut versuchen</Button>
  {/snippet}
</EmptyState>
