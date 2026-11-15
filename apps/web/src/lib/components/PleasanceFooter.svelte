<script lang="ts">
  import AppDock from '$lib/components/AppDock.svelte';
  import { locale, setLocale, t } from '$lib/i18n/index.js';

  const other = $derived(locale() === 'de' ? 'en' : 'de');
</script>

<!-- Sender of every Pleasance tool with the language switch, taken from the starter -->
<footer>
  <a href="https://pleasance.org">{t().common.madeBy} <span class="wordmark" role="img" aria-label="Pleasance"></span></a>
  <!-- The colour band is the dock of the Pleasance apps -->
  <AppDock />
  <button type="button" lang={other} onclick={() => setLocale(other)}>{t().common.otherLanguage}</button>
</footer>

<style>
  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1rem;
    align-items: center;
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }
  a {
    display: inline-flex;
    flex-shrink: 0;
    gap: 0.5rem;
    align-items: center;
    color: inherit;
    text-decoration: none;
  }
  a:hover {
    color: var(--color-text-primary);
  }
  .wordmark {
    width: 76px;
    height: 14px;
    background: currentColor;
    mask: url('/pleasance-wordmark.svg') left center / contain no-repeat;
  }
  footer > :global(.dock) {
    min-width: 3rem;
    margin-left: auto;
  }
  button {
    flex-shrink: 0;
    padding: 0.25rem 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
  button:hover {
    color: var(--color-text-primary);
  }
</style>
