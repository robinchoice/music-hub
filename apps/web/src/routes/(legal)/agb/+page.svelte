<script lang="ts">
  import { TERMS, WITHDRAWAL, type LegalSection } from '@music-hub/shared';
  import { locale, t } from '$lib/i18n/index.js';

  // Text from shared/terms.ts, the same as in /agb.md and the confirmation mail
  const terms = $derived(TERMS[locale()]);
  const notice = $derived(WITHDRAWAL[locale()]);
</script>

<svelte:head>
  <title>{t().common.terms} — Music Hub</title>
</svelte:head>

{#snippet section(s: LegalSection, Heading: 'h2' | 'h3')}
  <svelte:element this={Heading}>{s.title}</svelte:element>
  {#each s.paragraphs ?? [] as paragraph}<p>{paragraph}</p>{/each}
  {#if s.items?.length}
    <svelte:element this={s.unordered ? 'ul' : 'ol'}>
      {#each s.items as item}<li>{item}</li>{/each}
    </svelte:element>
  {/if}
{/snippet}

<h1>{terms.title}</h1>
<p class="meta">{terms.meta}</p>
{#each terms.sections as s}{@render section(s, 'h2')}{/each}

<h2>{notice.title}</h2>
{#each notice.sections as s}{@render section(s, 'h3')}{/each}
