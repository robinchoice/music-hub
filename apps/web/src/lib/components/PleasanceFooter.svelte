<script lang="ts">
  import { APP_BAND } from '@music-hub/shared';
  import { locale, setLocale, t } from '$lib/i18n/index.js';

  const other = $derived(locale() === 'de' ? 'en' : 'de');
</script>

<!-- Sender of every Pleasance tool with the language switch, taken from the starter -->
<footer>
  <a href="https://pleasance.org">{t().common.madeBy} <span class="wordmark" role="img" aria-label="Pleasance"></span></a>
  <span class="band" aria-hidden="true"><span
      class="marker"
      style:left="{((APP_BAND.from - 1) / 6) * 100}%"
      style:width="{((APP_BAND.to - APP_BAND.from) / 6) * 100}%"
    ></span></span>
  <button type="button" lang={other} onclick={() => setLocale(other)}>{t().common.otherLanguage}</button>
</footer>

<style>
  footer {
    display: flex;
    gap: 1rem;
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
  .band {
    position: relative;
    width: 8.5rem;
    height: 3px;
    margin-left: auto;
    border-radius: 2px;
    background: linear-gradient(rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.55)), var(--spectrum);
  }
  .marker {
    position: absolute;
    top: -3px;
    min-width: 9px;
    height: 9px;
    border-radius: 5px;
    background: var(--gradient-accent);
    box-shadow: 0 0 0 2px var(--color-bg-base);
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
