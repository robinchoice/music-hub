<script lang="ts">
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import DashCard from './DashCard.svelte';
  import { STAGE_ICON, trackHref, versionName, type ProjectGroup, type StageKey, type TrackInfo } from '$lib/utils/overview.js';

  let { groups }: { groups: ProjectGroup[] } = $props();

  const LEGEND: [StageKey, string][] = [
    ['feedback', 'wartet auf Feedback'],
    ['open', 'offene Kommentare'],
    ['rejected', 'abgelehnt'],
    ['approved', 'freigegeben'],
    ['none', 'noch keine Version'],
  ];

  function tip(info: TrackInfo) {
    const v = info.latest;
    const version = v ? `, V${v.versionNumber}${versionName(v) ? ` · ${versionName(v)}` : ''}` : '';
    return `${info.track.name}\n${info.stage.text}${version}`;
  }
</script>

<DashCard icon="layers" title="Stand der Projekte" span={6}>
  {#each groups as g (g.project.id)}
    <div class="pj">
      <div class="head">
        <CoverImage src={g.project.coverUrl} name={g.project.name} size="xs" rounded="sm" />
        <a class="name" href="/projects/{g.project.id}">{g.project.name}</a>
        {#if g.project.artist}<span>{g.project.artist}</span>{/if}
        <span class="prog">{g.list.length ? `${g.done.length} von ${g.list.length} fertig` : 'Noch keine Tracks'}</span>
      </div>
      {#if g.list.length}
        <div class="units">
          {#each g.list as info (info.track.id)}
            <a
              class="unit s-{info.stage.key}"
              href={trackHref(info.project.id, info.track.id)}
              data-tt={tip(info)}
              aria-label="{info.track.name}: {info.stage.text}"
            >
              <Icon name={STAGE_ICON[info.stage.key]} size={13} stroke={2.2} />{info.track.name}
            </a>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
  <div class="legend keys">
    {#each LEGEND as [key, label] (key)}
      <span class="s-{key}"><Icon name={STAGE_ICON[key]} size={12} stroke={2.2} /><span class="lbl">{label}</span></span>
    {/each}
  </div>
</DashCard>

<style>
  .pj {
    padding: 12px 0;
    border-top: 1px solid var(--color-border);
  }
  .pj:first-of-type {
    border-top: 0;
    padding-top: 2px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .head .name {
    color: var(--color-text-primary);
    font-weight: 600;
    font-size: var(--text-sm);
    white-space: nowrap;
    text-decoration: none;
  }
  .head .name:hover {
    text-decoration: underline;
  }
  .head span {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
  .head .prog {
    margin-left: auto;
  }
  .units {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 9px;
  }
  .unit {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 12.5px;
    color: var(--color-text-primary);
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border-hover);
    white-space: nowrap;
    text-decoration: none;
  }
  .unit:hover {
    border-color: var(--color-text-tertiary);
  }
  .unit.s-open {
    background: var(--color-accent-subtle);
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
  }
  .unit.s-rejected {
    background: color-mix(in srgb, var(--color-error) 8%, transparent);
    border-color: color-mix(in srgb, var(--color-error) 30%, transparent);
  }
  .unit.s-approved {
    background: color-mix(in srgb, var(--color-success) 7%, transparent);
    border-color: color-mix(in srgb, var(--color-success) 28%, transparent);
  }
  .unit.s-none,
  .unit.s-processing {
    color: var(--color-text-secondary);
  }
  .s-open :global(svg) {
    color: var(--color-accent);
  }
  .s-rejected :global(svg) {
    color: var(--color-error);
  }
  .s-approved :global(svg) {
    color: var(--color-success);
  }
  .s-feedback :global(svg) {
    color: var(--color-text-secondary);
  }
  .s-none :global(svg),
  .s-processing :global(svg) {
    color: var(--color-text-tertiary);
  }
  .keys {
    margin-top: 12px;
  }
  .lbl {
    color: var(--color-text-secondary);
  }
</style>
