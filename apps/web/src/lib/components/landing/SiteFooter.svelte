<script lang="ts">
  const REPO = 'https://github.com/robinchoice/music-hub';
</script>

<footer class="footer">
  <div class="footer-grid">
    <div class="footer-brand">
      <a href="/" class="wordmark">Music Hub</a>
      <p class="footer-tag">Versionen für Musik. Ohne Chaos.</p>
    </div>
    <div>
      <h4>Produkt</h4>
      <a href="/login">Einloggen</a>
    </div>
    <div>
      <h4>Open Source</h4>
      <a href={REPO} target="_blank" rel="noopener">Repository</a>
      <a href="{REPO}#self-hosting" target="_blank" rel="noopener">Selbst hosten</a>
    </div>
    <div>
      <h4>Rechtliches</h4>
      <a href="/impressum">Impressum</a>
      <a href="/datenschutz">Datenschutz</a>
    </div>
  </div>
  <p class="copy">© 2026 Music Hub</p>
</footer>

<style>
  .footer {
    border-top: 1px solid var(--color-border);
    padding: 56px 0 40px;
  }
  .footer-grid {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: var(--space-8);
    margin-bottom: var(--space-8);
  }
  .wordmark {
    display: inline-block;
    font-size: 19px;
    font-weight: 750;
    letter-spacing: -0.025em;
    background: var(--gradient-accent);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .footer-tag {
    margin: 8px 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
  }
  h4 {
    margin: 0 0 12px;
    font-size: var(--text-sm);
  }
  .footer-grid div > a:not(.wordmark) {
    display: block;
    margin-bottom: 8px;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
  .footer-grid div > a:not(.wordmark):hover {
    color: var(--color-text-primary);
  }
  .copy {
    margin: 0;
    padding-top: 24px;
    border-top: 1px solid var(--color-border);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  @media (max-width: 759px) {
    .footer-grid {
      grid-template-columns: 1fr 1fr;
    }
    .footer-brand {
      grid-column: 1 / -1;
    }
  }
</style>
