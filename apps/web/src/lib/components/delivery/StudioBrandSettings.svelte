<script lang="ts">
  import { onMount } from 'svelte';
  import type { StudioBrand, StudioBrandInput, StudioBrandResponse } from '@music-hub/shared';
  import { api } from '$lib/api/client.js';
  import { t } from '$lib/i18n/index.js';
  import { user } from '$lib/stores/auth.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import CoverUpload from '$lib/components/ui/CoverUpload.svelte';
  import Input from '$lib/components/ui/Input.svelte';

  // Name, line and logo the guest page of the caller's deliveries shows while the plan is Studio
  let brand = $state<StudioBrand | null>(null);
  let name = $state('');
  let line = $state('');
  let saving = $state(false);
  const tx = $derived(t().delivery.brand);
  const changed = $derived(!!brand && (name.trim() !== (brand.name ?? '') || line.trim() !== (brand.line ?? '')));

  function show(next: StudioBrand) {
    brand = next;
    name = next.name ?? '';
    line = next.line ?? '';
  }

  onMount(async () => {
    const res = await api.get<StudioBrandResponse>('/studio-brand', true).catch(() => null);
    if (res) show(res.brand);
  });

  async function put(body: StudioBrandInput) {
    return (await api.put<StudioBrandResponse>('/studio-brand', body)).brand;
  }

  async function save(e: Event) {
    e.preventDefault();
    saving = true;
    try {
      show(await put({ name: name.trim() || null, line: line.trim() || null }));
      toastSuccess(tx.saved);
    } catch {
      // The API client already showed the error
    } finally {
      saving = false;
    }
  }

  // Errors come back to CoverUpload, which shows them
  async function setLogo(logoKey: string | null) {
    const next = await put({ logoKey });
    if (brand) brand = { ...next, name: brand.name, line: brand.line };
    toastSuccess(logoKey ? tx.logoSaved : tx.logoRemoved);
  }
</script>

{#if brand}
  <section class="card" id="studio">
    <h2>{tx.title}</h2>
    <p class="sub">{tx.intro}</p>
    {#if !brand.allowed}<p class="sub plan">{tx.planHint}</p>{/if}

    <div class="row">
      <div class="logo">
        <span class="label">{tx.logo}</span>
        <CoverUpload
          currentUrl={brand.logoUrl}
          name={brand.name || $user?.name || ''}
          labels={{ add: tx.addLogo, remove: tx.removeLogo }}
          onChange={setLogo}
        />
      </div>
      <form class="form" onsubmit={save}>
        <Input label={tx.name} bind:value={name} placeholder={tx.namePlaceholder} maxlength={80} autocomplete="organization" />
        <Input label={tx.line} bind:value={line} placeholder={tx.linePlaceholder} maxlength={120} />
        <p class="sub">{tx.logoHint}</p>
        <Button type="submit" size="sm" loading={saving} disabled={!changed}>{t().common.save}</Button>
      </form>
    </div>
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
  .sub {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  .plan { margin-top: var(--space-2); }
  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-5);
    margin-top: var(--space-5);
  }
  .logo {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .form {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: flex-start;
  }
  .form :global(.input-group) { width: 100%; }
  @media (max-width: 640px) {
    .card { padding: var(--space-4); }
    .row { flex-direction: column; align-items: stretch; }
    .logo { align-items: flex-start; }
  }
</style>
