<script lang="ts">
  import type { BillingView } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { t } from '$lib/i18n/index.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import QrCode from '$lib/components/delivery/QrCode.svelte';

  // A Lightning invoice of our BTCPay Server for a plan, shown here because its checkout page is private.
  // While open it asks the API, which asks BTCPay, until the payment is paid or has expired.
  let {
    open = $bindable(false),
    url,
    paymentId,
    onview,
  }: { open: boolean; url: string; paymentId: string; onview: (view: BillingView) => void } = $props();

  const tx = $derived(t().billing);
  const bolt11 = $derived(url.replace(/^lightning:/i, ''));
  let expired = $state(false);

  $effect(() => {
    if (!open) return;
    expired = false;
    const timer = setInterval(async () => {
      const view = await api.get<BillingView>('/billing', true).catch(() => null);
      if (!view) return;
      const status = view.payments.find((p) => p.id === paymentId)?.status;
      if (status === 'paid') {
        onview(view);
        open = false;
        toastSuccess(tx.thanks);
      } else if (status === 'expired') {
        onview(view);
        expired = true;
        clearInterval(timer);
      }
    }, 4000);
    return () => clearInterval(timer);
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(bolt11);
      toastSuccess(tx.invoice.copied);
    } catch {
      // Without clipboard access the invoice stays selectable
    }
  }
</script>

<Modal bind:open title={tx.invoice.title}>
  <div class="pay">
    {#if expired}
      <p class="sub" role="status">{tx.invoice.expired}</p>
    {:else}
      <a class="qr-link" href={`lightning:${bolt11}`} aria-label={tx.invoice.openInWallet}>
        <QrCode value={`lightning:${bolt11}`.toUpperCase()} label={tx.invoice.qr} />
      </a>
      <div class="copy-row">
        <code class="mono">{bolt11}</code>
        <Button variant="secondary" size="sm" onclick={copy}>{t().common.copy}</Button>
      </div>
      <a class="wallet" href={`lightning:${bolt11}`}>{tx.invoice.openInWallet}</a>
      <p class="fine" role="status">{tx.invoice.info}</p>
    {/if}
  </div>
</Modal>

<style>
  .pay {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .sub {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .qr-link {
    display: block;
    width: min(220px, 100%);
    margin: 0 auto;
  }
  .copy-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .mono {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: var(--color-bg-subtle);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }
  .wallet {
    align-self: center;
    font-size: var(--text-sm);
  }
  .fine {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
</style>
