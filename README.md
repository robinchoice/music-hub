# Music Hub

Versionsverwaltung für Musikproduktionen. Kein Chaos mehr in Dropbox-Ordnern voller `final_v2_WIRKLICH_FINAL.wav`.

## Was ist das?

Music Hub ist eine kollaborative Plattform für Produzenten, Engineers und Labels. Tracks haben Versionen, Versionen haben Kommentare, und alle Beteiligten sehen was gerade der aktuelle Stand ist — ohne dass jemand eine WAV-Datei per WhatsApp schickt.

**Features:**
- Projekte und Tracks mit vollständiger Versionshistorie
- Wellenform-Ansicht direkt im Browser (WaveSurfer.js)
- Zeitgestempelte Kommentare auf Versionen
- Share-Links für externe Reviewer (kein Account nötig)
- Magic-Link-Auth — kein Passwort-Reset-Chaos
- S3-kompatibler File-Storage (Hetzner Object Storage)

## Stack

| Layer | Tech |
|-------|------|
| Frontend | SvelteKit + TypeScript |
| Backend | Hono (Bun) |
| Datenbank | PostgreSQL + Drizzle ORM |
| Storage | S3-kompatibel (Hetzner / MinIO) |
| Email | SMTP (z. B. Proton Mail) |
| Deploy | Coolify, Docker |

Monorepo mit Turborepo: `apps/web`, `apps/api`, `packages/db`, `packages/shared`.

## Setup (lokal)

**Voraussetzungen:** Bun, Docker

```bash
# Dependencies
bun install

# Dienste starten (Postgres + MinIO)
docker compose up -d

# .env anlegen
cp .env.example .env

# Dev-Server
bun dev
```

Web läuft auf `http://localhost:5173`, API auf `http://localhost:3000`.

### Umgebungsvariablen

Pflicht-Variablen in `.env`:

```env
DATABASE_URL=postgresql://musichub:musichub@localhost:5435/musichub
MAGIC_LINK_SECRET=<openssl rand -hex 32>
APP_URL=http://localhost:5173
```

Für E-Mail-Versand (lokal optional, ohne stehen die Magic Links in der Konsole; in Produktion startet die API ohne `SMTP_HOST` nicht):
```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=...
EMAIL_FROM=Music Hub <noreply@example.com>
```

## Datenbankmigrationen

```bash
# Schema ändern → Migration generieren
bun db:generate

# Migration anwenden
bun db:migrate
```

## Self-Hosting

Music Hub läuft auf jedem Server mit Docker. Du brauchst:

- eine Domain, z. B. `music.example.com`
- einen S3-kompatiblen Bucket mit HTTPS-Endpunkt, z. B. Hetzner Object Storage, Backblaze B2 oder Cloudflare R2. Browser laden Audio direkt in den Bucket hoch und streamen von dort.
- einen SMTP-Zugang für die Login-Mails. Ohne `SMTP_HOST` startet die API nicht, sonst könnte jeder mit Zugriff auf die Logs sich mit den dort stehenden Login-Links als beliebiger Nutzer anmelden.

```bash
git clone https://github.com/robinchoice/music-hub.git
cd music-hub
cp .env.production.example .env   # Werte eintragen
docker compose -f docker-compose.prod.yml up -d --build
```

