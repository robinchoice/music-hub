<script lang="ts">
  import { onMount } from 'svelte';
  import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
  import { loginTexts, type Passkey } from '@music-hub/shared';
  import { addPasskey, listPasskeys, removePasskey } from '$lib/stores/auth.js';
  import Button from '$lib/components/ui/Button.svelte';

  let passkeys = $state<Passkey[]>([]);
  let supported = $state(false);
  let loaded = $state(false);
  let busy = $state(false);
  let error = $state('');
  let language = $state('de');
  const texts = $derived(loginTexts(language));

  onMount(async () => {
    language = navigator.language;
    supported = browserSupportsWebAuthn();
    try {
      passkeys = await listPasskeys();
      loaded = true;
    } catch (err) {
      error = err instanceof Error ? err.message : texts.failed;
    }
  });

  async function add() {
    busy = true;
    error = '';
    try {
      passkeys = [...passkeys, await addPasskey()];
    } catch (err) {
      if (!(err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError')))
        error = err instanceof Error && 'status' in err ? err.message : texts.failed;
    } finally {
      busy = false;
    }
  }

  async function remove(id: string) {
    busy = true;
    error = '';
    try {
      await removePasskey(id);
      passkeys = passkeys.filter((passkey) => passkey.id !== id);
    } catch (err) {
      error = err instanceof Error ? err.message : texts.failed;
    } finally {
      busy = false;
    }
  }
</script>

<section class="card">
  <h2>{texts.passkeys}</h2>
  <p>{texts.passkeyIntro}</p>
  {#if loaded && !passkeys.length}<p>{texts.empty}</p>{/if}
  {#each passkeys as passkey (passkey.id)}
    <div class="row">
      <div>
        <strong>{passkey.backedUp ? texts.synced : texts.device}</strong>
        <p>{texts.created}: {new Date(passkey.createdAt).toLocaleDateString(language)}
          {#if passkey.lastUsedAt} · {texts.lastUsed}: {new Date(passkey.lastUsedAt).toLocaleDateString(language)}{/if}
        </p>
      </div>
      <Button variant="ghost" size="sm" disabled={busy} onclick={() => remove(passkey.id)}>{texts.remove}</Button>
    </div>
  {/each}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if supported}<Button loading={busy} disabled={!loaded} onclick={add}>{texts.add}</Button>{/if}
</section>

<style>
  .card { background: var(--color-bg-raised); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-6); margin-top: var(--space-6); }
  h2 { margin: 0 0 var(--space-4); font-size: var(--text-lg); }
  p { color: var(--color-text-secondary); font-size: var(--text-sm); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; margin-bottom: var(--space-4); }
  .error { color: var(--color-error); }
</style>
