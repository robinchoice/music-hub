<script lang="ts">
  import type { ComponentProps, Snippet } from 'svelte';
  import Icon from '$lib/components/ui/Icon.svelte';

  let {
    icon,
    title,
    sub = '',
    span,
    flush = false,
    actions,
    children,
  }: {
    icon: ComponentProps<typeof Icon>['name'];
    title: string;
    sub?: string;
    /** Columns in the 12-column grid of the overview */
    span?: number;
    /** No side padding, for content that runs to the edges */
    flush?: boolean;
    actions?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="card" class:flush style={span ? `grid-column: span ${span}` : undefined}>
  <header class="card-h">
    <h2><Icon name={icon} size={16} />{title}</h2>
    {#if sub}<span class="sub">{sub}</span>{/if}
    {#if actions}<span class="act">{@render actions()}</span>{/if}
  </header>
  {@render children()}
</section>

<style>
  .card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4) var(--space-5);
    min-width: 0;
  }
  .card.flush {
    padding: var(--space-4) 0 var(--space-3);
  }
  .card-h {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 var(--space-3);
    min-height: 24px;
  }
  .flush .card-h {
    padding: 0 var(--space-5);
  }
  h2 {
    margin: 0;
    font-size: 1.1875rem;
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }
  h2 :global(svg) {
    color: var(--color-text-tertiary);
  }
  .sub {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .act {
    margin-left: auto;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* Shared parts of the cards */
  .card :global(.tbtn) {
    font: inherit;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 2px 8px;
    white-space: nowrap;
    cursor: pointer;
    text-decoration: none;
  }
  .card :global(.tbtn:hover) {
    color: var(--color-text-primary);
    border-color: var(--color-border-hover);
  }
  .card :global(.legend) {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }
  .card :global(.legend > span) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .card :global(.legend i) {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .card :global(.mini-table) {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  .card :global(.mini-table th) {
    font-weight: 500;
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    text-align: right;
    padding: 4px 6px;
    border-bottom: 1px solid var(--color-border);
  }
  .card :global(.mini-table td) {
    padding: 5px 6px;
    text-align: right;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    border-bottom: 1px solid var(--color-border);
  }
  .card :global(.mini-table :is(th, td):first-child) {
    text-align: left;
  }
  .card :global(.empty) {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  @media (max-width: 880px) {
    .card {
      grid-column: 1 / -1 !important;
      padding: var(--space-4);
    }
    .card.flush {
      padding: var(--space-4) 0 var(--space-3);
    }
    .flush .card-h {
      padding: 0 var(--space-4);
    }
  }
</style>
