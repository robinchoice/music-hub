<script lang="ts">
  import { formatEuro, type GuestPaymentResponse, type PaymentMethod, type PublicDelivery, type PublicPayment } from '@music-hub/shared';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { dateLocale, locale, t } from '$lib/i18n/index.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import { formatIban, guestRequest } from '$lib/utils/delivery.js';
  import QrCode from './QrCode.svelte';

  // Paying the studio directly: an invoice from its Lightning wallet, or a transfer to its account
  let {
    open = $bindable(false),
    token,
    password,
    delivery,
    ondelivery,
  }: {
    open: boolean;
    token: string;
    password: string;
    delivery: PublicDelivery;
    ondelivery: (delivery: PublicDelivery) => void;
  } = $props();

  type Step = 'choose' | 'lightning' | 'transfer' | 'announced';
  let step = $state<Step>('choose');
  let payment = $state<PublicPayment | null>(null);
  let busy = $state<PaymentMethod | 'announce' | null>(null);
  let error = $state('');
  let now = $state(Date.now());

  const tx = $derived(t().delivery.payDialog);
  const euro = (cents: number) => formatEuro(cents, locale());
  // Earlier payments count, only the rest is due
  const total = $derived(euro(delivery.totals.dueCents));
  const files = $derived(delivery.includeStems ? tx.allWavsAndStems : tx.allWavs);
  const stepOf = (p: PublicPayment): Step => (p.method === 'lightning' ? 'lightning' : p.status === 'announced' ? 'announced' : 'transfer');
  const expiresIn = $derived(payment?.expiresAt ? new Date(payment.expiresAt).getTime() - now : null);
  const expired = $derived(payment?.status === 'expired' || (payment?.method === 'lightning' && expiresIn !== null && expiresIn <= 0));

  // An open payment picks up where the client left
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      payment = delivery.openPayment;
      step = payment ? stepOf(payment) : 'choose';
      error = '';
      now = Date.now();
    }
    wasOpen = open;
  });

  function apply(res: GuestPaymentResponse) {
    payment = res.payment;
    ondelivery(res.delivery);
    // Another payment may be the one that arrived, e.g. an invoice from another tab
    if (res.payment.status === 'paid' || res.delivery.status === 'paid') {
      open = false;
      toastSuccess(tx.thanks);
    }
  }

  async function pick(method: PaymentMethod) {
    error = '';
    const reuse = payment && payment.method === method && !expired && (payment.status === 'pending' || payment.status === 'announced');
    if (reuse && payment) {
      step = stepOf(payment);
      return;
    }
    busy = method;
    try {
      apply(await guestRequest<GuestPaymentResponse>(token, '/payments', password, { method }));
      if (payment) step = stepOf(payment);
    } catch (err) {
      error = err instanceof Error ? err.message : tx.failed;
    } finally {
      busy = null;
    }
  }

  async function announce() {
    if (!payment) return;
    busy = 'announce';
    error = '';
    try {
      apply(await guestRequest<GuestPaymentResponse>(token, `/payments/${payment.id}/announce`, password, {}));
      step = 'announced';
    } catch (err) {
      error = err instanceof Error ? err.message : tx.failed;
    } finally {
      busy = null;
    }
  }

  async function poll() {
    if (!payment) return;
    try {
      apply(await guestRequest<GuestPaymentResponse>(token, `/payments/${payment.id}`, password));
    } catch {
      // The next poll tries again
    }
  }

  // The server asks the studio's wallet; the browser never decides that something was paid.
  // An invoice paid in its last seconds only shows up after its expiry, so polling goes on until the
  // server closes it, at most two minutes past it. Polls stay under the API's limit of 600 an hour.
  $effect(() => {
    if (!open || step !== 'lightning' || payment?.status !== 'pending') return;
    const tick = setInterval(() => (now = Date.now()), 1000);
    const check = setInterval(() => {
      if (expiresIn === null || expiresIn > -120_000) void poll();
    }, 6000);
    return () => {
      clearInterval(tick);
      clearInterval(check);
    };
  });

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toastSuccess(tx.copiedWhat(what));
    } catch {
      // Without clipboard access the text stays selectable
    }
  }

  // The amount for a bank form: German banking apps want the comma
  const amountText = (cents: number) => (locale() === 'de' ? (cents / 100).toFixed(2).replace('.', ',') : (cents / 100).toFixed(2));
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  const title = $derived(
    step === 'lightning' ? tx.titleLightning : step === 'transfer' ? tx.titleTransfer : step === 'announced' ? tx.titleAnnounced : tx.titleChoose(total, delivery.studioName),
  );
</script>

