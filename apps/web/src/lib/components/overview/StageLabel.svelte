<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte';
  import { STAGE_ICON, type Stage } from '$lib/utils/overview.js';

  let { stage, small = false }: { stage: Stage; small?: boolean } = $props();
</script>

<span class="stage s-{stage.key}" class:small>
  <Icon name={STAGE_ICON[stage.key]} size={small ? 12 : 14} />{stage.text}
</span>

<style>
  .stage {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .small {
    font-size: var(--text-xs);
  }
  .s-open {
    color: var(--color-warning);
  }
  .s-feedback {
    color: var(--color-text-primary);
  }
  .s-rejected {
    color: var(--color-error);
  }
  .s-approved {
    color: var(--color-success);
  }
  .s-none,
  .s-processing {
    color: var(--color-text-tertiary);
  }
</style>
