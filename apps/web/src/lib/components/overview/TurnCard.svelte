<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import DashCard from './DashCard.svelte';
  import { trackHref, turnRows, type OverviewIndex, type ProjectGroup } from '$lib/utils/overview.js';

  let { ix, groups }: { ix: OverviewIndex; groups: ProjectGroup[] } = $props();

  const rows = $derived(turnRows(ix, groups.flatMap((g) => g.list)));
</script>

<DashCard icon="users" title="Wer ist dran" sub="laufende Tracks" span={4}>
  {#each rows as row (row.key)}
    <div class="who">
      <Avatar name={row.avatarName} src={row.avatarUrl} size="sm" />
      <div class="main">
        <div class="name">
          <span>{row.label}</span>
          <small>{row.infos.length === 1 ? '1 Track' : `${row.infos.length} Tracks`}</small>
        </div>
        <div class="chips">
          {#each row.infos as info (info.track.id)}
            <a class="chip" href={trackHref(info.project.id, info.track.id)}>{info.track.name}</a>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <p class="empty">Gerade ist niemand dran.</p>
  {/each}
</DashCard>

<style>
  .who {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 0;
    border-top: 1px solid var(--color-border);
  }
  .who:first-of-type {
    border-top: 0;
    padding-top: 2px;
  }
  .main {
    flex: 1;
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    color: var(--color-text-primary);
    font-weight: 600;
    font-size: var(--text-sm);
  }
  .name small {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    font-weight: 500;
    white-space: nowrap;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 5px;
  }
  .chip {
    font-size: 12px;
    line-height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
    white-space: nowrap;
    text-decoration: none;
  }
  .chip:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-hover);
  }
</style>
