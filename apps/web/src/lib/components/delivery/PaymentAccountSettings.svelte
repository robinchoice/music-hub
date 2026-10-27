<script lang="ts">
  import { onMount } from 'svelte';
  import type { PaymentAccount, PaymentAccountInput, PaymentAccountResponse } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { t } from '$lib/i18n/index.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';

  // Where clients of a delivery pay: the studio's own Lightning wallet and bank account. Music Hub never holds the money.
  let account = $state<PaymentAccount | null>(null);
  let nwcUrl = $state('');
  let iban = $state('');
  let bic = $state('');
  let holder = $state('');
  let editTransfer = $state(false);
  let saving = $state<'lightning' | 'transfer' | null>(null);
  const tx = $derived(t().delivery.account);

  onMount(async () => {
    account = (await api.get<PaymentAccountResponse>('/payment-account', true).catch(() => null))?.account ?? null;
  });

  async function put(body: PaymentAccountInput, what: 'lightning' | 'transfer', done: string) {
    saving = what;
    try {
      account = (await api.put<PaymentAccountResponse>('/payment-account', body)).account;
      toastSuccess(done);
      return true;
    } catch {
      // The API client already showed the error
      return false;
    } finally {
      saving = null;
    }
  }

  async function connect(e: Event) {
    e.preventDefault();
    if (await put({ nwcUrl: nwcUrl.trim() }, 'lightning', tx.walletConnected)) nwcUrl = '';
  }

  async function saveTransfer(e: Event) {
    e.preventDefault();
    const ok = await put({ iban: iban.trim(), bic: bic.trim() || null, accountHolder: holder.trim() }, 'transfer', tx.accountSaved);
    if (ok) {
      editTransfer = false;
      iban = '';
    }
  }

  function startTransfer() {
    holder = account?.transfer?.accountHolder ?? '';
    bic = account?.transfer?.bic ?? '';
    iban = '';
    editTransfer = true;
  }
</script>

{#if account}
  <section class="card" id="zahlungswege">
    <h2>{tx.title}</h2>
    <p class="sub">{tx.intro}</p>

    <h3>{tx.lightning}</h3>
    {#if !account.lightningAvailable}
      <p class="hint">{tx.notSetUp}</p>
    {:else if account.lightning.connected}
      <div class="line">
        <span class="ok">{tx.walletConnected}{account.lightning.alias ? ` · ${account.lightning.alias}` : ''}{tx.receiveOnly}</span>
        <Button variant="ghost" size="sm" loading={saving === 'lightning'} onclick={() => put({ nwcUrl: null }, 'lightning', tx.walletDisconnected)}>{tx.disconnect}</Button>
      </div>
    {:else}
      <form class="form" onsubmit={connect}>
        <label>
          <span>{tx.codeLabel}</span>
          <input type="password" bind:value={nwcUrl} placeholder="nostr+walletconnect://…" autocomplete="off" />
        </label>
        <p class="hint">{tx.codeHint}</p>
        <Button type="submit" size="sm" loading={saving === 'lightning'} disabled={!nwcUrl.trim().startsWith('nostr+walletconnect://')}>{tx.connectWallet}</Button>
      </form>
    {/if}

    <h3>{tx.transfer}</h3>
    {#if account.transfer && !editTransfer}
      <div class="line">
        <span>
          <b>{account.transfer.accountHolder}</b> · {account.transfer.ibanMasked}{account.transfer.bic ? ` · ${account.transfer.bic}` : ''}
        </span>
        <span class="btns">
          <Button variant="ghost" size="sm" onclick={startTransfer}>{tx.change}</Button>
          <Button variant="ghost" size="sm" loading={saving === 'transfer'} onclick={() => put({ iban: null, bic: null, accountHolder: null }, 'transfer', tx.accountRemoved)}>{t().common.remove}</Button>
        </span>
      </div>
    {:else}
      <form class="form" onsubmit={saveTransfer}>
        <label><span>{tx.holder}</span><input bind:value={holder} maxlength={70} autocomplete="name" /></label>
        <label><span>IBAN</span><input bind:value={iban} maxlength={42} placeholder="DE12 3456 …" autocomplete="off" /></label>
        <label><span>{tx.bicOptional}</span><input bind:value={bic} maxlength={11} autocomplete="off" /></label>
        <p class="hint">{tx.transferHint}</p>
        <span class="btns">
          {#if account.transfer}<Button variant="ghost" size="sm" onclick={() => (editTransfer = false)}>{t().common.cancel}</Button>{/if}
          <Button type="submit" size="sm" loading={saving === 'transfer'} disabled={!iban.trim() || !holder.trim()}>{tx.saveAccount}</Button>
        </span>
      </form>
    {/if}
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
  h3 { margin: var(--space-5) 0 var(--space-2); font-size: var(--text-base); }
  .sub, .hint {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .line b { color: var(--color-text-primary); font-weight: 600; }
  .ok { color: var(--color-success); font-weight: 600; }
  .btns { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: flex-start;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  input {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    width: 100%;
  }
  @media (max-width: 640px) {
    .card { padding: var(--space-4); }
  }
</style>
