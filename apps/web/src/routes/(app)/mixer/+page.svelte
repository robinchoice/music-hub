<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { overviewIndex, loadOverview } from '$lib/stores/overview.js';
  import { trackHref } from '$lib/utils/overview.js';

  // Old links /mixer?track=…&v=… open "Vergleichen" on the track page
  onMount(async () => {
    await loadOverview();
    const params = $page.url.searchParams;
    const track = get(overviewIndex)?.tracks.get(params.get('track') ?? '');
    void goto(track ? `${trackHref(track.projectId, track.id, params.get('v'))}${params.get('v') ? '&' : '?'}view=compare` : '/dashboard', {
      replaceState: true,
    });
  });
</script>
