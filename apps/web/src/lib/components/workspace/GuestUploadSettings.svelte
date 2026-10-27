<script lang="ts">
  import { onMount } from 'svelte';
  import { t, dateLocale } from '$lib/i18n/index.js';
  import { GUEST_STORAGE_CHOICES } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { formatGb } from '$lib/utils/format.js';

  type Settings = { allowed: boolean; limit: number; used: number };

  let settings = $state<Settings | null>(null);

  onMount(async () => {
    settings = await api.get<Settings>('/upload-links/settings', true).catch(() => null);
  });

  async function save(patch: Partial<Pick<Settings, 'allowed' | 'limit'>>) {
    try {
      settings = await api.patch<Settings>('/upload-links/settings', patch);
    } catch {
      // The API client already showed the error
    }
  }
</script>

{#if settings}
  <section class="card" id="gaeste">
    <h2>{t().workspace.guestUploads.title}</h2>
    <label class="toggle">
      <input type="checkbox" checked={settings.allowed} onchange={(e) => save({ allowed: e.currentTarget.checked })} />
      <span>
        <b>{t().workspace.guestUploads.allow}</b>
        <small>{t().workspace.guestUploads.allowHint}</small>
      </span>
    </label>
    {#if settings.allowed}
      <label class="field">
        {t().workspace.guestUploads.atMost}
        <select value={settings.limit} onchange={(e) => save({ limit: Number(e.currentTarget.value) })}>
          {#each GUEST_STORAGE_CHOICES as bytes (bytes)}
            <option value={bytes}>{(bytes / 1024 ** 3).toLocaleString(dateLocale())} GB</option>
          {/each}
        </select>
        <small>{t().workspace.guestUploads.usedHint(formatGb(settings.used))}</small>
      </label>
    {/if}
  </section>
{/if}

<style>
  .card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    margin-top: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .toggle {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    cursor: pointer;
  }
  .toggle input {
    accent-color: var(--color-accent);
    margin-top: 3px;
  }
  .toggle span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .toggle b {
    font-weight: 500;
    font-size: var(--text-sm);
  }
  small {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    line-height: 1.5;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  select {
    align-self: flex-start;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }
</style>
