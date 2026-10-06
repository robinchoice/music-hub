<script lang="ts">
  import type { Snippet } from 'svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Icon from '$lib/components/ui/Icon.svelte';
  import type { OfflineQuality } from '$lib/stores/offline.svelte.js';
  import { versionTitle, type Version } from '$lib/utils/track.js';
  import VersionList from './VersionList.svelte';

  let {
    version,
    versions,
    narrow = false,
    canApprove = false,
    canUpload = false,
    isOwner = false,
    offlineAvailable = false,
    offlineDownloading = false,
    offlineProgress = 0,
    onSelect,
    onOpenVersions,
    onUpload,
    onApprove,
    onReject,
    onCompare,
    onEdit,
    onDownload,
    onOfflineDownload,
    onOfflineRemove,
    onBranch,
    onPromote,
    onDelete,
    player,
  }: {
    version: Version;
    versions: Version[];
    narrow?: boolean;
    canApprove?: boolean;
    canUpload?: boolean;
    isOwner?: boolean;
    offlineAvailable?: boolean;
    offlineDownloading?: boolean;
    offlineProgress?: number;
    onSelect: (version: Version) => void;
    onOpenVersions: () => void;
    onUpload: () => void;
    onApprove: () => void;
    onReject: () => void;
    onCompare: () => void;
    onEdit: () => void;
    onDownload: () => void;
    onOfflineDownload: (quality: OfflineQuality) => void;
    onOfflineRemove: () => void;
    onBranch: () => void;
    onPromote: () => void;
    onDelete: () => void;
    player: Snippet;
  } = $props();

  const STATUS_LABEL: Record<string, string> = {
    uploaded: 'Hochgeladen',
    processing: 'Wird verarbeitet',
    ready: 'Bereit',
    approved: 'Freigegeben',
    rejected: 'Abgelehnt',
  };
  const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'error' | 'accent'> = {
    approved: 'success',
    rejected: 'error',
    processing: 'warning',
    ready: 'accent',
  };

  let menu = $state<'picker' | 'more' | null>(null);

  const showDecision = $derived(canApprove && version.status !== 'approved' && version.status !== 'rejected');

  function toggle(name: 'picker' | 'more') {
    menu = menu === name ? null : name;
  }

  function pick(action: () => void) {
    menu = null;
    action();
  }

  function openPicker() {
    if (narrow) onOpenVersions();
    else toggle('picker');
  }

  function handleWindowClick(e: MouseEvent) {
    if (!(e.target as Element).closest('.menu-root')) menu = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') menu = null;
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeydown} />

