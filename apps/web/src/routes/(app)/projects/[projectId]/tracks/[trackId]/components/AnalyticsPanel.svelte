<script lang="ts">
  import { api } from '$lib/api/client.js';
  import Icon from '$lib/components/ui/Icon.svelte';
  import { dateLocale, t } from '$lib/i18n/index.js';

  type ListenEvent = {
    id: string;
    listenerName: string | null;
    openedAt: string;
    firstPlayAt: string | null;
    listenSeconds: number;
    completed: boolean;
  };

  type Analytics = {
    totalOpens: number;
    totalPlays: number;
    uniqueListeners: number;
    avgListenSeconds: number;
    completionRate: number;
    events: ListenEvent[];
  };

  let { versionId }: { versionId: string } = $props();

  let data = $state<Analytics | null>(null);
  let loading = $state(true);
  let error = $state('');

  $effect(() => {
    if (versionId) load();
  });

  async function load() {
    loading = true;
    error = '';
    try {
      data = await api.get<Analytics>(`/share/version/${versionId}/analytics`);
    } catch {
      error = t().track.analytics.loadFailed;
    } finally {
      loading = false;
    }
  }

  function formatDuration(s: number): string {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(dateLocale(), {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
</script>

<div class="analytics">
  {#if loading}
    <p class="muted">{t().track.analytics.loading}</p>
  {:else if error}
    <p class="muted">{error}</p>
  {:else if data}
    {#if data.totalOpens === 0}
      <p class="muted">{t().track.analytics.none}</p>
    {:else}
      <div class="stats-grid">
        <div class="stat">
          <span class="stat-value">{data.totalOpens}</span>
          <span class="stat-label">{t().track.analytics.opened}</span>
        </div>
        <div class="stat">
          <span class="stat-value">{data.totalPlays}</span>
          <span class="stat-label">{t().track.analytics.played}</span>
        </div>
        <div class="stat">
          <span class="stat-value">{data.uniqueListeners}</span>
          <span class="stat-label">{t().track.analytics.people}</span>
        </div>
        <div class="stat">
          <span class="stat-value">{data.completionRate}%</span>
          <span class="stat-label">{t().track.analytics.completion}</span>
        </div>
      </div>

      <div class="event-list">
        {#each data.events as e (e.id)}
          <div class="event-row">
            <div class="event-info">
              <span class="listener-name">{e.listenerName ?? t().track.analytics.anonymous}</span>
              <span class="event-meta">
                {formatDate(e.openedAt)}
                {#if e.firstPlayAt}
                  · {t().track.analytics.heard(formatDuration(e.listenSeconds))}
                  {#if e.completed}<span class="completed-badge">✓ {t().track.analytics.complete}</span>{/if}
                {:else}
                  · {t().track.analytics.notPlayed}
                {/if}
              </span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .analytics { display: flex; flex-direction: column; gap: var(--space-4); }
  .muted { color: var(--color-text-tertiary); font-size: var(--text-sm); }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-2);
  }
  .stat {
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .stat-value {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .stat-label {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .event-list { display: flex; flex-direction: column; gap: 2px; }
  .event-row {
    padding: var(--space-3) var(--space-3);
    background: var(--color-bg-subtle);
    border-radius: var(--radius-sm);
  }
  .event-info { display: flex; flex-direction: column; gap: 2px; }
  .listener-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .event-meta {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .completed-badge {
    color: var(--color-success);
    font-weight: 500;
  }
</style>
