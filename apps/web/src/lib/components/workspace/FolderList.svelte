<script lang="ts">
  import { t } from '$lib/i18n/index.js';
  import Icon from '$lib/components/ui/Icon.svelte';
  import CoverImage from '$lib/components/ui/CoverImage.svelte';
  import { formatWhen } from '$lib/utils/format.js';
  import type { Folder } from '$lib/utils/music.js';

  let {
    folders,
    note,
  }: {
    folders: Folder[];
    /** A second line under the name, e.g. who owns a shared project */
    note?: (folder: Folder) => string;
  } = $props();

  // Project rows carry a gear; the other rows and the head keep its room, so the columns line up
  const withGear = $derived(folders.some((f) => f.settingsHref));

  function contents(f: Folder) {
    const m = t().workspace.music;
    if (f.kind === 'artist') return m.projects(f.count);
    if (f.kind === 'project') return m.tracks(f.count);
    return f.files ? `${m.versions(f.count)} · ${m.files(f.files)}` : m.versions(f.count);
  }
</script>

<div class="folders">
  <div class="head" class:with-gear={withGear} aria-hidden="true">
    <span>{t().workspace.music.name}</span>
    <span>{t().workspace.music.contents}</span>
    <span>{t().workspace.music.changed}</span>
  </div>
  <ul>
    {#each folders as folder (folder.key)}
      {@const extra = note?.(folder) ?? ''}
      <li>
        <a href={folder.href} class="folder" data-kind={folder.kind}>
          {#if folder.kind === 'artist'}
            <span class="icon" title={t().workspace.music.artist}><Icon name="user" size={16} /></span>
          {:else if folder.kind === 'track' && !folder.coverUrl}
            <span class="icon"><Icon name="folder" size={16} /></span>
          {:else}
            <CoverImage src={folder.coverUrl} name={folder.name} size="sm" rounded="sm" />
          {/if}
          <span class="name">
            <b>{folder.name}</b>
            <!-- Wide screens have columns for the contents, phones read them here -->
            <small class:phone-only={!extra}><span class="phone-only">{contents(folder)}{extra ? ' · ' : ''}</span>{extra}</small>
          </span>
          <span class="contents">{contents(folder)}</span>
          <span class="changed">{folder.changedAt ? formatWhen(folder.changedAt) : '—'}</span>
        </a>
        {#if folder.settingsHref}
          {@const label = `${t().workspace.projectPage.settingsMembers}: ${folder.name}`}
          <a href={folder.settingsHref} class="gear" title={label} aria-label={label}><Icon name="settings" size={16} /></a>
        {:else if withGear}
          <span class="gear" aria-hidden="true"></span>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .folders {
    display: flex;
    flex-direction: column;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--color-border);
  }
  li .folder {
    flex: 1;
    min-width: 0;
    border-bottom: none;
  }
  .gear {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-right: var(--space-1);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
  }
  .gear:hover {
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
  }
  .head,
  .folder {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) 11rem 10rem;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
  }
  .head {
    grid-template-columns: minmax(0, 1fr) 11rem 10rem;
    padding-left: calc(var(--space-3) + 32px + var(--space-3));
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    border-bottom: 1px solid var(--color-border);
  }
  .head.with-gear {
    padding-right: calc(var(--space-3) + 40px + var(--space-1));
  }
  .folder {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    text-decoration: none;
    transition: background var(--transition-fast);
  }
  .folder:hover {
    background: var(--color-bg-raised);
    color: var(--color-text-secondary);
  }
  .icon {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background: var(--color-bg-overlay);
    color: var(--color-text-secondary);
  }
  .name {
    min-width: 0;
    display: grid;
  }
  .name b {
    color: var(--color-text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name small {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }
  .phone-only {
    display: none;
  }
  .changed,
  .contents {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 640px) {
    .head,
    .contents,
    .changed {
      display: none;
    }
    .folder {
      grid-template-columns: 32px minmax(0, 1fr);
      padding: var(--space-3) var(--space-1);
    }
    small.phone-only {
      display: block;
    }
    span.phone-only {
      display: inline;
    }
  }
</style>
