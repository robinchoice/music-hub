<script lang="ts">
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import { turnText, type OverviewIndex, type TrackInfo } from '$lib/utils/overview.js';

  let { ix, info }: { ix: OverviewIndex; info: TrackInfo } = $props();

  const text = $derived(turnText(ix, info));
  const people = $derived([
    ...info.turn.map((id) => ({ key: id, name: ix.users.get(id)?.name ?? 'Jemand', src: ix.users.get(id)?.avatarUrl ?? null })),
    ...info.guests.map((g) => ({ key: `guest:${g}`, name: g || 'Gäste', src: null })),
  ]);
</script>

{#if text}
  <span class="turn" class:me={info.mine}>
    <span class="avs">
      {#each people as p (p.key)}<Avatar name={p.name} src={p.src} size="xs" />{/each}
    </span>
    {text}
  </span>
{/if}

<style>
  .turn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
  .me {
    color: var(--color-accent);
    font-weight: 500;
  }
  .avs {
    display: inline-flex;
  }
  .avs :global(.avatar) {
    box-shadow: 0 0 0 2px var(--color-bg-base);
  }
  .avs :global(.avatar + .avatar) {
    margin-left: -5px;
  }
</style>
