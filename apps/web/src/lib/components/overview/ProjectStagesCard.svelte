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
        <b>{g.project.name}</b>
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
  .head b {
    color: var(--color-text-primary);
    font-weight: 600;
    font-size: var(--text-sm);
    white-space: nowrap;
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
    border-color: #4a4658;
  }
  .unit.s-open {
    background: rgba(251, 191, 36, 0.07);
    border-color: rgba(251, 191, 36, 0.28);
  }
  .unit.s-rejected {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.3);
  }
  .unit.s-approved {
    background: rgba(34, 197, 94, 0.07);
    border-color: rgba(34, 197, 94, 0.28);
  }
  .unit.s-none,
  .unit.s-processing {
    color: var(--color-text-secondary);
  }
  .s-open :global(svg) {
    color: var(--color-warning);
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
