<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';

  let {
    projectId,
    versionId,
    versionNumber,
    onInvited,
    onDismiss,
  }: {
    projectId: string;
    versionId: string;
    versionNumber: number;
    onInvited: () => void;
    onDismiss: () => void;
  } = $props();

  let email = $state('');
  let inviting = $state(false);
  let linking = $state(false);
  let guestUrl = $state('');

  async function invite(e: SubmitEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    inviting = true;
    try {
      await api.post(`/projects/${projectId}/members`, { email: address, role: 'artist' });
      toastSuccess(`${address} ist eingeladen`);
      onInvited();
    } catch {
      // The API client already showed the error
    } finally {
      inviting = false;
    }
  }

  // A guest link lets people listen and comment without an account
  async function copyLink() {
    linking = true;
    try {
      if (!guestUrl) {
        const res = await api.post<{ link: { token: string } }>(`/share/version/${versionId}`, {
          allowComments: true,
          allowDownload: false,
        });
        guestUrl = `${window.location.origin}/listen/${res.link.token}`;
      }
      // Some browsers refuse the clipboard after the await, the link then stays visible to copy by hand
      await navigator.clipboard.writeText(guestUrl).then(() => toastSuccess('Link kopiert'), () => {});
    } catch {
      // The API client already showed the error
    } finally {
      linking = false;
    }
  }
</script>

<section class="invite" aria-labelledby="invite-title">
  <h2 id="invite-title">V{versionNumber} ist da. Wer soll reinhören?</h2>
  <p>Feedback kommt erst, wenn jemand zuhört. Leute mit Konto kommentieren im Projekt, alle anderen über einen Link, ohne Konto.</p>
  <form class="fields" onsubmit={invite}>
    <input type="email" bind:value={email} placeholder="lea@beispiel.de" aria-label="E-Mail-Adresse" />
    <Button type="submit" loading={inviting} disabled={!email.trim()}>Einladen</Button>
    <Button variant="secondary" loading={linking} onclick={copyLink}>Link kopieren</Button>
  </form>
  {#if guestUrl}
    <input class="link" type="text" readonly value={guestUrl} aria-label="Gast-Link" onclick={(e) => (e.target as HTMLInputElement).select()} />
  {/if}
  <small>Später jederzeit über „Teilen“ oben rechts. <button class="later" onclick={onDismiss}>Nicht jetzt</button></small>
</section>

<style>
  .invite {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-5);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
    border-radius: var(--radius-lg);
    background: var(--color-accent-subtle);
    animation: slide-in 500ms 300ms var(--ease-out) both;
  }
  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.5rem;
    line-height: 1.1;
  }

  p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  input {
    flex: 1;
    min-width: 180px;
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--color-border-hover);
    border-radius: var(--radius-md);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
  }

  small {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  .later {
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }

  @media (prefers-reduced-motion: reduce) {
    .invite {
      animation: none;
    }
  }
</style>
