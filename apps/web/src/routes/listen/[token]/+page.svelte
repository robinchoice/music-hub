<script lang="ts">
  import { page } from '$app/stores';
  import ListenTrack from '$lib/components/listen/ListenTrack.svelte';
  import PleasanceFooter from '$lib/components/PleasanceFooter.svelte';
  import Tile from '$lib/components/ui/Tile.svelte';

  const token = ($page.params as Record<string, string>).token;
  let title = $state('Music Hub');
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

<div class="shell">
  <div class="listen-page">
    <a class="sender" href="/"><Tile size={26} /> Music Hub</a>
    <ListenTrack {token} onLoad={(d) => (title = `${d.track.name} — ${d.project.name}`)} />
    <p class="legal"><a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></p>
  </div>
  <PleasanceFooter />
</div>

<style>
  .listen-page {
    flex: 1;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .sender {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    align-self: flex-start;
    color: var(--color-text-primary);
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    font-stretch: 76%;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .sender:hover {
    color: var(--color-text-primary);
  }
  .legal {
    margin: var(--space-4) 0 0;
    text-align: center;
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
