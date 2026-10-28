<script lang="ts">
  import { onMount } from 'svelte';
  import { dateLocale, t } from '$lib/i18n/index.js';
  import { user } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';
  import { toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import Avatar from '$lib/components/ui/Avatar.svelte';
  import TopBar from '$lib/components/workspace/TopBar.svelte';
  import PasskeySettings from '$lib/components/PasskeySettings.svelte';
  import ProfileSettings from '$lib/components/profile/ProfileSettings.svelte';
  import GuestUploadSettings from '$lib/components/workspace/GuestUploadSettings.svelte';
  import PaymentAccountSettings from '$lib/components/delivery/PaymentAccountSettings.svelte';
  import PlanSettings from '$lib/components/account/PlanSettings.svelte';
  import { pushStore, initPush, subscribePush, unsubscribePush } from '$lib/stores/push.svelte.js';
  import { titleHidden, setTitleHidden } from '$lib/media-session.js';

  let name = $state('');
  let saving = $state(false);
  let hideTitle = $state(false);

  onMount(() => {
    initPush();
    hideTitle = titleHidden();
  });

  $effect(() => {
    if ($user && !name) name = $user.name;
  });

  async function setVersionMails(versionMails: boolean) {
    try {
      const res = await api.patch<{ user: typeof $user }>('/auth/me', { versionMails });
      user.set(res.user);
    } catch {
      // The API client already showed the error
    }
  }

  async function setUpdates(updates: boolean) {
    try {
      const res = await api.patch<{ user: typeof $user }>('/auth/me', { updates });
      user.set(res.user);
      toastSuccess(updates ? t().overview.account.updatesOn : t().overview.account.updatesOff);
    } catch {
      // The API client already showed the error
    }
  }

  async function save() {
    if (!name.trim()) return;
    saving = true;
    try {
      const res = await api.patch<{ user: typeof $user }>('/auth/me', { name: name.trim() });
      user.set(res.user);
      toastSuccess(t().overview.account.saved);
    } catch {
      // The API client already showed the error
    } finally {
      saving = false;
    }
  }
</script>

<TopBar crumbs={[{ label: t().overview.account.title }]} />

<div class="page">
  <header>
    <h1>{t().overview.account.title}</h1>
    <p class="sub">{t().overview.account.sub}</p>
  </header>

  <section class="card">
    <h2>{t().overview.account.notifications}</h2>
    {#if pushStore.state !== 'unsupported'}
      {#if pushStore.state === 'denied'}
        <p class="push-hint">{t().overview.account.pushDenied}</p>
      {:else if pushStore.state === 'subscribed'}
        <div class="push-row">
          <span class="push-active">{t().overview.account.pushActive}</span>
          <Button size="sm" variant="ghost" onclick={unsubscribePush} loading={pushStore.loading}>{t().overview.account.pushOff}</Button>
        </div>
      {:else}
        <div class="push-row">
          <span class="push-desc">{t().overview.account.pushText}</span>
          <Button size="sm" onclick={subscribePush} loading={pushStore.loading}>{t().overview.account.pushOn}</Button>
        </div>
      {/if}
    {/if}
    {#if $user}
      <label class="mail-row">
        <input
          type="checkbox"
          checked={$user.versionMails ?? true}
          onchange={(e) => setVersionMails(e.currentTarget.checked)}
        />
        <span>{t().overview.account.versionMails}</span>
      </label>
      <label class="mail-row">
        <input type="checkbox" checked={!!$user.updatesSince} onchange={(e) => setUpdates(e.currentTarget.checked)} />
        <span>
          {t().overview.account.updates}
          {#if $user.updatesSince}{t().overview.account.updatesSince(new Date($user.updatesSince).toLocaleDateString(dateLocale()))}{/if}
        </span>
      </label>
    {/if}
  </section>

  <section class="card">
    <h2>{t().overview.account.playback}</h2>
    <label class="mail-row">
      <input type="checkbox" checked={hideTitle} onchange={(e) => setTitleHidden((hideTitle = e.currentTarget.checked))} />
      <span>{t().overview.account.hideTitle}</span>
    </label>
  </section>

  {#if $user}
    <section class="card">
      <h2>{t().overview.account.profile}</h2>
      <div class="profile-row">
        <Avatar name={$user.name} src={$user.avatarUrl ?? null} size="lg" />
        <div class="form">
          <Input label={t().overview.account.displayName} bind:value={name} />
          <p class="email-line">{t().overview.account.email} <span>{$user.email}</span></p>
          <Button onclick={save} loading={saving} disabled={!name.trim() || name === $user.name}>
            {t().common.save}
          </Button>
        </div>
      </div>
    </section>
    <PlanSettings />
    <PasskeySettings />
    <ProfileSettings />
    <GuestUploadSettings />
    <PaymentAccountSettings />
  {/if}

  <p class="legal"><a href="/impressum">{t().common.imprint}</a> · <a href="/datenschutz">{t().common.privacy}</a></p>
</div>

<style>
  .page {
    padding: var(--space-6);
    max-width: 720px;
  }
  .legal {
    margin: var(--space-6) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
  .legal a {
    color: var(--color-text-tertiary);
  }
  .legal a:hover {
    color: var(--color-text-primary);
  }
  @media (max-width: 640px) {
    .page {
      padding: var(--space-4);
    }
    .profile-row {
      flex-direction: column;
      align-items: stretch;
    }
  }
  header {
    margin-bottom: var(--space-8);
  }
  h1 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-2xl);
  }
  .sub {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }
  .card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }
  h2 {
    margin: 0 0 var(--space-5);
    font-size: var(--text-lg);
  }
  .profile-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-5);
  }
  .form {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;
  }
  .form :global(.input-group) {
    width: 100%;
  }
  .email-line {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }
  .email-line span {
    color: var(--color-text-primary);
    font-family: var(--font-mono);
  }
  .push-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .push-active {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    flex: 1;
  }
  .push-desc {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    flex: 1;
  }
  .push-hint {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }
  .mail-row {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    margin-top: var(--space-4);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .mail-row input {
    accent-color: var(--color-accent);
    margin-top: 3px;
  }
  .card + .card {
    margin-top: var(--space-5);
  }
</style>
