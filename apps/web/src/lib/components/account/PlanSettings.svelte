<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    formatEuro,
    PLAN_CONSENT,
    PLAN_PRICES,
    PLAN_STORAGE,
    PLANS,
    type BillingCancelResponse,
    type BillingMethod,
    type BillingView,
    type BillingWithdrawResponse,
    type Plan,
    type PlanPeriod,
  } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { dateLocale, locale, t } from '$lib/i18n/index.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import { formatGb } from '$lib/utils/format.js';
  import Button from '$lib/components/ui/Button.svelte';

  // The running plan and buying Pro or Studio (lib/billing.ts in the API). Shown once there is a plan or something to buy.
  let view = $state<BillingView | null>(null);
  let period = $state<PlanPeriod>('year');
  let busy = $state<string | null>(null);
  // The express request to start right away; buying waits for it
  let consent = $state(false);
  // Two steps for ending a contract: the button, then "now"
  let confirming = $state<'cancel' | string | null>(null);
  let done = $state<string | null>(null);
  const tx = $derived(t().billing);
  const day = (iso: string) => new Date(iso).toLocaleDateString(dateLocale());

  onMount(async () => {
    view = await api.get<BillingView>('/billing', true).catch(() => null);
    if (page.url.searchParams.get('plan') === 'paid') {
      toastSuccess(t().billing.thanks);
      await goto('/account', { replaceState: true, noScroll: true, keepFocus: true });
    }
  });

  async function open(path: string, body: unknown, key: string) {
    busy = key;
    try {
      const { url } = await api.post<{ url: string }>(path, body);
      window.location.href = url;
    } catch {
      // The API client already showed the error
      busy = null;
    }
  }

  const buy = (plan: Plan, method: BillingMethod) => open('/billing/checkout', { plan, period, method, consent }, `${plan}-${method}`);
  const euro = (cents: number) => formatEuro(cents, locale());

  async function end(kind: 'cancel' | 'withdraw', paymentId?: string) {
    busy = kind;
    try {
      if (kind === 'cancel') {
        const r = await api.post<BillingCancelResponse>('/billing/cancel');
        done = `${tx.cancelled(day(r.endsAt))}${r.refundCents ? ` ${tx.refund(euro(r.refundCents))}` : ''}`;
      } else {
        const r = await api.post<BillingWithdrawResponse>('/billing/withdraw', { paymentId });
        done = tx.withdrawn(euro(r.refundCents));
      }
      confirming = null;
      view = await api.get<BillingView>('/billing', true).catch(() => view);
    } catch {
      // The API client already showed the error
    } finally {
      busy = null;
    }
  }
  const methodsFor = (plan: Plan) => view?.canBuy.find((b) => b.plan === plan)?.methods ?? [];
</script>

