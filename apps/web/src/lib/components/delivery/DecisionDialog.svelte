<script lang="ts">
  import { formatEuro, type GuestDeliveryResponse, type PublicDelivery, type PublicDeliveryTrack } from '@music-hub/shared';
  import Button from '$lib/components/ui/Button.svelte';
  import { locale, t } from '$lib/i18n/index.js';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { GuestError, guestRequest } from '$lib/utils/delivery.js';

  // The client's decision on the version they heard: approve it, or ask for one more round
  let {
    open = $bindable(false),
    mode,
    token,
    password,
    trackName,
    versionId,
    versionNumber,
    track,
    extraRoundCents,
    announced,
    name: givenName,
    ondone,
  }: {
    open: boolean;
    mode: 'approve' | 'round';
    token: string;
    password: string;
    trackName: string;
    versionId: string;
    versionNumber: number;
    track: PublicDeliveryTrack;
    extraRoundCents: number;
    // The amount of a transfer the client said they sent, null without one
    announced: number | null;
    name: string;
    ondone: (delivery: PublicDelivery) => void;
  } = $props();

  let name = $state('');
  let note = $state('');
  let sending = $state(false);
  let error = $state('');
  // The API knows best: a round that turned extra in the meantime comes back with its price
  let extraPrice = $state<number | null>(null);

  $effect(() => {
    if (!open) return;
    name = givenName || localStorage.getItem('listenName') || '';
    note = '';
    error = '';
    extraPrice = null;
  });

  const tx = $derived(t().delivery.decision);
  const euro = (cents: number) => formatEuro(cents, locale());
  const extra = $derived(mode === 'round' && (track.nextRoundExtra || extraPrice !== null));
  const price = $derived(extraPrice ?? extraRoundCents);
  const title = $derived(mode === 'approve' ? tx.approveTitle(trackName) : extra ? tx.extraTitle(trackName) : tx.requestTitle(trackName));

  async function submit(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    sending = true;
    error = '';
    try {
      const body = { trackId: track.trackId, versionId, guestName: name.trim(), ...(note.trim() ? { note: note.trim() } : {}) };
      const res = await guestRequest<GuestDeliveryResponse>(
        token,
        mode === 'approve' ? '/approve' : '/rounds',
        password,
        // An extra round carries the price on the button, the API refuses any other
        mode === 'approve' ? body : { ...body, ...(extra ? { confirmExtra: true, extraRoundCents: price } : {}) },
      );
      localStorage.setItem('listenName', name.trim());
      open = false;
      ondone(res.delivery);
    } catch (err) {
      if (err instanceof GuestError && err.code === 'extra_round') {
        extraPrice = err.extraRoundCents ?? extraRoundCents;
        error = err.message;
      } else {
        error = err instanceof Error ? err.message : tx.failed;
      }
    } finally {
      sending = false;
    }
  }
</script>

<Modal bind:open {title}>
  <form class="decision" onsubmit={submit}>
    {#if mode === 'approve'}
      <p>{tx.approveInfo(versionNumber)}</p>
    {:else if extra}
      <p>
        {tx.includedUsed(track.roundsIncluded)}
        {tx.costsBefore}<b>{euro(price)}</b>{tx.costsAfter}
      </p>
    {:else}
      <p>
        {tx.roundInfo(track.roundsUsed + 1, track.roundsIncluded, versionNumber)}
      </p>
    {/if}
    {#if mode === 'round' && announced !== null}
      <p class="note">
        {tx.announcedNote(euro(announced), !!extra)}
      </p>
    {/if}
    <label>
      <span>{tx.yourName}</span>
      <input type="text" bind:value={name} maxlength={100} autocomplete="name" required />
    </label>
    <label>
      <span>{mode === 'approve' ? tx.messageToStudio : tx.whatToChange}</span>
      <textarea bind:value={note} rows="3" maxlength={2000}></textarea>
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (open = false)}>{t().common.cancel}</Button>
    {#if mode === 'approve'}
      <Button loading={sending} disabled={!name.trim()} onclick={submit}>{tx.approve}</Button>
    {:else if extra}
      <Button loading={sending} disabled={!name.trim()} onclick={submit}>{tx.orderWithPayment(euro(price))}</Button>
    {:else}
      <Button loading={sending} disabled={!name.trim()} onclick={submit}>{tx.requestChanges}</Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .decision {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  p {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
  b { color: var(--color-text-primary); }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  input,
  textarea {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    width: 100%;
  }
  .error { color: var(--color-error); }
  .note {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-warning) 12%, var(--color-bg-raised));
    color: var(--color-text-primary);
  }
</style>
