<script lang="ts">
  import { formatEuro, type GuestPaymentResponse, type PaymentMethod, type PublicDelivery, type PublicPayment } from '@music-hub/shared';
  import Button from '$lib/components/ui/Button.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
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

  // Earlier payments count, only the rest is due
  const total = $derived(formatEuro(delivery.totals.dueCents));
  const files = $derived(delivery.includeStems ? 'alle WAVs und Spuren' : 'alle WAVs');
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
      toastSuccess('Danke! Die Zahlung ist angekommen. Die Dateien stehen bereit.');
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
      error = err instanceof Error ? err.message : 'Das hat nicht geklappt.';
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
      error = err instanceof Error ? err.message : 'Das hat nicht geklappt.';
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
      toastSuccess(`${what} kopiert`);
    } catch {
      // Without clipboard access the text stays selectable
    }
  }

  const clock = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const title = $derived(
    step === 'lightning' ? 'Mit Lightning bezahlen' : step === 'transfer' ? 'Per Überweisung bezahlen' : step === 'announced' ? 'Überweisung angekündigt' : `${total} an ${delivery.studioName}`,
  );
</script>

<Modal bind:open {title}>
  <div class="pay">
    {#if step === 'choose'}
      <p class="sub">Du bezahlst direkt an {delivery.studioName}. Danach lädst du {files} herunter.</p>
      {#if delivery.methods.lightning || delivery.methods.transfer}
        <div class="methods">
          {#if delivery.methods.lightning}
            <button type="button" class="method" disabled={busy !== null} onclick={() => pick('lightning')}>
              <span class="ic" aria-hidden="true">⚡</span>
              <span><b>Lightning</b><small>Sofort, mit jeder Lightning-Wallet.</small></span>
            </button>
          {/if}
          {#if delivery.methods.transfer}
            <button type="button" class="method" disabled={busy !== null} onclick={() => pick('transfer')}>
              <span class="ic" aria-hidden="true">€</span>
              <span><b>Überweisung</b><small>Mit GiroCode aus der Banking-App. Der Download kommt, sobald das Studio den Eingang bestätigt.</small></span>
            </button>
          {/if}
        </div>
      {:else}
        <p class="sub">{delivery.studioName} hat noch keinen Zahlungsweg eingerichtet. Bitte melde dich direkt beim Studio.</p>
      {/if}
    {:else if step === 'lightning' && payment}
      {#if expired}
        <p class="sub">Diese Rechnung ist abgelaufen. Die neue gilt wieder 15 Minuten, zum aktuellen Kurs.</p>
        <Button loading={busy === 'lightning'} onclick={() => pick('lightning')}>Neue Rechnung</Button>
      {:else if payment.invoice}
        <p class="sub">
          {formatEuro(payment.amountCents)}{#if payment.sats}{' = '}<b>{payment.sats.toLocaleString('de-DE')} sats</b>{/if}{#if payment.expiresAt}{' · gültig bis '}<b>{clock(payment.expiresAt)}</b>{/if}
        </p>
        <a class="qr-link" href="lightning:{payment.invoice}" aria-label="In der Wallet öffnen">
          <QrCode value={`lightning:${payment.invoice}`.toUpperCase()} label="QR-Code der Lightning-Rechnung" />
        </a>
        <div class="copy-row">
          <code class="mono">{payment.invoice}</code>
          <Button variant="secondary" size="sm" onclick={() => copy(payment!.invoice!, 'Rechnung')}>Kopieren</Button>
        </div>
        <p class="fine" role="status">Die Rechnung kommt direkt aus der Wallet des Studios. Sobald sie bezahlt ist, geht es hier von selbst weiter.</p>
      {/if}
    {:else if (step === 'transfer' || step === 'announced') && payment?.transfer}
      {@const t = payment.transfer}
      {#if step === 'transfer'}
        <p class="sub">Scanne den GiroCode mit deiner Banking-App oder übernimm die Daten.</p>
        <QrCode value={t.epcPayload} label="GiroCode für die Überweisung" />
      {:else}
        <p class="sub">Das Studio sieht deine Ankündigung und gibt den Download frei, sobald das Geld da ist. Meist am nächsten Werktag.</p>
      {/if}
      <dl class="kv">
        <dt>Empfänger</dt>
        <dd>{t.accountHolder}</dd>
        <dt>IBAN</dt>
        <dd><span>{formatIban(t.iban)}</span><button type="button" class="copy" onclick={() => copy(t.iban, 'IBAN')}>Kopieren</button></dd>
        {#if t.bic}
          <dt>BIC</dt>
          <dd>{t.bic}</dd>
        {/if}
        <dt>Betrag</dt>
        <dd><span>{formatEuro(payment.amountCents)}</span><button type="button" class="copy" onclick={() => copy((payment!.amountCents / 100).toFixed(2).replace('.', ','), 'Betrag')}>Kopieren</button></dd>
        <dt>Zweck</dt>
        <dd><span>{t.remittance}</span><button type="button" class="copy" onclick={() => copy(t.remittance, 'Verwendungszweck')}>Kopieren</button></dd>
      </dl>
      {#if step === 'transfer'}
        <p class="fine">Sobald das Studio den Eingang bestätigt, kannst du hier herunterladen.</p>
      {/if}
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
  {#snippet actions()}
    {#if step === 'choose'}
      <Button variant="ghost" onclick={() => (open = false)}>Abbrechen</Button>
    {:else if step === 'transfer'}
      <Button variant="ghost" onclick={() => (step = 'choose')}>Zurück</Button>
      <Button loading={busy === 'announce'} onclick={announce}>Ich habe überwiesen</Button>
    {:else if step === 'announced'}
      <Button variant="ghost" onclick={() => (step = 'choose')}>Doch anders bezahlen</Button>
      <Button variant="secondary" onclick={() => (open = false)}>Schließen</Button>
    {:else}
      <Button variant="ghost" onclick={() => (step = 'choose')}>Zurück</Button>
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
