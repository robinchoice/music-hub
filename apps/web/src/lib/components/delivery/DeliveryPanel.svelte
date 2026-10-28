<script lang="ts">
  import { ask } from '$lib/stores/confirm.js';
  import { onMount } from 'svelte';
  import {
    DEFAULT_INCLUDED_ROUNDS,
    formatEuro,
    type DeliveryListResponse,
    type DeliveryResponse,
    type PaymentAccountResponse,
    type PaymentAccount,
    type StudioDelivery,
    type StudioPayment,
    type StudioDeliveryTrack,
  } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { toastError, toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import { dateLocale, locale, t } from '$lib/i18n/index.js';
  import { STUDIO_STATE_LABELS, euroInput, parseEuro, roundDots, roundsText } from '$lib/utils/delivery.js';

  // The owner's view of the project's delivery: create it, follow the client's decisions, confirm payment
  let { projectId, tracks }: { projectId: string; tracks: { id: string; name: string }[] } = $props();

  let list = $state<DeliveryListResponse | null>(null);
  let account = $state<PaymentAccount | null>(null);
  let failed = $state(false);
  let editing = $state(false);
  let saving = $state(false);
  let busy = $state<string | null>(null);
  // Not t, the tracks in this file are called t
  const tx = $derived(t().delivery.panel);
  const common = $derived(t().common);
  const euro = (cents: number) => formatEuro(cents, locale());

  const active = $derived(list?.deliveries.find((d) => d.status !== 'cancelled') ?? null);

  // ---------- Form ----------
  let clientName = $state('');
  let clientEmail = $state('');
  let reference = $state('');
  let price = $state('');
  let includedRounds = $state(DEFAULT_INCLUDED_ROUNDS);
  let extraRound = $state('40');
  let includeStems = $state(true);
  let chosen = $state<Record<string, boolean>>({});
  let override = $state<Record<string, string>>({});

  function fillForm(d: StudioDelivery | null) {
    clientName = d?.clientName ?? '';
    clientEmail = d?.clientEmail ?? '';
    reference = d?.reference ?? '';
    includedRounds = d?.includedRounds ?? DEFAULT_INCLUDED_ROUNDS;
    extraRound = d ? euroInput(d.extraRoundCents) : '40';
    includeStems = d?.includeStems ?? true;
    // The most common price is the default, the others are overrides
    const prices = d?.tracks.map((t) => t.priceCents) ?? [];
    const common = prices.sort((a, b) => prices.filter((p) => p === b).length - prices.filter((p) => p === a).length)[0];
    price = common === undefined ? '' : euroInput(common);
    chosen = Object.fromEntries(tracks.map((t) => [t.id, d ? d.tracks.some((dt) => dt.trackId === t.id) : true]));
    override = Object.fromEntries(
      (d?.tracks ?? []).filter((t) => t.priceCents !== common).map((t) => [t.trackId, euroInput(t.priceCents)]),
    );
  }

  const priceCents = $derived(parseEuro(price));
  const extraCents = $derived(parseEuro(extraRound));
  const picked = $derived(tracks.filter((t) => chosen[t.id]));
  const lines = $derived(picked.map((t) => ({ trackId: t.id, priceCents: override[t.id]?.trim() ? parseEuro(override[t.id]!) : priceCents })));
  const formTotal = $derived(lines.reduce((s, l) => s + (l.priceCents ?? 0), 0));
  const formValid = $derived(
    clientName.trim().length > 0 && extraCents !== null && lines.length > 0 && lines.every((l) => l.priceCents !== null),
  );

  async function load() {
    failed = false;
    try {
      list = await api.get<DeliveryListResponse>(`/deliveries/project/${projectId}`, true);
      account = (await api.get<PaymentAccountResponse>('/payment-account', true).catch(() => null))?.account ?? null;
      if (!active) fillForm(null);
    } catch {
      failed = true;
    }
  }

  onMount(load);

  function replace(d: StudioDelivery) {
    if (!list) return;
    const others = list.deliveries.filter((x) => x.id !== d.id);
    list = { ...list, deliveries: [d, ...others] };
  }

  async function save(e: Event) {
    e.preventDefault();
    if (!formValid || extraCents === null) return;
    saving = true;
    const body = {
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim() || null,
      reference: reference.trim() || null,
      includedRounds,
      extraRoundCents: extraCents,
      includeStems,
      tracks: lines.map((l) => ({ trackId: l.trackId, priceCents: l.priceCents ?? 0 })),
    };
    try {
      const res = active
        ? await api.patch<DeliveryResponse>(`/deliveries/${active.id}`, body)
        : await api.post<DeliveryResponse>(`/deliveries/project/${projectId}`, body);
      replace(res.delivery);
      editing = false;
      toastSuccess(active ? tx.orderSaved : tx.orderCreated);
    } catch {
      // The API client already showed the error
    } finally {
      saving = false;
    }
  }

  async function act(key: string, path: string, body: unknown, done: string) {
    busy = key;
    try {
      const res = await api.post<DeliveryResponse>(path, body);
      replace(res.delivery);
      toastSuccess(done);
    } catch {
      // The API client already showed the error
    } finally {
      busy = null;
    }
  }

  const gift = (d: StudioDelivery, t: StudioDeliveryTrack) =>
    act(`gift:${t.trackId}`, `/deliveries/${d.id}/tracks/${t.trackId}/gift`, {}, tx.roundGifted(t.name));

  async function confirmPayment(d: StudioDelivery, p: StudioPayment) {
    const where = p.method === 'lightning' ? tx.inYourWallet : tx.onYourAccount;
    const then = d.status === 'open' ? tx.confirmThenOpen(d.clientName) : tx.confirmThenRefund;
    if (!(await ask(`${tx.confirmPaid(euro(p.amountCents), where)}${then}`))) return;
    void act(`pay:${p.id}`, `/deliveries/${d.id}/payments/${p.id}/confirm`, {}, tx.paymentConfirmed);
  }

  async function cancel(d: StudioDelivery) {
    if (!(await ask(tx.confirmCancel(d.clientName)))) return;
    void act('cancel', `/deliveries/${d.id}/cancel`, {}, tx.orderCanceled);
  }

  function startEdit() {
    fillForm(active);
    editing = true;
  }

  async function copyLink(d: StudioDelivery) {
    try {
      await navigator.clipboard.writeText(linkOf(d));
      toastSuccess(tx.linkCopied);
    } catch {
      toastError(tx.copyFailed);
    }
  }

  const linkOf = (d: StudioDelivery) => `${location.origin}/album/${d.linkToken}`;
  const nameOf = (d: StudioDelivery, trackId: string) => d.tracks.find((t) => t.trackId === trackId)?.name ?? tx.songFallback;
  const day = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  const openTransfer = (d: StudioDelivery) => d.payments.find((p) => p.method === 'transfer' && (p.status === 'pending' || p.status === 'announced'));
  // Money can arrive for any payment not marked paid: a transfer even after it expired, a Lightning
  // invoice the wallet got while nobody looked it up
  const confirmable = (d: StudioDelivery, p: StudioPayment) => p.status !== 'paid' && (p.method === 'transfer' || d.status === 'open');
  const canGift = (d: StudioDelivery, t: StudioDeliveryTrack) => d.status === 'open' && t.state !== 'approved' && t.nextRoundExtra;
  // The client can only pay once the studio offers a way
  const noWayToPay = $derived(!!account && !account.transfer && !(account.lightning.connected && account.lightningAvailable));
</script>

<section class="panel" aria-label={tx.ariaLabel}>
  {#if failed}
    <p class="muted">{tx.loadFailed} <button type="button" class="link" onclick={load}>{common.retry}</button></p>
  {:else if !list}
    <Skeleton height="6rem" variant="rect" />
  {:else if !active && !list.canCreate}
    <div class="box intro">
      <h3>{tx.introTitle}</h3>
      <p>{tx.intro}</p>
      <p class="muted">{tx.introPlan}</p>
    </div>
  {:else if !active || editing}
    {@render form()}
  {:else}
    {@const d = active}
    {@const transfer = openTransfer(d)}
    {@const gifting = d.tracks.some((t) => canGift(d, t))}
    {#if transfer?.status === 'announced' && d.status === 'open'}
      <div class="alert" role="status">
        <span><b>{tx.announcedBold(d.clientName, euro(transfer.amountCents))}</b> {tx.announcedRest}</span>
        <Button size="sm" loading={busy === `pay:${transfer.id}`} onclick={() => confirmPayment(d, transfer)}>{tx.paymentReceived}</Button>
      </div>
    {/if}
    {#if noWayToPay && d.status === 'open'}
      {@render noWay(d.clientName)}
    {/if}

    <div class="cols">
      <div class="main">
        <div class="box">
          <h3>
            {tx.songsAndRounds}
            <span class="chip {d.status}">{d.status === 'paid' ? tx.paid : tx.open}</span>
          </h3>
          <table>
            <thead>
              <tr><th>{tx.colSong}</th><th class="wide">{tx.colVersion}</th><th>{tx.colRounds}</th><th>{tx.colStatus}</th><th class="num">{tx.colPrice}</th>{#if gifting}<th></th>{/if}</tr>
            </thead>
            <tbody>
              {#each d.tracks as t (t.trackId)}
                <tr>
                  <td class="song"><b>{t.name}</b></td>
                  <td class="wide">{t.shownVersionNumber ? `V${t.shownVersionNumber}` : '–'}</td>
                  <td class="rounds">
                    <span class="dots" title={roundsText(t)}>
                      {#each roundDots(t) as dot, k (k)}<i class:used={dot.used} class:extra={dot.extra} class:gifted={dot.gifted}></i>{/each}
                    </span>
                    <small>{t.roundsUsed - t.extraRounds}/{t.roundsIncluded}{t.extraRounds ? ` · +${euro(t.extraCents)}` : ''}</small>
                  </td>
                  <td class="status"><span class="chip {t.state}">{STUDIO_STATE_LABELS[t.state]}</span></td>
                  <td class="num">{euro(t.priceCents)}</td>
                  {#if gifting}
                    <td class="act" class:idle={!canGift(d, t)}>
                      {#if canGift(d, t)}
                        <Button variant="ghost" size="sm" loading={busy === `gift:${t.trackId}`} onclick={() => gift(d, t)}>{tx.giftRound}</Button>
                      {/if}
                    </td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
          {#if d.rounds.length}
            <ul class="feed">
              {#each [...d.rounds].reverse().slice(0, 6) as r (r.id)}
                <li>
                  <span>{day(r.createdAt)}</span>
                  {tx.feedEntry(r.guestName ?? tx.clientFallback, nameOf(d, r.trackId), r.versionNumber)}{r.extra ? tx.feedExtra : ''}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div class="box">
          <h3>{tx.clientLink}</h3>
          <div class="link-row">
            <input readonly value={linkOf(d)} aria-label={tx.clientLinkLabel} onfocus={(e) => e.currentTarget.select()} />
            <Button variant="secondary" size="sm" onclick={() => copyLink(d)}>{common.copy}</Button>
          </div>
          <p class="fine">{tx.clientLinkInfo(d.includeStems)}</p>
        </div>
      </div>

      <div class="side">
        <div class="box">
          <h3>{tx.order}</h3>
          <dl class="facts">
            <dt>{tx.client}</dt>
            <dd>{d.clientName}{#if d.clientEmail}<small>{d.clientEmail}</small>{/if}</dd>
            {#if d.reference}<dt>{tx.reference}</dt><dd>{d.reference}</dd>{/if}
            <dt>{tx.roundsIncluded}</dt>
            <dd>{tx.perSong(d.includedRounds)}</dd>
            <dt>{tx.eachFurther}</dt>
            <dd>{tx.onFinalInvoice(euro(d.extraRoundCents))}</dd>
            <dt>{tx.download}</dt>
            <dd>{tx.downloadAfterPayment(d.includeStems)}</dd>
          </dl>
          {#if d.status === 'open'}
            <div class="row">
              <Button variant="secondary" size="sm" onclick={startEdit}>{tx.edit}</Button>
              <Button variant="danger" size="sm" loading={busy === 'cancel'} onclick={() => cancel(d)}>{tx.cancelOrder}</Button>
            </div>
          {/if}
        </div>

        <div class="box">
          <h3>{tx.billing}</h3>
          <dl class="bill">
            <dt>{common.songs(d.totals.trackCount)}</dt>
            <dd>{euro(d.totals.songsCents)}</dd>
            <dt>{t().delivery.utils.extraRounds(d.totals.extraRounds)}</dt>
            <dd>{euro(d.totals.extraCents)}</dd>
            <dt class="total">{tx.total}</dt>
            <dd class="total">{euro(d.totals.totalCents)}</dd>
            {#if d.totals.paidCents}
              <dt>{tx.received}</dt>
              <dd>{euro(d.totals.paidCents)}</dd>
              {#if d.status === 'open'}
                <dt>{tx.due}</dt>
                <dd>{euro(d.totals.dueCents)}</dd>
              {:else if d.totals.paidCents > d.totals.totalCents}
                <dt>{tx.overpaid}</dt>
                <dd>{euro(d.totals.paidCents - d.totals.totalCents)}</dd>
              {/if}
            {/if}
          </dl>
          <p class="fine">
            {#if d.status === 'paid'}
              {tx.paidOn(d.paidAt ? day(d.paidAt) : null)}
            {:else if d.payable}
              {tx.allApproved}
            {:else}
              {tx.approvedOf(d.totals.approvedCount, d.totals.trackCount)}
            {/if}
          </p>
          {#if d.payments.length}
            <ul class="payments">
              {#each d.payments as p (p.id)}
                <li>
                  <span>{p.method === 'lightning' ? tx.lightning : tx.transfer} · {tx.paymentStatus[p.status]}</span>
                  <span class="num">{euro(p.amountCents)}</span>
                  {#if confirmable(d, p) && !(p.id === transfer?.id && p.status === 'announced')}
                    <Button variant="ghost" size="sm" loading={busy === `pay:${p.id}`} onclick={() => confirmPayment(d, p)}>
                      {p.method === 'lightning' ? tx.markPaid : tx.paymentReceived}
                    </Button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div class="box">
          <h3>{tx.yourWays}</h3>
          <ul class="ways">
            <li><span>{tx.lightning}</span><span class:ok={account?.lightning.connected}>{account?.lightning.connected ? `${tx.connected}${account.lightning.alias ? ` · ${account.lightning.alias}` : ''}` : tx.notConnected}</span></li>
            <li><span>{tx.transfer}</span><span class:ok={!!account?.transfer}>{account?.transfer ? account.transfer.ibanMasked : tx.noIban}</span></li>
          </ul>
          <p class="fine">{tx.waysInfo} <a href="/account#zahlungswege">{tx.setUpWays}</a></p>
        </div>
      </div>
    </div>
  {/if}
</section>

{#snippet noWay(client: string)}
  <div class="alert" role="status">
    <span><b>{tx.noWayBold}</b> {tx.noWayRest(client)}</span>
    <a href="/account#zahlungswege">{tx.setUpWay}</a>
  </div>
{/snippet}

{#snippet form()}
  <form class="box form" onsubmit={save}>
    <h3>{active ? tx.editOrder : tx.newOrder}</h3>
    {#if !active}
      <p class="fine">{tx.newOrderInfo}</p>
    {/if}
    {#if noWayToPay}
      {@render noWay(clientName.trim() || tx.yourClient)}
    {/if}
    <div class="grid">
      <label><span>{tx.fieldClient}</span><input bind:value={clientName} maxlength={255} required placeholder={tx.fieldClientPlaceholder} /></label>
      <label><span>{tx.fieldMail}</span><input type="email" bind:value={clientEmail} maxlength={255} placeholder={tx.fieldMailPlaceholder} /></label>
      <label><span>{tx.fieldReference}</span><input bind:value={reference} maxlength={64} placeholder={tx.fieldReferencePlaceholder} /></label>
      <label><span>{tx.fieldPrice}</span><input bind:value={price} inputmode="decimal" placeholder="120" /></label>
      <label><span>{tx.fieldRounds}</span><input type="number" min="0" max="20" bind:value={includedRounds} /></label>
      <label><span>{tx.fieldExtraRound}</span><input bind:value={extraRound} inputmode="decimal" placeholder="40" /></label>
    </div>
    <label class="check"><input type="checkbox" bind:checked={includeStems} /> {tx.includeStems}</label>

    <fieldset>
      <legend>{tx.songs}</legend>
      {#if tracks.length === 0}
        <p class="muted">{tx.noSongs}</p>
      {/if}
      {#each tracks as t (t.id)}
        <div class="song">
          <label class="check"><input type="checkbox" bind:checked={chosen[t.id]} /> {t.name}</label>
          {#if chosen[t.id]}
            <input
              class="override"
              inputmode="decimal"
              aria-label={tx.priceFor(t.name)}
              placeholder={priceCents !== null ? euroInput(priceCents) : tx.pricePlaceholder}
              bind:value={override[t.id]}
            />
          {/if}
        </div>
      {/each}
    </fieldset>

    <div class="row end">
      <span class="sumline">{common.songs(lines.length)} · {euro(formTotal)}</span>
      {#if active}
        <Button variant="ghost" onclick={() => (editing = false)}>{common.cancel}</Button>
      {/if}
      <Button type="submit" loading={saving} disabled={!formValid}>{active ? common.save : tx.createOrder}</Button>
    </div>
  </form>
{/snippet}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-top: var(--space-5);
  }
  .box {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4) var(--space-5);
  }
  .box + .box { margin-top: var(--space-4); }
  h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    font-size: var(--text-base);
  }
  .intro p { margin: 0 0 var(--space-3); color: var(--color-text-secondary); font-size: var(--text-sm); max-width: 62ch; }
  .muted { margin: 0; color: var(--color-text-tertiary); font-size: var(--text-sm); }
  .fine { margin: var(--space-3) 0 0; color: var(--color-text-tertiary); font-size: var(--text-xs); }
  .form .fine { margin: 0 0 var(--space-4); }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--color-accent);
    font: inherit;
    cursor: pointer;
  }
  .alert {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-warning) 12%, var(--color-bg-raised));
    border: 1px solid color-mix(in srgb, var(--color-warning) 40%, transparent);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .alert b { color: var(--color-text-primary); }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: var(--space-4);
    align-items: start;
  }
  table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
  th {
    text-align: left;
    padding: 0 var(--space-2) var(--space-2);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-tertiary);
  }
  td {
    padding: var(--space-3) var(--space-2);
    border-top: 1px solid var(--color-border);
    vertical-align: middle;
    color: var(--color-text-secondary);
  }
  td b { color: var(--color-text-primary); font-weight: 600; }
  td small { font-size: var(--text-xs); margin-left: var(--space-1); }
  td.song { min-width: 12rem; width: 100%; }
  td.rounds { white-space: nowrap; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .act { text-align: right; white-space: nowrap; }
  .chip {
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 1px 8px;
    border-radius: var(--radius-full);
    white-space: nowrap;
    background: var(--color-bg-subtle);
    color: var(--color-text-secondary);
  }
  .chip.review, .chip.open { color: var(--color-accent); background: var(--color-accent-subtle); }
  .chip.changes { color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 14%, transparent); }
  .chip.approved, .chip.paid { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 14%, transparent); }
  .dots { display: inline-flex; gap: 4px; align-items: center; vertical-align: middle; }
  .dots i { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--color-text-tertiary); }
  .dots i.used { background: var(--color-text-secondary); border-color: var(--color-text-secondary); }
  .dots i.extra { border-color: var(--color-warning); }
  .dots i.extra.used { background: var(--color-warning); }
  .dots i.gifted { border-color: var(--color-success); }
  .dots i.gifted.used { background: var(--color-success); }
  .feed, .payments, .ways {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .feed li { display: flex; gap: var(--space-3); }
  .feed span { flex: none; width: 6.5rem; color: var(--color-text-tertiary); }
  .payments li, .ways li { display: flex; align-items: center; gap: var(--space-2); justify-content: space-between; flex-wrap: wrap; }
  .ways .ok { color: var(--color-success); }
  .link-row { display: flex; gap: var(--space-2); }
  .link-row input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .facts, .bill {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    font-size: var(--text-sm);
  }
  .facts dt, .bill dt { color: var(--color-text-tertiary); }
  .facts dd, .bill dd { margin: 0; color: var(--color-text-primary); }
  .facts small { display: block; color: var(--color-text-tertiary); font-size: var(--text-xs); }
  .bill dd { text-align: right; font-variant-numeric: tabular-nums; }
  .bill .total { padding-top: var(--space-2); border-top: 1px solid var(--color-border); color: var(--color-text-primary); font-weight: 700; }
  .row { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; margin-top: var(--space-4); }
  .row.end { justify-content: flex-end; }
  .sumline { margin-right: auto; color: var(--color-text-secondary); font-size: var(--text-sm); }

  .form { max-width: 760px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-3) var(--space-4);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  input:not([type='checkbox']) {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    width: 100%;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
    cursor: pointer;
  }
  input[type='checkbox'] { accent-color: var(--color-accent); }
  fieldset {
    margin: var(--space-4) 0 0;
    padding: var(--space-3) 0 0;
    border: 0;
    border-top: 1px solid var(--color-border);
  }
  legend { font-size: var(--text-sm); font-weight: 600; color: var(--color-text-primary); padding: 0; }
  .song { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  .song label.check { margin-top: var(--space-2); flex: 1; min-width: 0; }
  .override { max-width: 7rem; margin-top: var(--space-2); text-align: right; }

  @media (max-width: 900px) {
    .cols { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 640px) {
    .box { padding: var(--space-4); }
    .wide { display: none; }
    /* One card per song: name and price, rounds and status, then the action */
    table, tbody, tr, td { display: block; }
    thead { display: none; }
    tr {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2) var(--space-3);
      align-items: center;
      padding: var(--space-3) 0;
      border-top: 1px solid var(--color-border);
    }
    td { padding: 0; border: 0; }
    td.song { grid-area: 1 / 1; min-width: 0; width: auto; overflow-wrap: anywhere; }
    td.num { grid-area: 1 / 2; }
    td.rounds { grid-area: 2 / 1; }
    td.status { grid-area: 2 / 2; justify-self: end; }
    td.act { grid-column: 1 / -1; text-align: left; }
    td.act.idle { display: none; }
  }
</style>