<section class="version-card">
  <div class="head">
    <div class="menu-root">
      <button class="picker" onclick={openPicker} aria-haspopup="menu" aria-expanded={menu === 'picker'}>
        <b>V{version.versionNumber}</b>
        <span>{versionTitle(version)}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {#if menu === 'picker'}
        <div class="menu picker-menu" role="menu">
          <VersionList
            {versions}
            selectedId={version.id}
            {canUpload}
            head
            onSelect={(v) => pick(() => onSelect(v))}
            onUpload={() => pick(onUpload)}
          />
        </div>
      {/if}
    </div>

    <Badge variant={STATUS_VARIANT[version.status] ?? 'default'}>{STATUS_LABEL[version.status] ?? version.status}</Badge>

    <div class="actions">
      {#if showDecision}
        <Button variant="ghost" size="sm" onclick={onApprove}>
          <span class="ok"><Icon name="check" size={14} /> Freigeben</span>
        </Button>
        <Button variant="ghost" size="sm" onclick={onReject}>
          <span class="err"><Icon name="x" size={14} /> Ablehnen</span>
        </Button>
      {/if}

      {#if versions.length > 1}
        <button class="icon-btn" title="Alle Versionen vergleichen" aria-label="Alle Versionen vergleichen" onclick={onCompare}>
          <Icon name="compare" size={15} />
        </button>
      {/if}

      <div class="menu-root">
        <button class="icon-btn" title="Weitere Aktionen" aria-label="Weitere Aktionen" onclick={() => toggle('more')}>
          <Icon name="more" size={16} />
        </button>
        {#if menu === 'more'}
          <div class="menu" role="menu">
            {#if canUpload}
              <button role="menuitem" onclick={() => pick(onEdit)}><Icon name="edit" size={14} /> Bezeichnung und Notizen</button>
            {/if}
            <button role="menuitem" onclick={() => pick(onDownload)}><Icon name="download" size={14} /> Original herunterladen</button>
            {#if offlineAvailable}
              <button role="menuitem" onclick={() => pick(onOfflineRemove)}><Icon name="cloud-check" size={14} /> Offline-Kopie entfernen</button>
            {:else if offlineDownloading}
              <span class="menu-cap">Offline-Download {offlineProgress}%</span>
            {:else}
              <button role="menuitem" onclick={() => pick(() => onOfflineDownload('stream'))}><Icon name="cloud-download" size={14} /> Offline speichern (MP3)</button>
              <button role="menuitem" onclick={() => pick(() => onOfflineDownload('original'))}><Icon name="cloud-download" size={14} /> Offline speichern (Original)</button>
            {/if}
            {#if canUpload}
              <button role="menuitem" onclick={() => pick(onBranch)}><Icon name="git-branch" size={14} /> Variante davon hochladen</button>
            {/if}
            {#if canApprove && version.branchLabel}
              <button role="menuitem" onclick={() => pick(onPromote)}><Icon name="arrow-up" size={14} /> Als Hauptversion</button>
            {/if}
            {#if isOwner}
              <hr />
              <button role="menuitem" class="danger" onclick={() => pick(onDelete)}><Icon name="trash" size={14} /> Version in den Papierkorb</button>
              <span class="menu-hint">Mit allen Kommentaren, 30 Tage im Papierkorb des Projekts. Freigabelinks pausieren so lange.</span>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if version.notes}
    <p class="notes"><span>Neu</span>{version.notes}</p>
  {/if}
  {#if version.rejectionReason}
    <p class="reason">Abgelehnt: „{version.rejectionReason}“</p>
  {/if}

  <div class="player">{@render player()}</div>
</section>

<style>
  .version-card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4) var(--space-5) var(--space-5);
  }

  .head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
  }

  .menu-root {
    position: relative;
    min-width: 0;
  }

  .picker {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .picker b {
    font-family: var(--font-display);
    font-weight: 800;
    font-stretch: 78%;
    font-size: 1.25rem;
  }

  .picker span {
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picker :global(svg) {
    flex-shrink: 0;
    color: var(--color-text-tertiary);
  }

  .actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .ok,
  .err {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .ok {
    color: var(--color-success);
  }

  .err {
    color: var(--color-error);
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    display: inline-grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: var(--z-dropdown);
    min-width: 240px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .picker-menu {
    left: 0;
    right: auto;
    min-width: 300px;
    max-height: min(480px, 70vh);
    overflow-y: auto;
    padding: var(--space-3);
  }

  .menu button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 8px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--text-sm);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .menu button:hover {
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
  }

  .menu .danger {
    color: var(--color-error);
  }

  .menu hr {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 4px;
  }

  .menu-cap {
    padding: 6px 10px 4px;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .menu-hint {
    max-width: 260px;
    padding: 0 10px 6px 32px;
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--color-text-tertiary);
  }

  .notes {
    margin: var(--space-3) 0 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .notes span {
    flex-shrink: 0;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-tertiary);
    font-weight: 600;
  }

  .reason {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-2);
    border-left: 2px solid color-mix(in srgb, var(--color-error) 50%, transparent);
    font-size: var(--text-sm);
    color: var(--color-error);
  }

  .player {
    margin-top: var(--space-4);
  }

  @media (max-width: 1024px) {
    .version-card {
      padding: var(--space-3) var(--space-4) var(--space-4);
    }

    .actions {
      flex-basis: 100%;
      margin-left: 0;
      justify-content: flex-end;
    }

    .actions :global(.btn) {
      flex: 1;
      justify-content: center;
    }
  }
</style>