Die App lauscht dann auf `127.0.0.1:3000`. Davor gehört ein Reverse Proxy mit HTTPS, ohne HTTPS funktioniert der Login nicht. Mit [Caddy](https://caddyserver.com) reicht als `Caddyfile`:

```
music.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Die API migriert die Datenbank beim Start und erlaubt der App-Domain den Zugriff auf den Bucket (CORS). Update: `git pull`, dann denselben `docker compose`-Befehl noch einmal. Sichern solltest du das Docker-Volume `pgdata` und den Bucket.

## Deployment

Läuft auf [Coolify](https://coolify.pleasance.org), gebaut aus `robinchoice/music-hub` (Branch `main`).

- **Web** (`Dockerfile.web`): [hub.pleasance.org](https://hub.pleasance.org), alte Domain hub.diespaetzles.lol parallel
- **API** (`Dockerfile.api`): intern via `API_INTERNAL_URL`, führt Migrationen beim Start aus
- **Datenbank:** Postgres als eigene Coolify-Ressource

Jeder Push auf `main` deployt automatisch: GitHub Actions prüft und baut die Images, dann deployt die CI API, Audio-Worker und Web über Coolify. Der Deploy ist erst erfolgreich, wenn `/api/v1/health` den Commit als `revision` meldet. Umgebungsvariablen werden in Coolify gepflegt, siehe `.env.production.example`.

Danach fotografiert der CI-Job `screenshots` die öffentliche Startseite (Demo mit Beispieldaten) und `/login`, ohne Anmeldung oder Nutzerdaten. `apps/web/screenshots.ts` erzeugt Desktop- (1440×900) und Handy-Bilder (390×844, doppelte Dichte) als WebP unter `docs/screenshots`. Der Bot committet geänderte Bilder mit `[skip ci]` auf `main`, damit kein weiterer Deploy startet. Anschließend meldet der Job `prototype-deployed` mit Repo-Slug und Deploy-Commit an `robinchoice/pleasance` über den bestehenden Empfänger-Workflow. Dafür nutzt er das bestehende Actions-Secret `PLEASANCE_DISPATCH_TOKEN`; dessen Token darf nur auf das Empfänger-Repo zugreifen.

Lokal: `bun run screenshots [url]` in `apps/web`, ohne URL gegen `http://localhost:5173`. Nur feste öffentliche Seiten ohne echte Nutzerdaten in `PAGES` aufnehmen, keine Profile, offenen Tracks oder Token-URLs. Vor dem nächsten Push den Bot-Commit von `main` holen.

## Update-Mails

Mails zu neuen Funktionen an alle, die sie bestellt haben. Ohne Opt-in geht nichts raus.

- Opt-in: ein nicht vorausgewähltes Kästchen beim Magic Link und bei der Registrierung. Es zählt erst, wenn der Link in der Mail geöffnet wird (Double-Opt-in), `users.updates_consent_at` hält den Zeitpunkt fest. Im Konto lässt es sich ein- und ausschalten.
- Abbestellen: Link in jeder Update-Mail (`/abbestellen?liste=updates`) und One-Click im Mailprogramm (`List-Unsubscribe`), beides mit `users.mail_token` wie bei den Versions-Mails, aber unabhängig von deren Schalter.
- Entwürfe: Agenten legen sie als `updates/<slug>.md` an, `# Titel`, dann `- Feature` je Zeile, optional `![](bild.png)` aus demselben Ordner. Die API übernimmt jede Datei beim Start einmal als Entwurf, spätere Änderungen an der Datei nicht mehr. Der API-Test prüft, dass alle Dateien lesbar sind.
- Senden: nur Admins aus `ADMIN_EMAILS` unter `/admin/updates`, mit Vorschau und Testmail an sich selbst. Danach lässt sich das Update nicht mehr ändern.
- Versand: die API, eine Mail alle `UPDATE_MAIL_INTERVAL_MS` (Standard 6000) über alle Instanzen, mit drei Versuchen pro Empfänger. Die Logs nennen keine Adressen.

## Für Agenten

Fremde Agenten lesen die öffentlichen Inhalte ohne HTML, nach [llms.txt](https://llmstxt.org). Quelle ist `publicPages` in `apps/api/src/lib/public-pages.ts`, die Routen stehen in `apps/api/src/routes/agents.ts`. Der Web-Server leitet die Pfade an die API weiter.

- `/llms.txt`: Einstieg mit Name, Tagline und allen öffentlichen Seiten als Links auf ihr Markdown.
- `/llms-full.txt`: alle Seiten in einer Datei.
- `<seite>.md`: jede Seite als Markdown, die Startseite als `/index.md`. Fragt ein Agent mit `Accept: text/markdown` nach einer Seite, die es als Markdown gibt, bekommt er unter derselben URL gleich das Markdown, alle anderen das HTML.
- Sprache: `?lang=de|en`, sonst `Accept-Language`, sonst Deutsch. Links behalten ein `?lang=`. Impressum und Datenschutz gibt es nur auf Deutsch, die englische Fassung sagt das vorneweg.
- Nur Startseite, Datenschutz und Impressum, nichts aus Projekten, offenen Tracks oder Profilen.
- Ausprobieren: `curl localhost:5173/llms.txt` bei laufendem `bun run dev`.

## Secret-Scan

Das Repo ist öffentlich, Code, Historie und CI-Logs. Der Workflow `.github/workflows/secrets.yml` läuft bei jedem Push auf jedem Branch und bei PRs aus Forks, ohne `paths-ignore`, und scannt mit gitleaks (Docker-Image, Version per Digest fest) die neuen Commits. Ein Fund macht den Lauf rot, der Wert steht dank `--redact` nicht im Log.

- Regeln: die Standardregeln von gitleaks über `.gitleaks.toml`, bisher ohne Ausnahmen.
- Fehlalarm: den `Fingerprint` aus dem Log als Zeile in `.gitleaksignore` eintragen.
- Echter Fund: Der Scan läuft erst nach dem Push, das Secret ist also schon öffentlich. Sofort rotieren, Entfernen aus dem Code oder der Historie reicht nicht.

## Login in der Savor-Vorschau

Agenten zeigen Änderungen hinter dem Login in der Savor-Vorschau mit dem Testkonto admin@pleasance.org. Dafür gibt `bun apps/api/src/login-link.ts <email>` im API-Container einen einmaligen Login-Link aus, 15 Minuten gültig wie ein gemailter, den der Agent per `browser_navigate` öffnet. Browser-Sessions in Benutzung verlängern sich höchstens einmal am Tag auf 365 Tage, also bleibt die Vorschau angemeldet. Auch Sessions des Plugins gelten 365 Tage und verlängern sich gleitend.

## Projektstruktur

```
music-hub/
├── apps/
│   ├── api/          # Hono API (Bun)
│   └── web/          # SvelteKit Frontend
├── packages/
│   ├── db/           # Drizzle Schema + Migrationen
│   └── shared/       # Zod-Schemas, gemeinsame Typen
├── Dockerfile.api
├── Dockerfile.web
└── docker-compose.yml
```

## Tests und Prozessende

`bun run check && bun run test && bun --bun run build` prüft Typen, die `any`-Regeln von Biome, API und Browser. Die API- und Browser-Suite laufen nacheinander, damit Browser-Build und API-Tests auf kleinen Rechnern nicht konkurrieren. Jede Suite bekommt eine eigene leere Datenbank auf dem Server aus `DATABASE_URL`; der Nutzer braucht `CREATEDB` (lokaler Compose- und CI-Nutzer haben es). `packages/db/test.ts` entfernt nur diese temporäre Datenbank nach Erfolg, Fehler oder SIGINT/SIGTERM. Direkte Aufrufe von `bun test` oder `playwright test` umgehen die Isolation. Playwright nutzt 31100/31101 unter dem ephemeren Linux-Portbereich; parallele Worktrees wählen andere Ports unter 32768 per `TEST_API_PORT` und `TEST_WEB_PORT`.

SIGTERM/SIGINT lässt die API laufende Anfragen und Mailjobs beenden, schließt SSE und danach Postgres. Datei-Uploads laufen direkt nach S3; ihre Bestätigung kann der Client nach dem Neustart senden. Der Worker stoppt ffmpeg, bevor er den Job zur Wiederaufnahme freigibt. Compose gewährt beiden 60 Sekunden. Die Prozesse prüfen formatierte Env-Werte beim Start mit zod; Fehler nennen nur die Feldnamen.
