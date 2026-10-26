<script lang="ts">
  import { formatEuro, type GuestDeliveryResponse, type PublicDelivery, type PublicDeliveryTrack } from '@music-hub/shared';
  import Button from '$lib/components/ui/Button.svelte';
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

  const extra = $derived(mode === 'round' && (track.nextRoundExtra || extraPrice !== null));
  const price = $derived(extraPrice ?? extraRoundCents);
  const title = $derived(mode === 'approve' ? `„${trackName}“ freigeben?` : extra ? `Zusatzrunde für „${trackName}“?` : `Änderungen für „${trackName}“ anfordern`);

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
        error = err instanceof Error ? err.message : 'Das hat nicht geklappt. Bitte versuche es erneut.';
      }
    } finally {
      sending = false;
    }
  }
</script>

<Modal bind:open {title}>
  <form class="decision" onsubmit={submit}>
    {#if mode === 'approve'}
      <p>Du gibst Version {versionNumber} frei. Nach der Zahlung lädst du sie als WAV herunter.</p>
    {:else if extra}
      <p>
        {track.roundsIncluded === 0 ? 'Korrekturrunden sind nicht inklusive.' : track.roundsIncluded === 1 ? 'Die inklusive Runde ist genutzt.' : `Die ${track.roundsIncluded} inklusiven Runden sind genutzt.`}
        Eine weitere Runde kostet <b>{formatEuro(price)}</b>. Sie kommt auf die Schlussrechnung.
      </p>
    {:else}
      <p>
        Das ist Runde {track.roundsUsed + 1} von {track.roundsIncluded}. Deine Kommentare zu Version {versionNumber} gehen gesammelt
        ans Studio, das sich mit einer neuen Version meldet.
      </p>
    {/if}
    {#if mode === 'round' && announced !== null}
      <p class="note">
        Du hast schon {formatEuro(announced)} per Überweisung angekündigt. Die Überweisung bleibt gültig, das Studio rechnet sie an.
        Den Download gibt es, sobald wieder alle Songs freigegeben sind{extra ? ' und die Zusatzrunde bezahlt ist' : ''}.
      </p>
    {/if}
    <label>
      <span>Dein Name</span>
      <input type="text" bind:value={name} maxlength={100} autocomplete="name" required />
    </label>
    <label>
      <span>{mode === 'approve' ? 'Nachricht ans Studio (optional)' : 'Was soll sich ändern? (optional)'}</span>
      <textarea bind:value={note} rows="3" maxlength={2000}></textarea>
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={() => (open = false)}>Abbrechen</Button>
    {#if mode === 'approve'}
      <Button loading={sending} disabled={!name.trim()} onclick={submit}>Freigeben</Button>
    {:else if extra}
      <Button loading={sending} disabled={!name.trim()} onclick={submit}>Zahlungspflichtig beauftragen · {formatEuro(price)}</Button>
    {:else}
      <Button loading={sending} disabled={!name.trim()} onclick={submit}>Änderungen anfordern</Button>
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
