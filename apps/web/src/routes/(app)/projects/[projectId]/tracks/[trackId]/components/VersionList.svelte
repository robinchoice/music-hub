<script lang="ts">
  import Icon from '$lib/components/ui/Icon.svelte';
  import { timeAgo } from '$lib/utils/format.js';
  import { versionTitle, type Version } from '$lib/utils/track.js';

  let {
    versions,
    selectedId,
    canUpload = false,
    onSelect,
    onUpload,
  }: {
    versions: Version[];
    selectedId: string | null;
    canUpload?: boolean;
    onSelect: (version: Version) => void;
    onUpload?: () => void;
  } = $props();

  // From six versions on only the five newest stay visible, so the raw tracks below stay in view.
  const VISIBLE = 5;
  let showOlder = $state(false);
  const collapsible = $derived(versions.length > VISIBLE);
  const selectedIsOlder = $derived(versions.findIndex((v) => v.id === selectedId) >= VISIBLE);
  const shown = $derived(
    collapsible && !showOlder && !selectedIsOlder ? versions.slice(0, VISIBLE) : versions,
  );

  const numberOf = (id: string | null) => versions.find((v) => v.id === id)?.versionNumber;
</script>

<div class="version-list">
  <div class="head">
    <span class="cap">Versionen</span>
    <span class="count">{versions.length}</span>
    {#if canUpload && onUpload}
      <button class="text-btn" onclick={onUpload}><Icon name="upload" size={13} /> Neue Version</button>
    {/if}
  </div>

  {#if versions.length === 0}
    <p class="empty">Noch keine Versionen.</p>
  {:else}
    <ul>
      {#each shown as v (v.id)}
        <li>
          <button
            class="row"
            class:selected={v.id === selectedId}
            class:variant={!!v.branchLabel}
            title={v.branchLabel && v.parentVersionId ? `Variante von V${numberOf(v.parentVersionId)}` : undefined}
            onclick={() => onSelect(v)}
          >
            <span class="dot {v.status}" class:current={v.id === selectedId}>
              {#if v.status === 'approved'}
                <Icon name="check" size={10} stroke={3} />
              {:else if v.status === 'rejected'}
                <Icon name="x" size={10} stroke={3} />
              {/if}
            </span>
            <span class="text">
              <span class="line">
                <b>V{v.versionNumber}</b>
                {#if v.branchLabel}<Icon name="git-branch" size={12} />{/if}
                <span class="title">{versionTitle(v)}</span>
                <span class="meta">
                  {#if v.openCommentCount > 0}<em>{v.openCommentCount} offen</em>{:else}{timeAgo(v.createdAt)}{/if}
                </span>
              </span>
              {#if v.rejectionReason}<span class="reason">„{v.rejectionReason}“</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if collapsible && !selectedIsOlder}
      <button class="older" onclick={() => (showOlder = !showOlder)}>
        <Icon name={showOlder ? 'chevron-down' : 'chevron-right'} size={13} />
        {showOlder ? 'Ältere ausblenden' : `${versions.length - VISIBLE} ältere Versionen`}
      </button>
    {/if}
  {/if}
</div>

<style>
  .version-list {
    display: flex;
    flex-direction: column;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-1) var(--space-3);
  }

  .cap {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-tertiary);
    font-weight: 600;
  }

  .count {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    background: var(--color-bg-subtle);
    border-radius: var(--radius-full);
    padding: 0 0.45rem;
  }

  .text-btn {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .text-btn:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-subtle);
  }

  .empty {
    margin: 0;
    padding: 0 var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: 7px var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: inherit;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--color-bg-subtle);
  }

  .row.selected {
    background: var(--color-bg-overlay);
    box-shadow: inset 0 0 0 1px var(--color-border-hover);
  }

  .row.variant {
    padding-left: calc(var(--space-2) + 18px);
  }

  .dot {
    width: 16px;
    height: 16px;
    margin-top: 2px;
    border-radius: 50%;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    box-shadow: inset 0 0 0 2px var(--color-text-tertiary);
  }

  .dot.current {
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }

  .dot.approved {
    background: var(--color-success);
    box-shadow: none;
    color: #06210f;
  }

  .dot.rejected {
    background: var(--color-error);
    box-shadow: none;
    color: #2b0606;
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
  }

  .line b {
    font-weight: 700;
    flex-shrink: 0;
  }

  .line :global(svg) {
    color: var(--color-text-tertiary);
    flex-shrink: 0;
  }

  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    margin-left: auto;
    padding-left: var(--space-2);
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }

  .meta em {
    font-style: normal;
    color: var(--color-warning);
  }

  .reason {
    display: block;
    margin-top: 1px;
    font-size: var(--text-xs);
    color: #fca5a5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .older {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: var(--space-1);
    padding: 6px var(--space-2);
    border: none;
    background: none;
    color: var(--color-text-tertiary);
    font-family: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .older:hover {
    color: var(--color-text-primary);
  }
</style>
