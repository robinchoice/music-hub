<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { trackHref, type OverviewIndex, type ProjectGroup } from '$lib/utils/overview.js';

  // Shown while nobody else is in your projects; the next step carries the only main button
  let { ix, groups }: { ix: OverviewIndex; groups: ProjectGroup[] } = $props();

  const hasVersion = $derived(ix.data.versions.length > 0);
  // The project with the newest activity, for uploading prefer one with a track still waiting for its mix
  const project = $derived(groups[0]?.project);
  const emptyTrack = $derived(groups.flatMap((g) => g.list).find((i) => !i.latest));
  const uploadHref = $derived(
    emptyTrack ? trackHref(emptyTrack.project.id, emptyTrack.track.id) : `/projects/${project?.id}`,
  );
  const next = $derived(!project ? 1 : !hasVersion ? 2 : 3);
</script>

<ol class="steps">
  <li class:done={next > 1} class:now={next === 1}>
    <span class="n">{#if next > 1}<Icon name="check" size={14} stroke={2.6} />{:else}1{/if}</span>
    <h2>Projekt anlegen</h2>
    <p>Album, EP oder Single, mit Artist und Cover.</p>
    {#if next === 1}<Button href="/projects/new">Neues Projekt</Button>{/if}
  </li>
  <li class:done={next > 2} class:now={next === 2}>
    <span class="n">{#if next > 2}<Icon name="check" size={14} stroke={2.6} />{:else}2{/if}</span>
    <h2>Mix hochladen</h2>
    <p>Dein Mix wird die erste Version eines Tracks. Spuren gehen auch.</p>
    {#if next === 2}<Button href={uploadHref}>Mix hochladen</Button>{/if}
  </li>
  <li class:now={next === 3}>
    <span class="n">3</span>
    <h2>Leute dazuholen</h2>
    <p>Band, Produzentin oder Label hören rein und kommentieren an der Stelle.</p>
    {#if next === 3 && project}<Button href="/projects/{project.id}/settings">{project.name} teilen</Button>{/if}
  </li>
</ol>

<style>
  .steps {
    list-style: none;
    margin: 0 0 var(--space-5);
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }
  li {
    border: 1px solid var(--color-border);
    background: var(--color-bg-raised);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-2);
    align-content: start;
    justify-items: start;
  }
  li.done {
    opacity: 0.6;
  }
  li.now {
    border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
    background: linear-gradient(45deg, var(--color-accent-subtle), transparent), var(--color-bg-raised);
  }
  .n {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 13px;
    font-weight: 700;
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
  }
  .done .n {
    background: color-mix(in srgb, var(--color-success) 18%, transparent);
    color: var(--color-success);
  }
  .now .n {
    background: var(--gradient-accent);
    color: var(--color-on-accent);
  }
  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-stretch: 78%;
    font-weight: 750;
  }
  p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  @media (max-width: 880px) {
    .steps {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
