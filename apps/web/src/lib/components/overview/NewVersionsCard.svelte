<script lang="ts">
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import DashCard from './DashCard.svelte';
  import MiniWave from './MiniWave.svelte';
  import StageLabel from './StageLabel.svelte';
  import { handOff } from '$lib/stores/listen.js';
  import { formatWhen } from '$lib/utils/format.js';
  import { firstName, markersFor, trackHref, versionName, type OverviewIndex, type ProjectGroup } from '$lib/utils/overview.js';

  let { ix, groups }: { ix: OverviewIndex; groups: ProjectGroup[] } = $props();

  // Per track only its newest version, and only those of the others
  const fresh = $derived(
    groups
      .flatMap((g) => g.list)
      .filter((i) => i.latest && i.latest.createdById !== ix.me && i.latest.status !== 'uploaded' && i.latest.status !== 'processing')
      .sort((a, b) => b.latest!.createdAt.localeCompare(a.latest!.createdAt)),
  );
  const hero = $derived(fresh[0] ?? null);
  const uploader = (id: string) => firstName(ix.users.get(id)?.name ?? 'Jemand');
</script>

<DashCard icon="headphones" title="Neu zum Anhören" sub={hero ? 'neueste Versionen der anderen' : ''} span={8}>
  {#if hero && hero.latest}
    {@const v = hero.latest}
    <div class="hero">
      <div class="cover">
        <CoverImage src={hero.track.coverUrl ?? hero.project.coverUrl} name={hero.track.name} size="fill" rounded="lg" />
      </div>
      <div class="main">
        <h3>
          <a href={trackHref(hero.project.id, hero.track.id, v.id)} onclick={() => handOff(hero.track.id)}>{hero.track.name}</a>
        </h3>
        <div class="meta">
          <span class="vchip">V{v.versionNumber}</span>
          {#if versionName(v)}<b>{versionName(v)}</b>{/if}
          <span>von {uploader(v.createdById)}, {formatWhen(v.createdAt)}</span>
          <StageLabel stage={hero.stage} small />
          {#if hero.versions.length > 1}
            <Button size="sm" variant="secondary" href={`${trackHref(hero.project.id, hero.track.id, v.id)}&view=compare`}>
              <Icon name="sliders" size={14} /> Mit V{hero.versions[hero.versions.length - 2].versionNumber} vergleichen
            </Button>
          {/if}
        </div>
        <MiniWave version={v} markers={markersFor(ix, ix.commentsOf.get(v.id) ?? [], true)} count={150} big />
      </div>
    </div>
    {#if fresh.length > 1}
      <div class="queue">
        {#each fresh.slice(1, 4) as info (info.track.id)}
          {@const q = info.latest!}
          <div class="row">
            <CoverImage src={info.track.coverUrl ?? info.project.coverUrl} name={info.track.name} size="sm" rounded="md" />
            <div class="ttl">
              <b>{info.track.name} <span class="vchip">V{q.versionNumber}</span></b>
              <small>{versionName(q) ? `${versionName(q)} ` : ''}von {uploader(q.createdById)}, {formatWhen(q.createdAt)}</small>
            </div>
            <MiniWave version={q} markers={markersFor(ix, ix.commentsOf.get(q.id) ?? [])} />
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <p class="empty">Gerade gibt es nichts Neues von den anderen.</p>
  {/if}
</DashCard>

<style>
  .hero {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    gap: var(--space-5);
    align-items: start;
  }
  .cover {
    width: 104px;
    height: 104px;
  }
  .main {
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 780;
    font-stretch: 78%;
    line-height: 1.05;
  }
  h3 a {
    color: inherit;
    text-decoration: none;
  }
  h3 a:hover {
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
    text-underline-offset: 3px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin: 6px 0 14px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .meta b {
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .queue {
    margin-top: var(--space-4);
  }
  .row {
    display: grid;
    grid-template-columns: auto minmax(110px, 190px) minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid var(--color-border);
  }
  .ttl {
    min-width: 0;
  }
  .ttl b {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-primary);
    font-weight: 600;
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .ttl small {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (max-width: 640px) {
    .hero {
      grid-template-columns: minmax(0, 1fr);
    }
    .cover {
      display: none;
    }
    .row {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .row :global(.wf) {
      grid-column: 1 / -1;
    }
  }
</style>
