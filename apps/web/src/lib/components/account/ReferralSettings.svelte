<script lang="ts">
  import { onMount } from 'svelte';
  import { REFERRAL_DAYS, type ReferralView } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { t } from '$lib/i18n/index.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';

  // The own referral link (lib/referrals.ts in the API). Only accounts with a running plan have one.
  let view = $state<ReferralView | null>(null);
  const tx = $derived(t().billing.referral);
  const link = $derived(view?.code ? `${location.origin}/register?ref=${view.code}` : '');

  onMount(async () => {
    view = await api.get<ReferralView>('/billing/referrals', true).catch(() => null);
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toastSuccess(tx.copied);
    } catch {
      // Without clipboard access the link stays selectable in the field
    }
  }
</script>

{#if view?.code}
  <section class="card">
    <h2>{tx.title}</h2>
    <p class="sub">{tx.intro(REFERRAL_DAYS.referrer, REFERRAL_DAYS.referred)}</p>
    <div class="row">
      <input readonly value={link} aria-label={tx.title} onfocus={(e) => e.currentTarget.select()} />
      <Button size="sm" onclick={copy}>{tx.copy}</Button>
    </div>
    <p class="status">{tx.counts(view.joined, view.rewarded, REFERRAL_DAYS.referrer)}</p>
    <p class="hint">{tx.conditions}</p>
  </section>
{/if}

<style>
  .card {
    margin-top: var(--space-5);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }
  h2 { margin: 0 0 var(--space-2); font-size: var(--text-lg); }
  .sub, .hint, .status {
    margin: 0 0 var(--space-3);
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  .status { color: var(--color-text-secondary); }
  .hint { margin: 0; font-size: var(--text-xs); }
  .row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin: var(--space-4) 0 var(--space-3);
  }
  input {
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-base);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  @media (max-width: 640px) {
    .card { padding: var(--space-4); }
  }
</style>
