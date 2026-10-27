<script lang="ts">
  import { t } from '$lib/i18n/index.js';
</script>

<svelte:head>
  <title>{t().common.imprint} — Music Hub</title>
</svelte:head>

<h1>{t().common.imprint}</h1>
<p class="meta">{t().landing.imprint.meta}</p>

<h2>{t().landing.imprint.provider}</h2>
<address>
  Robin Wahl<br />
  Pleasance<br />
  Bugginger Straße 37<br />
  79114 Freiburg
</address>

<h2>{t().landing.imprint.contact}</h2>
<p>{t().common.email}: <a href="mailto:hello@pleasance.org">hello@pleasance.org</a></p>

<h2>{t().landing.imprint.responsible}</h2>
<address>
  Robin Wahl<br />
  Bugginger Straße 37<br />
  79114 Freiburg
</address>

<h2>{t().landing.imprint.userContent}</h2>
<p>
  {t().landing.imprint.userContentBefore}
  <a href="mailto:hello@pleasance.org">hello@pleasance.org</a>{t().landing.imprint.userContentAfter}
</p>

<h2>{t().landing.imprint.contentLiability}</h2>
<p>{t().landing.imprint.contentLiabilityText}</p>

<h2>{t().landing.imprint.linkLiability}</h2>
<p>{t().landing.imprint.linkLiabilityText}</p>
