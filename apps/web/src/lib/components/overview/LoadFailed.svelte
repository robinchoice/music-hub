<script lang="ts">
  import { t } from '$lib/i18n/index.js';
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { loadOverview } from '$lib/stores/overview.js';
</script>

<EmptyState title={t().overview.loadFailed.title} description={t().overview.loadFailed.text}>
  {#snippet action()}
    <Button onclick={() => loadOverview(true)}>{t().common.retry}</Button>
  {/snippet}
</EmptyState>
