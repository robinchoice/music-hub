<script lang="ts">
  import { t } from '$lib/i18n/index.js';
  import Icon from '$lib/components/ui/Icon.svelte';

  // "Meine Musik" as folders or as a board; the archive sits next to them like a filter
  let { active }: { active: 'folders' | 'board' } = $props();
</script>

<div class="views">
  <nav class="switch" aria-label={t().workspace.nav.music}>
    <a href="/music" aria-current={active === 'folders' ? 'page' : undefined}><Icon name="folder" size={14} /> {t().workspace.music.folders}</a>
    <a href="/board" aria-current={active === 'board' ? 'page' : undefined}><Icon name="kanban" size={14} /> {t().workspace.nav.board}</a>
  </nav>
  <a href="/archive" class="archive"><Icon name="archive" size={14} /> {t().workspace.nav.archive}</a>
</div>

<style>
  .views {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  .switch {
    display: inline-flex;
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-full);
    overflow: hidden;
  }
  .switch a,
  .archive {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    text-decoration: none;
  }
  .switch a:hover,
  .archive:hover {
    color: var(--color-text-primary);
  }
  .switch a[aria-current='page'] {
    background: var(--color-accent-subtle);
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .archive {
    border-radius: var(--radius-full);
  }
</style>
