<script lang="ts">
  import { PRIVACY_PAYMENTS } from '@music-hub/shared';
  import { locale, t } from '$lib/i18n/index.js';

  let { data } = $props();
</script>

<svelte:head>
  <title>{t().common.privacy} — Music Hub</title>
</svelte:head>

<h1>{t().landing.privacy.title}</h1>
<p class="meta">{t().landing.privacy.meta}</p>

<p>{t().landing.privacy.intro}</p>

<h2>{t().landing.privacy.controller}</h2>
<address>
  Robin Wahl<br />
  Pleasance<br />
  Bugginger Straße 37<br />
  79114 Freiburg<br />
  {t().common.email}: <a href="mailto:hello@pleasance.org">hello@pleasance.org</a>
</address>

{#each t().landing.privacy.sections as [title, paragraphs]}
  <h2>{title}</h2>
  {#each paragraphs as paragraph}
    <p>{paragraph}</p>
  {/each}
{/each}

{#if data.payments}
  <h2>{PRIVACY_PAYMENTS[locale()].title}</h2>
  {#each PRIVACY_PAYMENTS[locale()].paragraphs ?? [] as paragraph}
    <p>{paragraph}</p>
  {/each}
{/if}
