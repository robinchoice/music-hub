<script lang="ts">
  import { user } from '$lib/stores/auth.js';
  import Button from '$lib/components/ui/Button.svelte';

  // TODO: Demo-Token ist statisch. Phase 2: dynamisch via /api/v1/share/demo laden
  // oder beim Seed in eine Settings-Tabelle schreiben.
  const DEMO_SHARE_TOKEN = '0b75a672afaa14aa5d97c5af0343f93edd3aa78e5b3ce30d1d695977ac4a3fc1';
</script>

<svelte:head>
  <title>Music Hub — Versionen für Musik. Ohne Chaos.</title>
  <meta
    name="description"
    content="Music Hub macht Schluss mit dem Versions-Chaos in der Musikproduktion. Jede Version sauber an einem Ort, Feedback per Klick auf die Wellenform, teilen ohne Account."
  />
</svelte:head>

<div class="page">
  <!-- NAV -->
  <nav class="nav">
    <a href="/" class="logo">Music Hub</a>
    <div class="nav-right">
      {#if $user}
        <Button href="/dashboard" size="sm">Zum Dashboard</Button>
      {:else}
        <a href="/login" class="nav-link">Einloggen</a>
        <Button href="/register" size="sm">Kostenlos starten</Button>
      {/if}
    </div>
  </nav>

  <!-- 1. HERO -->
  <section class="hero">
    <div class="hero-text">
      <p class="eyebrow">Für Producer, Artists, Studios</p>
      <h1>
        Versionen für Musik.<br />
        <span class="grad">Ohne Chaos.</span>
      </h1>
      <p class="lede">
        Schluss mit "Final_v3_REAL.wav". Jede Version deines Tracks an einem Ort,
        Feedback direkt auf der Wellenform, und dein Artist hört rein —
        ohne Account, ohne Anmeldung, ohne Stress.
      </p>
      <div class="hero-cta">
        <Button href="/register" size="lg">Kostenlos starten</Button>
        <a href="/listen/{DEMO_SHARE_TOKEN}" target="_blank" rel="noopener" class="cta-secondary">
          Live-Demo ansehen <span class="arrow">→</span>
        </a>
      </div>
    </div>

    <!-- HERO MOCKUP -->
    <div class="hero-mockup" aria-hidden="true">
      <svg viewBox="0 0 480 360" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f43f5e" />
            <stop offset="100%" stop-color="#fb923c" />
          </linearGradient>
          <linearGradient id="wave-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f43f5e" stop-opacity="0.8" />
            <stop offset="100%" stop-color="#fb923c" stop-opacity="0.4" />
          </linearGradient>
        </defs>

        <!-- Card background -->
        <rect x="20" y="20" width="440" height="320" rx="16" fill="#1a1822" stroke="#24222e" />

        <!-- Header -->
        <text x="40" y="55" fill="#9b96a8" font-family="Inter Variable, system-ui" font-size="11" font-weight="500">HAUPTMIX · V2</text>
        <circle cx="430" cy="50" r="5" fill="#22c55e" />
        <text x="412" y="54" fill="#22c55e" font-family="Inter Variable, system-ui" font-size="10" text-anchor="end">ready</text>

        <!-- Waveform -->
        <g transform="translate(40, 80)">
          {#each Array(60) as _, i}
            {@const h = 8 + Math.abs(Math.sin(i * 0.4)) * 38 + Math.abs(Math.cos(i * 0.7)) * 12}
            <rect
              x={i * 6.6}
              y={(60 - h) / 2}
              width="3"
              height={h}
              rx="1.5"
              fill={i < 28 ? 'url(#wave-fade)' : '#32303c'}
            />
          {/each}
          <!-- Comment marker -->
          <circle cx="155" cy="-4" r="6" fill="url(#grad)" />
          <line x1="155" y1="2" x2="155" y2="62" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.6" />
        </g>

        <!-- Comment bubble -->
        <g transform="translate(40, 165)">
          <rect width="400" height="48" rx="10" fill="#221f2c" stroke="#24222e" />
          <circle cx="22" cy="24" r="11" fill="url(#grad)" />
          <text x="22" y="28" text-anchor="middle" fill="#fff" font-size="10" font-family="Inter Variable, system-ui" font-weight="600">A</text>
          <text x="42" y="20" fill="#f4f0ec" font-family="Inter Variable, system-ui" font-size="11" font-weight="500">Anna</text>
          <text x="78" y="20" fill="#fb923c" font-family="Inter Variable, system-ui" font-size="9">1:17</text>
          <text x="42" y="36" fill="#9b96a8" font-family="Inter Variable, system-ui" font-size="10">Vocals etwas weiter nach vorn ziehen?</text>
        </g>

        <!-- Mini graph -->
        <g transform="translate(40, 235)">
          <text x="0" y="-4" fill="#9b96a8" font-family="Inter Variable, system-ui" font-size="10" font-weight="500">VERSIONEN</text>
          <!-- mainline -->
          <line x1="20" y1="20" x2="20" y2="80" stroke="#32303c" stroke-width="2" />
          <!-- branch -->
          <path d="M 20 50 C 20 60, 80 60, 80 70" stroke="#fb923c" stroke-width="2" fill="none" />
          <circle cx="20" cy="20" r="9" fill="#1a1822" stroke="#32303c" stroke-width="2" />
          <text x="20" y="24" text-anchor="middle" fill="#9b96a8" font-size="9" font-family="Inter Variable, system-ui">1</text>
          <circle cx="20" cy="50" r="9" fill="url(#grad)" />
          <text x="20" y="54" text-anchor="middle" fill="#fff" font-size="9" font-family="Inter Variable, system-ui" font-weight="600">2</text>
          <circle cx="20" cy="80" r="9" fill="#1a1822" stroke="#32303c" stroke-width="2" />
          <text x="20" y="84" text-anchor="middle" fill="#9b96a8" font-size="9" font-family="Inter Variable, system-ui">4</text>
          <circle cx="80" cy="70" r="9" fill="#1a1822" stroke="#fb923c" stroke-width="2" />
          <text x="80" y="74" text-anchor="middle" fill="#fb923c" font-size="9" font-family="Inter Variable, system-ui">3</text>
          <text x="38" y="24" fill="#5e596b" font-family="Inter Variable, system-ui" font-size="10">main · Erster Wurf</text>
          <text x="38" y="54" fill="#9b96a8" font-family="Inter Variable, system-ui" font-size="10">main · Mehr Bass</text>
          <text x="98" y="74" fill="#fb923c" font-family="Inter Variable, system-ui" font-size="10">vocals-neu</text>
          <text x="38" y="84" fill="#5e596b" font-family="Inter Variable, system-ui" font-size="10">main · Final</text>
        </g>
      </svg>
    </div>
  </section>

  <!-- 2. PROBLEM -->
  <section class="problem">
    <h2>Wenn dir <code>Final_v3_REAL.wav</code> bekannt vorkommt, wissen wir, wovon wir reden.</h2>
    <p class="lede center">
      Gemeinsam an einem Track zu arbeiten ist 2026 immer noch eine Mischung aus Dropbox-Links,
      WhatsApp-Sprachnachrichten und der leisen Hoffnung, dass alle die richtige Datei haben.
    </p>
    <div class="problem-grid">
      <div class="problem-card">
        <span class="icon">🎙️</span>
        <h3>Sprachnachrichten statt Comments</h3>
        <p>Wertvolles Feedback verschwindet im WhatsApp-Verlauf. Keine Historie, kein Kontext, kein Status.</p>
      </div>
      <div class="problem-card">
        <span class="icon">📎</span>
        <h3>Dropbox-Links pro Version</h3>
        <p>Niemand weiß welche Version aktuell ist. Niemand weiß welche freigegeben wurde. Niemand traut sich zu fragen.</p>
      </div>
      <div class="problem-card">
        <span class="icon">✅</span>
        <h3>Approval per Bauchgefühl</h3>
        <p>Was war jetzt der finale Mix? Wer hat freigegeben? Wann? Niemand weiß es mehr — und der Master ist morgen fällig.</p>
      </div>
    </div>
  </section>

  <!-- 3. LÖSUNG -->
  <section class="solution">
    <p class="eyebrow center">So funktioniert's</p>
    <h2 class="center">Drei Dinge. <span class="grad">Eine ruhige Produktion.</span></h2>

    <div class="solution-row">
      <div class="solution-text">
        <h3>① Jede Version bleibt erhalten</h3>
        <p>
          Lade eine neue Version hoch — die alte verschwindet nicht.
          Probier eine Variante mit anderen Vocals, mehr Bass, neuem Mix:
          alles bleibt nebeneinander, du springst in einem Klick zwischen ihnen,
          und du verlierst niemals einen Stand, der dir gefallen hat.
        </p>
      </div>
      <div class="solution-visual">
        <svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <line x1="40" y1="20" x2="40" y2="120" stroke="#32303c" stroke-width="2" />
          <path d="M 40 60 C 40 75, 120 75, 120 90" stroke="#fb923c" stroke-width="2" fill="none" />
          <path d="M 120 90 C 120 100, 40 100, 40 110" stroke="#fb923c" stroke-width="2" fill="none" stroke-dasharray="3 3" />
          <circle cx="40" cy="20" r="10" fill="#1a1822" stroke="#32303c" stroke-width="2" />
          <circle cx="40" cy="60" r="10" fill="url(#grad)" />
          <circle cx="120" cy="90" r="10" fill="#1a1822" stroke="#fb923c" stroke-width="2" />
          <circle cx="40" cy="110" r="10" fill="url(#grad)" />
        </svg>
      </div>
    </div>

    <div class="solution-row reverse">
      <div class="solution-text">
        <h3>② Feedback direkt auf der Wellenform</h3>
        <p>
          Kein "bei ungefähr 1:30 ist die Snare zu laut" mehr. Klick auf die Stelle in der Welle,
          schreib was dir auffällt, fertig. Der andere sieht deine Anmerkung an genau dieser Sekunde,
          klickt drauf, springt hin, hört es selbst.
        </p>
      </div>
      <div class="solution-visual">
        <svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          {#each Array(28) as _, i}
            {@const h = 6 + Math.abs(Math.sin(i * 0.5)) * 32 + Math.abs(Math.cos(i * 0.8)) * 8}
            <rect
              x={10 + i * 6.7}
              y={(80 - h) / 2 + 30}
              width="3"
              height={h}
              rx="1.5"
              fill={i < 14 ? 'url(#wave-fade)' : '#32303c'}
            />
          {/each}
          <circle cx="100" cy="20" r="8" fill="url(#grad)" />
          <line x1="100" y1="28" x2="100" y2="105" stroke="#f43f5e" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.6" />
          <text x="100" y="24" text-anchor="middle" fill="#fff" font-size="9" font-family="Inter Variable, system-ui" font-weight="600">!</text>
        </svg>
      </div>
    </div>

    <div class="solution-row">
      <div class="solution-text">
        <h3>③ Teilen ohne Anmeldung</h3>
        <p>
          Schick deinem Artist, deinem Label, deiner Mama einen Link.
          Sie öffnen ihn, hören rein, kommentieren — ganz ohne Account, ohne Passwort,
          ohne irgendwas zu installieren. Du siehst ihre Anmerkungen direkt in deinem Editor.
        </p>
      </div>
      <div class="solution-visual">
        <svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="20" y="40" width="160" height="60" rx="10" fill="#1a1822" stroke="#32303c" stroke-width="2" />
          <text x="35" y="64" fill="#9b96a8" font-family="Inter Variable, system-ui" font-size="10">music-hub.app/listen/</text>
          <text x="35" y="80" fill="url(#grad)" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600">a7b3...4f9c</text>
          <g transform="translate(150, 60)">
            <circle r="14" fill="url(#grad)" />
            <text y="5" text-anchor="middle" fill="#fff" font-size="14" font-weight="700">↗</text>
          </g>
        </svg>
      </div>
    </div>
  </section>

  <!-- 4. WER ES IST (Two-Sided) -->
  <section class="two-sided">
    <h2 class="center">Für beide Seiten gemacht.</h2>
    <div class="cards">
      <div class="persona-card">
        <p class="eyebrow">Für Producer & Tontechniker</p>
        <h3>Endlich Ordnung im Track-Ordner</h3>
        <ul>
          <li>Keine "Final_REAL_v3_master.wav" mehr — jede Version hat ihren Platz</li>
          <li>Zwei Versionen direkt nebeneinander vergleichen, im Browser</li>
          <li>Sehe schwarz auf weiß, was freigegeben wurde und von wem</li>
          <li>Deine Daten gehören dir — auch zum Selber-Hosten</li>
        </ul>
      </div>
      <div class="persona-card">
        <p class="eyebrow">Für Artists, Labels & Kunden</p>
        <h3>Feedback geben, ohne Hürden</h3>
        <ul>
          <li>Link öffnen reicht — kein Account, kein Passwort, nichts</li>
          <li>Klick auf die Welle, schreib was du denkst — fertig</li>
          <li>Du siehst immer die aktuelle Version, ohne nachzufragen</li>
          <li>Funktioniert im Bus, im Studio, auf der Couch</li>
        </ul>
      </div>
    </div>
  </section>

  <!-- 5. TRUST -->
  <section class="trust">
    <p class="trust-line">
      <strong>Open Source</strong> · <strong>Self-Hostable</strong> · <strong>Daten in der EU</strong>
    </p>
    <p class="stack">
      Gebaut mit SvelteKit · Hono · PostgreSQL · MinIO · FFmpeg
    </p>
  </section>

  <!-- 6. FINAL CTA -->
  <section class="final-cta">
    <h2>In aktiver Entwicklung.<br /><span class="grad">Sei dabei.</span></h2>
    <p class="lede center">
      Music Hub ist im Beta-Stadium. Probier den aktuellen Build aus, gib Feedback,
      präg die Roadmap mit. Gratis, ohne Verpflichtung.
    </p>
    <div class="hero-cta center">
      <Button href="/register" size="lg">Account anlegen</Button>
      <!-- TODO: GitHub-Link sobald Repo öffentlich -->
      <a href="https://git.mydrugismusic.com/robin/music-hub" target="_blank" rel="noopener" class="cta-secondary">
        Auf Git anschauen <span class="arrow">→</span>
      </a>
    </div>
  </section>

  <!-- 7. FOOTER -->
  <footer class="footer">
    <div class="footer-grid">
      <div class="footer-brand">
        <p class="logo">Music Hub</p>
        <p class="footer-tag">Versionen für Musik. Ohne Chaos.</p>
      </div>
      <div>
        <h4>Produkt</h4>
        <a href="/login">Einloggen</a>
        <a href="/listen/{DEMO_SHARE_TOKEN}" target="_blank" rel="noopener">Live-Demo</a>
      </div>
      <div>
        <h4>Open Source</h4>
        <a href="#">Repository</a>
        <a href="#">Self-Hosting</a>
      </div>
      <div>
        <h4>Rechtliches</h4>
        <a href="#">Datenschutz</a>
        <a href="#">Impressum</a>
      </div>
    </div>
    <p class="copy">© 2026 Music Hub</p>
  </footer>
</div>

<style>
  .page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 var(--space-6);
  }

  /* NAV */
  .nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-5) 0;
  }
  .logo {
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: -0.02em;
    background: var(--gradient-accent);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    text-decoration: none;
  }
  .nav-right {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .nav-link {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    text-decoration: none;
  }
  .nav-link:hover {
    color: var(--color-text-primary);
  }

  /* SECTIONS */
  section {
    padding: var(--space-16) 0;
  }

  .eyebrow {
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: var(--text-xs);
    font-weight: 500;
    margin: 0 0 var(--space-4);
  }
  .center {
    text-align: center;
  }
  .grad {
    background: var(--gradient-accent);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  h2 {
    font-size: var(--text-3xl);
    line-height: 1.1;
    margin: 0 0 var(--space-5);
    letter-spacing: -0.03em;
  }

  .lede {
    color: var(--color-text-secondary);
    font-size: var(--text-lg);
    max-width: 56ch;
    line-height: 1.55;
    margin: 0 0 var(--space-8);
  }
  .lede.center {
    margin-left: auto;
    margin-right: auto;
  }

  /* HERO */
  .hero {
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: var(--space-12);
    align-items: center;
    padding: var(--space-10) 0 var(--space-16);
  }
  .hero h1 {
    font-size: clamp(2.5rem, 5.5vw, 4rem);
    line-height: 1.04;
    letter-spacing: -0.035em;
    font-weight: 700;
    margin: 0 0 var(--space-5);
  }
  .hero .lede {
    font-size: var(--text-lg);
    margin-bottom: var(--space-8);
  }
  .hero-cta {
    display: flex;
    align-items: center;
    gap: var(--space-5);
  }
  .hero-cta.center {
    justify-content: center;
  }
  .cta-secondary {
    color: var(--color-text-secondary);
    text-decoration: none;
    font-size: var(--text-sm);
    transition: color var(--transition-fast);
  }
  .cta-secondary:hover {
    color: var(--color-accent);
  }
  .cta-secondary .arrow {
    display: inline-block;
    transition: transform var(--transition-base);
  }
  .cta-secondary:hover .arrow {
    transform: translateX(4px);
  }

  .hero-mockup svg {
    width: 100%;
    height: auto;
    filter: drop-shadow(0 24px 60px rgba(244, 63, 94, 0.18));
    animation: float 6s ease-in-out infinite;
  }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }

  /* PROBLEM */
  .problem h2 {
    text-align: center;
    max-width: 22ch;
    margin-left: auto;
    margin-right: auto;
  }
  .problem h2 code {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 0.1em 0.4em;
    font-family: var(--font-mono);
    font-size: 0.85em;
    color: var(--color-accent);
  }
  .problem-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-5);
    margin-top: var(--space-10);
  }
  .problem-card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    transition: border-color var(--transition-base), transform var(--transition-base);
  }
  .problem-card:hover {
    border-color: var(--color-border-hover);
    transform: translateY(-2px);
  }
  .problem-card .icon {
    font-size: 1.8rem;
    display: block;
    margin-bottom: var(--space-3);
  }
  .problem-card h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-base);
  }
  .problem-card p {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.6;
  }

  /* SOLUTION */
  .solution h2 {
    margin-bottom: var(--space-12);
  }
  .solution-row {
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: var(--space-12);
    align-items: center;
    padding: var(--space-8) 0;
  }
  .solution-row.reverse {
    direction: rtl;
  }
  .solution-row.reverse > * {
    direction: ltr;
  }
  .solution-text h3 {
    font-size: var(--text-xl);
    margin: 0 0 var(--space-3);
  }
  .solution-text p {
    color: var(--color-text-secondary);
    font-size: var(--text-base);
    line-height: 1.6;
    margin: 0;
  }
  .solution-visual {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
  }
  .solution-visual svg {
    width: 100%;
    height: auto;
    max-height: 200px;
  }

  /* TWO-SIDED */
  .two-sided h2 {
    margin-bottom: var(--space-10);
  }
  .cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-5);
  }
  .persona-card {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-8);
    transition: border-color var(--transition-base);
  }
  .persona-card:hover {
    border-color: var(--color-border-hover);
  }
  .persona-card h3 {
    font-size: var(--text-xl);
    margin: 0 0 var(--space-5);
  }
  .persona-card ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .persona-card li {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    padding-left: 1.4em;
    position: relative;
    line-height: 1.5;
  }
  .persona-card li::before {
    content: '✓';
    position: absolute;
    left: 0;
    color: var(--color-accent);
    font-weight: 700;
  }

  /* TRUST */
  .trust {
    text-align: center;
    border-top: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
    padding: var(--space-10) 0;
  }
  .trust-line {
    margin: 0 0 var(--space-2);
    color: var(--color-text-primary);
    font-size: var(--text-base);
  }
  .trust-line strong {
    font-weight: 600;
  }
  .stack {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }

  /* FINAL CTA */
  .final-cta {
    text-align: center;
  }
  .final-cta h2 {
    font-size: clamp(2rem, 4vw, 3rem);
  }

  /* FOOTER */
  .footer {
    border-top: 1px solid var(--color-border);
    padding: var(--space-10) 0 var(--space-8);
    margin-top: var(--space-12);
  }
  .footer-grid {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: var(--space-8);
    margin-bottom: var(--space-8);
  }
  .footer-brand .logo {
    margin: 0 0 var(--space-2);
  }
  .footer-tag {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }
  .footer h4 {
    color: var(--color-text-primary);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0 0 var(--space-3);
    font-weight: 600;
  }
  .footer a {
    display: block;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    text-decoration: none;
    margin-bottom: var(--space-2);
  }
  .footer a:hover {
    color: var(--color-text-primary);
  }
  .copy {
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
    text-align: center;
    margin: 0;
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-border);
  }

  /* MOBILE */
  @media (max-width: 880px) {
    .hero,
    .solution-row,
    .solution-row.reverse,
    .cards {
      grid-template-columns: 1fr;
      gap: var(--space-8);
    }
    .solution-row.reverse {
      direction: ltr;
    }
    .problem-grid {
      grid-template-columns: 1fr;
    }
    .footer-grid {
      grid-template-columns: 1fr 1fr;
    }
    section {
      padding: var(--space-12) 0;
    }
    .hero h1 {
      font-size: clamp(2rem, 8vw, 2.75rem);
    }
    h2 {
      font-size: clamp(1.75rem, 6vw, 2.25rem);
    }
  }

  @media (max-width: 480px) {
    .footer-grid {
      grid-template-columns: 1fr;
    }
    .hero-cta {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
    }
    .hero-cta.center {
      align-items: center;
    }
  }
</style>