<Modal bind:open {title}>
  <div class="pay">
    {#if step === 'choose'}
      <p class="sub">{tx.chooseInfo(delivery.studioName, files)}</p>
      {#if delivery.methods.lightning || delivery.methods.transfer}
        <div class="methods">
          {#if delivery.methods.lightning}
            <button type="button" class="method" disabled={busy !== null} onclick={() => pick('lightning')}>
              <span class="ic" aria-hidden="true">⚡</span>
              <span><b>{tx.lightning}</b><small>{tx.lightningInfo}</small></span>
            </button>
          {/if}
          {#if delivery.methods.transfer}
            <button type="button" class="method" disabled={busy !== null} onclick={() => pick('transfer')}>
              <span class="ic" aria-hidden="true">€</span>
              <span><b>{tx.transfer}</b><small>{tx.transferInfo}</small></span>
            </button>
          {/if}
        </div>
      {:else}
        <p class="sub">{tx.noMethods(delivery.studioName)}</p>
      {/if}
    {:else if step === 'lightning' && payment}
      {#if expired}
        <p class="sub">{tx.invoiceExpired}</p>
        <Button loading={busy === 'lightning'} onclick={() => pick('lightning')}>{tx.newInvoice}</Button>
      {:else if payment.invoice}
        <p class="sub">
          {euro(payment.amountCents)}{#if payment.sats}{' = '}<b>{payment.sats.toLocaleString(dateLocale())} sats</b>{/if}{#if payment.expiresAt}{tx.validUntil}<b>{clock(payment.expiresAt)}</b>{/if}
        </p>
        <a class="qr-link" href="lightning:{payment.invoice}" aria-label={tx.openInWallet}>
          <QrCode value={`lightning:${payment.invoice}`.toUpperCase()} label={tx.qrLightning} />
        </a>
        <div class="copy-row">
          <code class="mono">{payment.invoice}</code>
          <Button variant="secondary" size="sm" onclick={() => copy(payment!.invoice!, tx.copyInvoice)}>{t().common.copy}</Button>
        </div>
        <p class="fine" role="status">{tx.invoiceInfo}</p>
      {/if}
    {:else if (step === 'transfer' || step === 'announced') && payment?.transfer}
      {@const bank = payment.transfer}
      {#if step === 'transfer'}
        <p class="sub">{tx.scanInfo}</p>
        <QrCode value={bank.epcPayload} label={tx.qrTransfer} />
      {:else}
        <p class="sub">{tx.announcedInfo}</p>
      {/if}
      <dl class="kv">
        <dt>{tx.recipient}</dt>
        <dd>{bank.accountHolder}</dd>
        <dt>IBAN</dt>
        <dd><span>{formatIban(bank.iban)}</span><button type="button" class="copy" onclick={() => copy(bank.iban, tx.copyIban)}>{t().common.copy}</button></dd>
        {#if bank.bic}
          <dt>BIC</dt>
          <dd>{bank.bic}</dd>
        {/if}
        <dt>{tx.amount}</dt>
        <dd><span>{euro(payment.amountCents)}</span><button type="button" class="copy" onclick={() => copy(amountText(payment!.amountCents), tx.copyAmount)}>{t().common.copy}</button></dd>
        <dt>{tx.reference}</dt>
        <dd><span>{bank.remittance}</span><button type="button" class="copy" onclick={() => copy(bank.remittance, tx.copyReference)}>{t().common.copy}</button></dd>
      </dl>
      {#if step === 'transfer'}
        <p class="fine">{tx.transferFine}</p>
      {/if}
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
  {#snippet actions()}
    {#if step === 'choose'}
      <Button variant="ghost" onclick={() => (open = false)}>{t().common.cancel}</Button>
    {:else if step === 'transfer'}
      <Button variant="ghost" onclick={() => (step = 'choose')}>{t().common.back}</Button>
      <Button loading={busy === 'announce'} onclick={announce}>{tx.iHaveSent}</Button>
    {:else if step === 'announced'}
      <Button variant="ghost" onclick={() => (step = 'choose')}>{tx.payOtherWay}</Button>
      <Button variant="secondary" onclick={() => (open = false)}>{t().common.close}</Button>
    {:else}
      <Button variant="ghost" onclick={() => (step = 'choose')}>{t().common.back}</Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .pay {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .sub {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  .sub b { color: var(--color-text-primary); }
  .methods {
    display: grid;
    gap: var(--space-2);
  }
  .method {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-raised);
    color: var(--color-text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .method:hover:not(:disabled) { border-color: var(--color-border-hover); }
  .method:disabled { opacity: 0.6; cursor: default; }
  .method b {
    display: block;
    color: var(--color-text-primary);
    font-weight: 600;
  }
  .method small { font-size: var(--text-xs); }
  .ic {
    flex: none;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-md);
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
    font-weight: 700;
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
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
  }
  .kv {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    font-size: var(--text-sm);
  }
  .kv dt { color: var(--color-text-tertiary); }
  .kv dd {
    margin: 0;
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    justify-content: space-between;
    color: var(--color-text-primary);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .copy {
    flex: none;
    background: none;
    border: 0;
    padding: 0;
    color: var(--color-accent);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .fine {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .error { margin: 0; color: var(--color-error); font-size: var(--text-sm); }
</style>
