<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import MiniWave from './MiniWave.svelte';
  import { handOff } from '$lib/stores/listen.js';
  import { firstName, markersFor, trackHref, versionName, type OverviewIndex, type OverviewVersion } from '$lib/utils/overview.js';

  let { ix, version, onclose }: { ix: OverviewIndex; version: OverviewVersion; onclose: () => void } = $props();

  const track = $derived(ix.tracks.get(version.trackId)!);
  const project = $derived(ix.projects.get(track.projectId)!);
  const sub = $derived(
    [`V${version.versionNumber}`, versionName(version), firstName(ix.users.get(version.createdById)?.name ?? 'Jemand')]
      .filter(Boolean)
      .join(' · '),
  );
</script>

<div class="dock">
  <CoverImage src={track.coverUrl ?? project.coverUrl} name={track.name} size="sm" rounded="md" />
  <div class="t">
    <b>{track.name}</b>
    <span>{sub}</span>
  </div>
  <div class="wave">
    <MiniWave {version} markers={markersFor(ix, ix.commentsOf.get(version.id) ?? [])} count={120} />
  </div>
  {#if (ix.versionsOf.get(track.id)?.length ?? 0) > 1}
    <Button size="sm" variant="ghost" href={`/mixer?track=${track.id}&v=${version.id}`}><Icon name="sliders" size={14} /> Im Mischpult</Button>
  {/if}
  <Button size="sm" variant="ghost" href={trackHref(project.id, track.id, version.id)} onclick={() => handOff(track.id)}>Öffnen</Button>
  <button type="button" class="close" aria-label="Player schließen" onclick={onclose}><Icon name="x" size={14} /></button>
</div>

<style>
  .dock {
    position: sticky;
    bottom: 0;
    z-index: 15;
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px var(--space-6);
    background: rgba(19, 17, 25, 0.97);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid var(--color-border-hover);
  }
  .t {
    width: 190px;
    min-width: 0;
    flex-shrink: 0;
  }
  .t b,
  .t span {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .t b {
    color: var(--color-text-primary);
    font-size: var(--text-sm);
  }
  .t span {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .wave {
    flex: 1;
    min-width: 220px;
  }
  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .close:hover {
    background: var(--color-bg-overlay);
    color: var(--color-text-primary);
  }
  /* Above the bottom bar on phones */
  @media (max-width: 640px) {
    .dock {
      bottom: calc(56px + env(safe-area-inset-bottom, 0px));
      flex-wrap: wrap;
      gap: 10px;
      padding: 8px 12px;
    }
    .t {
      width: auto;
      flex: 1;
    }
    .wave {
      order: 5;
      flex-basis: 100%;
      min-width: 0;
    }
  }
</style>