{#if view && (view.plan || view.renews || view.canBuy.length)}
  <section class="card" id="tarif">
    <h2>{tx.title}</h2>
    <p class="status">
      <b>
        {#if !view.plan}{tx.free}
        {:else if view.planUntil}{tx.runsUntil(tx.names[view.plan], day(view.planUntil))}
        {:else}{tx.noEnd(tx.names[view.plan])}{/if}
      </b>
      · {tx.used(formatGb(view.storage.usedBytes), formatGb(view.storage.limitBytes))}
    </p>
    {#if view.plan && view.planUntil}
      <p class="sub">{view.renews ? tx.renews : tx.ends}</p>
    {/if}
    {#if done}<p class="done" role="status">{done}</p>{/if}
    {#if view.renews}
      {#if confirming === 'cancel'}
        <div class="confirm">
          <p>{tx.cancelConfirm(view.plan ? tx.names[view.plan] : tx.title)}</p>
          <span class="btns">
            <Button variant="danger" size="sm" loading={busy === 'cancel'} onclick={() => end('cancel')}>{tx.cancelNow}</Button>
            <Button variant="ghost" size="sm" onclick={() => (confirming = null)}>{tx.cancel}</Button>
          </span>
        </div>
      {:else}
        <span class="btns">
          <Button variant="secondary" size="sm" onclick={() => (confirming = 'cancel')}>{tx.cancelHere}</Button>
          <Button variant="ghost" size="sm" loading={busy === 'portal'} onclick={() => open('/billing/portal', undefined, 'portal')}>{tx.manage}</Button>
        </span>
      {/if}
    {/if}

    {#if view.canBuy.length}
      {#if !view.plan}<p class="sub">{tx.intro}</p>{/if}
      <div class="periods" role="radiogroup" aria-label={tx.title}>
        {#each ['month', 'year'] as const as p (p)}
          <button type="button" role="radio" aria-checked={period === p} class:active={period === p} onclick={() => (period = p)}>
            {tx[p]}{#if p === 'year'}<small>&nbsp;· {tx.yearHint}</small>{/if}
          </button>
        {/each}
      </div>
      <label class="consent">
        <input type="checkbox" bind:checked={consent} />
        <span>{PLAN_CONSENT[locale()]} (<a href="/agb" target="_blank">{tx.terms}</a>, <a href="/datenschutz" target="_blank">{tx.privacy}</a>)</span>
      </label>
      <div class="plans">
        {#each PLANS.filter((p) => methodsFor(p).length) as plan (plan)}
          <div class="plan">
            <h3>{tx.names[plan]}</h3>
            <p class="price"><b>{formatEuro(PLAN_PRICES[plan][period], locale())}</b> {tx.perPeriod[period]}</p>
            <ul>
              <li>{tx.storage(`${PLAN_STORAGE[plan] / 1024 ** 3} GB`)}</li>
              {#each tx.features[plan] as feature (feature)}<li>{feature}</li>{/each}
            </ul>
            <span class="btns">
              {#if view.plan}
                <Button size="sm" disabled={!consent} loading={busy === `${plan}-lightning`} onclick={() => buy(plan, 'lightning')}>{tx.extend(tx.extendPeriod[period])}</Button>
              {:else}
                {#each methodsFor(plan) as method (method)}
                  <Button size="sm" disabled={!consent} variant={method === 'stripe' ? 'primary' : 'secondary'} loading={busy === `${plan}-${method}`} onclick={() => buy(plan, method)}>
                    {method === 'stripe' ? tx.payStripe : tx.payLightning}
                  </Button>
                {/each}
              {/if}
            </span>
          </div>
        {/each}
      </div>
      <p class="hint">{tx.conditions}</p>
    {/if}

    {#if view.payments.length}
      <h3>{tx.payments}</h3>
      <ul class="payments">
        {#each view.payments as p (p.id)}
          <li>
            <span>{day(p.createdAt)} · {tx.names[p.plan]} · {formatEuro(p.amountCents, locale())} · {p.method === 'stripe' ? tx.payStripe : tx.payLightning}</span>
            {#if p.checkoutUrl}
              <a href={p.checkoutUrl} rel="noopener">{tx.openInvoice}</a>
            {:else if p.withdrawUntil && p.withdrawUntil > new Date().toISOString()}
              <button type="button" class="link" onclick={() => (confirming = p.id)}>{tx.withdraw(day(p.withdrawUntil))}</button>
            {:else}
              <span class="state">{p.withdrawnAt ? tx.withdrawnState : tx.status[p.status]}</span>
            {/if}
            {#if confirming === p.id}
              <div class="confirm">
                <p>{tx.withdrawConfirm}</p>
                <span class="btns">
                  <Button variant="danger" size="sm" loading={busy === 'withdraw'} onclick={() => end('withdraw', p.id)}>{tx.withdrawNow}</Button>
                  <Button variant="ghost" size="sm" onclick={() => (confirming = null)}>{tx.cancel}</Button>
                </span>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
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
  .status { margin: 0 0 var(--space-2); font-size: var(--text-sm); color: var(--color-text-secondary); }
  .status b { color: var(--color-text-primary); font-weight: 600; }
  .sub, .hint {
    margin: 0 0 var(--space-3);
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  .hint { margin-top: var(--space-3); font-size: var(--text-xs); }
  .periods {
    display: inline-flex;
    margin: var(--space-4) 0 var(--space-3);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .periods button {
    padding: var(--space-2) var(--space-3);
    background: none;
    border: none;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .periods button.active { background: var(--color-bg-base); color: var(--color-text-primary); font-weight: 600; }
  .periods small { color: var(--color-text-tertiary); font-weight: 400; }
  .plans {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  .plan {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }
  .plan h3 { margin: 0; }
  .price { margin: 0; font-size: var(--text-sm); color: var(--color-text-secondary); }
  .price b { font-size: var(--text-lg); color: var(--color-text-primary); }
  .plan ul { margin: 0; padding-left: var(--space-4); font-size: var(--text-sm); color: var(--color-text-secondary); flex: 1; }
  .btns { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .payments { list-style: none; margin: 0; padding: 0; font-size: var(--text-sm); color: var(--color-text-secondary); }
  .payments li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-2) 0;
    border-top: 1px solid var(--color-border);
  }
  .state { color: var(--color-text-tertiary); }
  .done { margin: 0 0 var(--space-3); font-size: var(--text-sm); color: var(--color-success); }
  .confirm {
    flex-basis: 100%;
    margin: var(--space-2) 0;
    padding: var(--space-3);
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .confirm p { margin: 0 0 var(--space-3); }
  .consent {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .consent input { margin-top: 3px; }
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--color-accent, inherit);
    text-decoration: underline;
    cursor: pointer;
  }
  @media (max-width: 640px) {
    .card { padding: var(--space-4); }
  }
</style>
