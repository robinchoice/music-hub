# Music Hub

Versionsverwaltung für Musikproduktionen. Kein Chaos mehr in Dropbox-Ordnern voller `final_v2_WIRKLICH_FINAL.wav`.

## Was ist das?

Music Hub ist eine kollaborative Plattform für Produzenten, Engineers und Labels. Tracks haben Versionen, Versionen haben Kommentare, und alle Beteiligten sehen was gerade der aktuelle Stand ist — ohne dass jemand eine WAV-Datei per WhatsApp schickt.

**Features:**
- Projekte und Tracks mit vollständiger Versionshistorie
- Wellenform-Ansicht direkt im Browser (WaveSurfer.js)
- Zeitgestempelte Kommentare auf Versionen
- Share-Links für externe Reviewer (kein Account nötig)
- Ablieferung an Kunden mit Korrekturrunden und Bezahlwand (Lightning oder Überweisung direkt ans Studio)
- Magic-Link-Auth — kein Passwort-Reset-Chaos
- S3-kompatibler File-Storage (Hetzner Object Storage)

Tracks lassen sich über Rechtsklick oder „⋯“ umbenennen, einem Abschnitt (etwa EP oder Album) zuordnen, in ein anderes eigenes Projekt verschieben oder zusammenführen. In der Track-Liste helfen Mehrfachauswahl und Ziehen auf Abschnitte oder Projekte; am Handy beginnt langes Drücken die Auswahl. Zusammenführen zeigt vorher eine Vorschau, hängt Versionen hinten an und erhält Dateien, Kommentare und alte Adressen. Es lässt sich nicht als Ganzes rückgängig machen. Vorher die Sync-App synchronisieren: Lokal geänderte Dateien im alten Ordner können sonst wieder einen eigenen Track anlegen. Fremde Uploader müssen auch im Zielprojekt Mitglied sein; offene Tracks, Aufträge und laufende Importe sperren die Aktion.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | SvelteKit + TypeScript |
| Backend | Hono (Bun) |
| Datenbank | PostgreSQL + Drizzle ORM |
| Storage | S3-kompatibel (Hetzner / MinIO) |
| Email | SMTP (z. B. Proton Mail) |
| Deploy | Coolify, Docker |

Monorepo mit Turborepo: `apps/web`, `apps/api`, `apps/cli`, `packages/db`, `packages/shared`.

## Setup (lokal)

**Voraussetzungen:** Bun, Docker und FFmpeg samt `ffprobe` für den Audio-Worker und die Audio-Integrationstests.

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

### Wegwerf-Stack für UX-Prüfungen

Der UX-Tag arbeitet nach dem globalen Skill `ux-review`. Prod (`https://hub.pleasance.org`) nur lesend und ohne Anmeldung prüfen: öffentliche Seiten und Demo, nichts absenden und keinen Testkonto-Reset ausführen. Alles mit Anmeldung oder Schreiben läuft lokal mit leerer Datenbank und eigenem Bucket, nie mit einer Kopie echter Daten.

Vom Repo aus in einer Bash starten; vorher freie Ports und eindeutige Containernamen wählen (bei parallelen Prüfungen anpassen). Die Zugangsdaten unten gelten nur für diese Wegwerf-Dienste. `env -i` und `--no-env-file` halten die API und den Worker von geerbten Zugängen und Projekt-`.env` fern, insbesondere SMTP, Zahlungen und Dropbox.

```bash
W=$(mktemp -d /tmp/musichub-ux-XXXXXX)
mkdir -p .savor-logs
docker run -d --rm --name musichub-ux-pg -p 127.0.0.1:55433:5432 \
  -e POSTGRES_USER=musichub -e POSTGRES_PASSWORD=musichub -e POSTGRES_DB=musichub postgres:16-alpine
docker run -d --rm --name musichub-ux-s3 -p 127.0.0.1:59000:9000 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  -e MINIO_DEFAULT_BUCKETS=musichub bitnamilegacy/minio:latest

uxenv() {
  exec env -i PATH="$PATH" DATABASE_URL=postgresql://musichub:musichub@127.0.0.1:55433/musichub \
    S3_ENDPOINT=http://127.0.0.1:59000 S3_ACCESS_KEY=minioadmin S3_SECRET_KEY=minioadmin \
    S3_BUCKET=musichub APP_URL=http://localhost:54173 MAGIC_LINK_SECRET=ux-local-only "$@"
}
# Erst fortfahren, wenn Postgres und MinIO bereit sind.
docker exec musichub-ux-pg pg_isready -U musichub
curl -f http://127.0.0.1:59000/minio/health/ready

(cd apps/api && uxenv PORT=53000 bun --no-env-file src/index.ts) > .savor-logs/ux-api.log 2>&1 &
API_PID=$!
# Die API migriert beim Start; auf /api/v1/health warten, bevor der Worker startet.
curl -f http://localhost:53000/api/v1/health
(cd apps/api && uxenv PORT=53001 bun --no-env-file src/worker.ts) > .savor-logs/ux-worker.log 2>&1 &
WORKER_PID=$!
(cd apps/web && bun --bun run build)
(cd apps/web && exec env -i PATH="$PATH" PORT=54173 API_INTERNAL_URL=http://127.0.0.1:53000 \
  ORIGIN=http://localhost:54173 bun --no-env-file build/index.js) > .savor-logs/ux-web.log 2>&1 &
WEB_PID=$!

# Nur lokal: setzt test@onboarding.invalid samt Projekten und Dateien zurück.
(cd apps/api && uxenv bun --no-env-file -e '
  import { createDb } from "@music-hub/db";
  import { resetTestAccount } from "./src/lib/test-account.ts";
  const db = createDb(process.env.DATABASE_URL);
  console.log("http://localhost:54173/auth/verify?token=" + await resetTestAccount(db));
  await db.$client.end();
') > "$W/login-link.txt"
ffmpeg -f lavfi -i sine=frequency=220:duration=65 "$W/Letzte Bahn Mix.wav"
```

`vite dev` eignet sich hier nicht: Sein API-Proxy zeigt fest auf Port 3000. Das gebaute Web nutzt dagegen `API_INTERNAL_URL`. Der lokale Login-Link gilt einmalig; weitere Magic Links stehen ohne SMTP in `.savor-logs/ux-api.log`. Gäste und weitere Konten in eigenen Browser-Kontexten öffnen. Die WAV ist absichtlich länger als 60 Sekunden, damit ein einzelner Upload als Version erkannt wird. Mit dem Datei-Upload eine Version anlegen und warten, bis der Worker sie spielbar gemacht hat.

In Savor API, Worker und Web sofort nach dem Start mit `register_process` anmelden (echte PID, Arbeitsordner, Befehl, URL und jeweilige `.savor-logs/ux-*.log`). Belege und Playwright-Skripte unter `$W` ablegen; für den Import von `@playwright/test` dort `node_modules` auf `apps/web/node_modules` verlinken. Nach der Prüfung `kill "$WEB_PID" "$WORKER_PID" "$API_PID"`, auf deren Ende warten, die PIDs mit `unregister_process` austragen und nur die eigenen Container mit `docker stop musichub-ux-pg musichub-ux-s3` entfernen. Logs und Belege nach der Auswertung löschen, spätestens nach sieben Tagen.

Startpunkt fürs Funktionsinventar: Erstbesuch mit Demo; Onboarding bis zum ersten Track; Version hochladen und vergleichen; Feedback als Gast per Share-Link; Kommentare und Antworten am Handy; Projekte, Tracks, Mitglieder und Papierkorb verwalten; offene Tracks und Remix. Das ersetzt nicht das vollständige Inventar aus dem aktuellen Code.

### Umgebungsvariablen

Pflicht-Variablen in `.env`:

```env
DATABASE_URL=postgresql://musichub:musichub@localhost:5435/musichub
# Salt der IP-Hashes in der Hör-Statistik (trotz des Namens), nicht wechseln
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

Danach fotografiert der CI-Job `screenshots` die öffentliche Startseite (Demo mit Beispieldaten) und `/login`, ohne Anmeldung oder Nutzerdaten. `apps/web/screenshots.ts` erzeugt Desktop- (1440×900) und Handy-Bilder (390×844, doppelte Dichte) auf Deutsch und Englisch als WebP unter `docs/screenshots`. Der Bot committet geänderte Bilder mit `[skip ci]` auf `main`, damit kein weiterer Deploy startet. Anschließend meldet der Job `prototype-deployed` mit Repo-Slug und Deploy-Commit an `robinchoice/pleasance` über den bestehenden Empfänger-Workflow. Dafür nutzt er das bestehende Actions-Secret `PLEASANCE_DISPATCH_TOKEN`; dessen Token darf nur auf das Empfänger-Repo zugreifen.

Lokal: `bun run screenshots [url]` in `apps/web`, ohne URL gegen `http://localhost:5173`. Nur feste öffentliche Seiten ohne echte Nutzerdaten in `PAGES` aufnehmen, keine Profile, offenen Tracks oder Token-URLs. Vor dem nächsten Push den Bot-Commit von `main` holen.

## Update-Mails

Mails zu neuen Funktionen an alle, die sie bestellt haben. Ohne Opt-in geht nichts raus.

- Opt-in: ein nicht vorausgewähltes Kästchen beim Magic Link und bei der Registrierung. Es zählt erst, wenn der Link in der Mail geöffnet wird (Double-Opt-in), `users.updates_consent_at` hält den Zeitpunkt fest. Im Konto lässt es sich ein- und ausschalten.
- Abbestellen: Link in jeder Update-Mail (`/abbestellen?liste=updates`) und One-Click im Mailprogramm (`List-Unsubscribe`), beides mit `users.mail_token` wie bei den Versions-Mails, aber unabhängig von deren Schalter.
- Entwürfe: Agenten legen sie als `updates/<slug>.md` an, je Sprache `# de: Titel` bzw. `# en: Title`, darunter `- Feature` je Zeile, optional `![](bild.png)` aus demselben Ordner. Die API übernimmt jede Datei beim Start einmal als Entwurf, spätere Änderungen an der Datei nicht mehr. Der API-Test prüft, dass alle Dateien lesbar sind.
- Senden: nur Admins aus `ADMIN_EMAILS` unter `/admin/updates`, mit Vorschau und Testmail an sich selbst je Sprache. Gesendet wird erst mit Titel und Feature auf Deutsch und Englisch, jede Person bekommt die Sprache ihres Kontos (`users.locale`). Updates von vor Englisch (ohne `content.en`) lesen alle auf Deutsch. Danach lässt sich das Update nicht mehr ändern.
- Versand: die API, eine Mail alle `UPDATE_MAIL_INTERVAL_MS` (Standard 6000) über alle Instanzen, mit drei Versuchen pro Empfänger. Zwei Instanzen schicken nie dieselbe Zeile gleichzeitig, als gesendet gilt sie aber erst nach dem Commit: Stirbt die API zwischen SMTP-Annahme und Commit oder meldet der Server einen Fehler für eine zugestellte Mail, geht sie erneut raus. Eine doppelte Mail ist also selten möglich, eine nie angenommene gilt nie als gesendet. Die Logs nennen keine Adressen.

## Ablieferung mit Bezahlwand

Ein Studio hängt an seinen Link zum Reinhören für ein Projekt (`/album/<token>`) einen Auftrag: Kunde, Preis je Song, inklusive Korrekturrunden (Standard 2) und Preis jeder weiteren Runde. Im Projekt unter „Auftrag“, nur für Owner, oder per CLI `musichub deliveries`.

- Kunde: hört ohne Konto die MP3-Vorschau, kommentiert mit Zeitstempel und gibt je Song die gehörte Version frei oder fordert Änderungen an. Jede Anforderung ist eine Runde für diese Version, das Studio lädt danach eine neue hoch. Über die freien Runden hinaus muss der Kunde die Zusatzrunde ausdrücklich bestätigen („Zahlungspflichtig beauftragen · 40 €“), sie kommt auf die Schlussrechnung. Das Studio kann einem Song Runden schenken.
- Bezahlen: erst wenn alle Songs freigegeben sind, die Summe aus Songpreisen und Zusatzrunden, jede zum Preis, den der Kunde bestätigt hat. Schon eingegangene Zahlungen werden angerechnet, ein Auftrag ohne Betrag ist mit der letzten Freigabe bezahlt. Danach lädt der Kunde je Song die WAV der freigegebenen Version und, wenn eingestellt, die Spuren als ZIP. Vorher verlässt kein Original den Server.
- Kommt Geld für eine ersetzte oder abgelaufene Zahlung, zählt es trotzdem: Lightning-Rechnungen fragt die API noch zehn Minuten nach Ablauf bei der Wallet ab, jede andere Zahlung bestätigt das Studio im Auftrag von Hand. Zu viel Bezahltes zahlt das Studio selbst zurück.
- Geld läuft nie über Music Hub. Lightning: Rechnung aus der eigenen Wallet des Studios über Nostr Wallet Connect, nur mit Verbindungen, die empfangen, aber nicht zahlen dürfen; Kurs EUR→sats von mempool.space. Überweisung: an die IBAN des Studios mit GiroCode (EPC-QR), der Kunde meldet „Ich habe überwiesen“, das Studio bestätigt den Eingang. Zahlungswege richtet jedes Konto unter „Konto“ › „Zahlungswege“ ein.
- Tarif: Aufträge anlegen nur mit dem Tarif Studio (`users.plan = 'solo'`, optional bis `plan_until`) oder als Admin, siehe „Tarife“.
- Auftritt des Studios: Unter „Konto“ › „Dein Studio auf der Kundenseite“ (CLI `musichub studio`) setzt jedes Konto Namen, eine kurze Zeile und ein Logo (PNG, JPEG oder WebP bis 2 MB, über den Cover-Upload, `users.studio_*`). Die Kundenseite zeigt sie oben statt Music Hub und unten klein „Abgewickelt mit …“, nur solange das Konto des Auftrags (`deliveries.created_by_id`) den Tarif Studio hat oder Admin ist (`lib/studio-brand.ts`), sonst wie bisher den Kontonamen. Mehr als Name, Zeile und Logo-URL erfährt die Kundschaft nicht.
- Server: `PAYMENT_SECRETS_KEY` (32 Bytes base64, `openssl rand -base64 32`) verschlüsselt die Wallet-Verbindungen. Ohne ihn gibt es nur Überweisung. Ein neuer Key macht gespeicherte Verbindungen unlesbar, die Studios müssen sie neu eintragen.

## Tarife

Gratis, Pro (9 € im Monat, 90 € im Jahr, 100 GB) und Studio (24 € bzw. 240 €, 500 GB, dazu Aufträge). Preise und Grenzen stehen in `packages/shared/src/constants/plans.ts`, die Abrechnung in `apps/api/src/lib/billing.ts`, die Karte „Tarif“ im Konto in `PlanSettings.svelte`, in der CLI `musichub plan`.

- Regel „bezahlt bis“: Jede Zahlung schiebt nur `users.plan_until`, egal woher das Geld kommt. Ein laufender Tarif hebt das Speicherlimit an, nie darunter (`greatest` aus eigenem `storage_limit` und Tarif). Endet er, bleiben alle Dateien, nur neue Uploads über der eigenen Grenze gehen nicht mehr. Zahlende Konten zählen nicht gegen `MAX_USERS`.
- Stripe (Karte, PayPal, SEPA): Checkout als Abo mit dem Preis aus `PLAN_PRICES`, im Dashboard muss nichts angelegt werden. Der Webhook `invoice.paid` setzt `plan_until` aufs Ende der bezahlten Periode plus 3 Tage, `customer.subscription.deleted` vergisst nur das Abo. Kündigen über das Kundenportal von Stripe („Abo kündigen oder verwalten“).
- Lightning: eine Rechnung unseres BTCPay Servers für einen Monat oder ein Jahr im Voraus, ohne Abo. Die Karte „Tarif“ zeigt die Lightning-Rechnung selbst als QR-Code und fragt alle paar Sekunden nach, die Checkout-Seite von BTCPay bleibt privat. Bezahlt schiebt sie `plan_until` um die Periode, bei laufendem Tarif ab dessen Ende. Der Webhook sagt nur, welche Rechnung; den Status fragt die API bei BTCPay ab, ebenso beim Öffnen des Kontos für offene Rechnungen des letzten Tages. Spät eingegangenes Geld zählt.
- Während ein Tarif mit Enddatum läuft (auch ein geschenkter Gratis-Monat vom Admin), gibt es nur denselben Tarif: „mit Lightning verlängern“ oder ein Stripe-Abo, das erst zum Enddatum zum ersten Mal abbucht (`trialEnd`, Stripe-Trial bis `plan_until`). Das Abo gibt es nur, solange bis zum Enddatum noch mindestens 15 Tage sind, damit die Widerrufsfrist vor der ersten Abbuchung endet; die Rechnung über 0 € kauft keine eigene Zeit (`invoicePeriod`). Wechsel und Kauf neben einem Abo oder einem Tarif ohne Ende (vom Admin) gehen nicht, das klärt der Admin im Lagebild. Werden doch zwei Rechnungen für verschiedene Tarife bezahlt, läuft der größere bis zum späteren Ende.
- Verbraucherrecht: Kaufen geht nur mit dem Häkchen „Ich verlange ausdrücklich, dass mein Tarif sofort beginnt …“ (`PLAN_CONSENT`, gespeichert als `consented_at`). Jeder neue Vertrag (Lightning-Zahlung oder erste Rechnung eines Abos, nicht die Verlängerung) bekommt eine Bestätigungsmail mit AGB und Widerrufsbelehrung. „Verträge hier kündigen“ (§ 312k BGB) kündigt das Abo zum Ende der bezahlten Zeit, ein Jahresabo nach seiner ersten Verlängerung spätestens in einem Monat. „Widerrufen“ (§ 356a BGB) steht 14 Tage an der Zahlung und beendet, was sie gekauft hat. Erstattungen macht ein Admin von Hand, die API mailt `ADMIN_EMAILS` Betrag und Rechnung.
- Zahlungen stehen in `plan_payments` (eine Zeile je Rechnung, `external_id` eindeutig, doppelte Webhooks ändern nichts) und bleiben bei gelöschtem Konto für die Buchhaltung.
- Freunde einladen (`apps/api/src/lib/referrals.ts`, Karte „Freunde einladen“ im Konto, CLI `musichub referral`): Jedes Konto mit laufendem Tarif hat einen Link `/register?ref=<code>`. Wer darüber ein Konto anlegt, steht in `referrals`. Hat das neue Konto bezahlt und ist die Widerrufsfrist dieser Zahlung (14 Tage) ohne Widerruf vorbei, bekommen der Werbende 3 und die geworbene Person 7 Tage gratis (`REFERRAL_DAYS`), ohne Obergrenze. Das prüft die API stündlich. Mit Stripe-Abo kommen die Tage als Guthaben auf die nächste Abbuchung (ein Tag = 1/30 des Monatspreises), sonst schieben sie `plan_until`. Der Link lässt wie eine Einladung auch über `MAX_USERS` hinaus herein, solange weniger als `OPEN_REFERRALS_MAX` (5) seiner Geworbenen noch nicht belohnt sind. Der Werbende sieht nur die Anzahl, keine Namen.
- Ohne die Variablen gibt es nichts zu kaufen, die Karte „Tarif“ erscheint dann nur bei laufendem Tarif. Einschalten:
  1. Robin gibt die AGB, die Widerrufsbelehrung und den Datenschutz-Abschnitt „13. Tarife und Zahlungen“ frei (`packages/shared/src/terms.ts`, Entwurf nicht anwaltlich geprüft). Sie gehen mit dem ersten gesetzten Zahlungsweg live: `/agb`, `/agb.md`, der Abschnitt auf `/datenschutz` und die Bestätigungsmail.
  2. Stripe: `STRIPE_SECRET_KEY` (geheimer Key, `sk_live_…`) und einen Webhook auf `https://hub.pleasance.org/api/v1/billing/stripe` mit den Ereignissen `invoice.paid` und `customer.subscription.deleted`, dessen Signatur-Secret als `STRIPE_WEBHOOK_SECRET`. Kundenportal im Dashboard aktivieren (Kündigen erlauben).
  3. BTCPay: `BTCPAY_URL` (von VPS 1 aus erreichbar: `http://100.64.0.1:8380`, nginx auf pve übers Tailnet, durch kommen nur die Rechnungs-Endpunkte), `BTCPAY_STORE_ID`, einen Greenfield-API-Key mit `btcpay.store.cancreateinvoice` und `btcpay.store.canviewinvoices` als `BTCPAY_API_KEY`, einen Webhook auf `https://hub.pleasance.org/api/v1/billing/btcpay` (Ereignis „Invoice settled“, gern alle Rechnungsereignisse) mit seinem Secret als `BTCPAY_WEBHOOK_SECRET`.
  4. Alle Werte nur in Coolify bei der API (`secret-to-coolify`), nicht beim Worker.
  5. In Stripe unter Rechnungen und Belegen den Hinweis „Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.“ hinterlegen.

## Import aus Dropbox

Unter `/import` verbindet jemand seine Dropbox (nur lesend), wählt einen Ordner und bekommt eine Vorschau, was daraus wird. Erst nach „Importieren“ wird kopiert, in der Dropbox ändert sich nichts.

- Erkennung: `planImport` in `packages/shared/src/import-plan.ts`, feste Regeln ohne LLM, nur aus Pfaden, Größen und Daten. Ordner mit DAW-Projekt (`.als`, `.ptx`, `.cpr`, `.flp`, `.logicx` …) oder `Stems/` sind Songs. Darin werden Audiodateien unter `Bounces/`, `Mixes/` … und neben der Session Versionen (nach Nummer im Namen, sonst nach Datum), unter `Stems/` und gleich große Dateien eines Formats Spuren. Lose Mixe werden nach ihrem Namen zu Songs. Der Ordner darüber ist das Projekt, Namen wie „Mixes“ oder „Songs“ werden übersprungen. Backups und Innereien von DAW-Projekten bleiben in Dropbox, Unklares steht unter „Nicht zugeordnet“ und wird nur importiert, wenn jemand es zuordnet. Jede Regel hat einen Test in `apps/api/src/import-plan.test.ts`.
- Ablauf: `routes/imports.ts` und `lib/imports.ts`. Der Scan (`POST /imports/dropbox`) speichert die Dateiliste in `imports.entries`, die Vorschau schickt nur Indizes, Namen und Arten zurück, Größen kommen nie vom Browser. Der Start legt Projekte, Songs und `import_items` an und leert `entries`. Der Worker holt die Dateien einzeln in genau der gescannten Revision (`rev:`), rechnet dabei SHA-256, legt sie unter `projects/<id>/uploads/` ab und registriert sie wie die Upload-Routen. Ein zweiter Import überspringt Dateien mit bekanntem Content-Hash und hängt neue Bounces an den schon importierten Song. Songs ohne eigenen Bounce mischt die App aus den Spuren (`stem_mix`).
- Verbindung: OAuth mit PKCE, ohne App-Secret. Der Refresh-Token liegt verschlüsselt in `dropbox_connections`, „Trennen“ widerruft ihn bei Dropbox. Team-Konten lesen ab ihrem Root-Namespace.
- Einschalten: In der [Dropbox App Console](https://www.dropbox.com/developers/apps) eine App mit Scoped Access und Full Dropbox, Berechtigungen `files.metadata.read` und `files.content.read`, Redirect `https://hub.pleasance.org/api/v1/dropbox/callback` (lokal `http://localhost:5173/api/v1/dropbox/callback`). Im Entwicklungsmodus „Enable additional users“, sonst verbindet sich nur das eigene Konto. In Coolify bei API und Worker: `DROPBOX_APP_KEY` (der App Key) und `DROPBOX_TOKEN_KEY` (32 Zufallsbytes als Base64, verschlüsselt die Refresh-Tokens). Ohne beide zeigt `/import` nur „noch nicht eingerichtet“.
- Aufräumen: Scans ohne Start löscht der Worker nach einem Tag, gestartete Importe behalten nur ihre Dateizeilen.

## Für Agenten

Fremde Agenten lesen die öffentlichen Inhalte ohne HTML, nach [llms.txt](https://llmstxt.org). Quelle ist `publicPages` in `apps/api/src/lib/public-pages.ts`, die Routen stehen in `apps/api/src/routes/agents.ts`. Der Web-Server leitet die Pfade an die API weiter.

- `/llms.txt`: Einstieg mit Name, Tagline und allen öffentlichen Seiten als Links auf ihr Markdown.
- `/llms-full.txt`: alle Seiten in einer Datei.
- `<seite>.md`: jede Seite als Markdown, die Startseite als `/index.md`. Fragt ein Agent mit `Accept: text/markdown` nach einer Seite, die es als Markdown gibt, bekommt er unter derselben URL gleich das Markdown, alle anderen das HTML.
- Sprache: `?lang=de|en`, sonst `Accept-Language`, sonst Deutsch. Links behalten ein `?lang=`.
- Nur Startseite, Datenschutz und Impressum, nichts aus Projekten, offenen Tracks oder Profilen.
- Ausprobieren: `curl localhost:5173/llms.txt` bei laufendem `bun run dev`.

## Secret-Scan

Das Repo ist öffentlich, Code, Historie und CI-Logs. Der Workflow `.github/workflows/secrets.yml` läuft bei jedem Push auf jedem Branch und bei PRs aus Forks, ohne `paths-ignore`, und scannt mit gitleaks (Docker-Image, Version per Digest fest) die neuen Commits. Ein Fund macht den Lauf rot, der Wert steht dank `--redact` nicht im Log.

- Regeln: die Standardregeln von gitleaks über `.gitleaks.toml`, bisher ohne Ausnahmen.
- Fehlalarm: den `Fingerprint` aus dem Log als Zeile in `.gitleaksignore` eintragen.
- Echter Fund: Der Scan läuft erst nach dem Push, das Secret ist also schon öffentlich. Sofort rotieren, Entfernen aus dem Code oder der Historie reicht nicht.

## Login in der Savor-Vorschau

Agenten zeigen Änderungen hinter dem Login in der Savor-Vorschau mit dem Testkonto admin@pleasance.org. Dafür gibt `bun apps/api/src/login-link.ts <email>` im API-Container einen einmaligen Login-Link aus, 15 Minuten gültig wie ein gemailter, den der Agent per `browser_navigate` öffnet. Browser-Sessions in Benutzung verlängern sich höchstens einmal am Tag auf 365 Tage, also bleibt die Vorschau angemeldet. Auch Sessions des Plugins gelten 365 Tage und verlängern sich gleitend. Für die CLI nimmt der Agent denselben Link per Pipe, siehe „CLI“.

## CLI

Music Hub hat eine eigene Befehlszeile in `apps/cli`, damit Agenten, Skripte und Tests die App über Befehle bedienen statt über die UI. Sie spricht nur mit der HTTP-API wie Web und Plugin, nie mit der Datenbank. So gelten dieselben Rechte, Rate-Limits und `MAX_USERS`. Die Argumente liest `parseArgs` aus `node:util`, ohne weitere Abhängigkeit.

- Bauen: `bun run build` in `apps/cli` (auch Teil von `bun --bun run build`) kompiliert `apps/cli/build/musichub`, eine einzelne Datei mit Bun darin (gut 100 MB). Die Adresse ist eingebacken, `https://hub.pleasance.org`, oder `CLI_URL` aus der Umgebung beim Bauen. `--url` wählt eine andere, etwa `http://localhost:5173` gegen `bun run dev`, danach gilt die Adresse des letzten Logins. Ohne Bauen: `bun apps/cli/src/main.ts <befehl>`.
- Anmelden: `musichub login` nutzt den Geräte-Login des Plugins (`routes/device.ts`): Die CLI zeigt einen Link auf `/device` mit Code, wer im Browser angemeldet ist, bestätigt ihn. Konten entstehen dabei nicht. `musichub login --link <link>` löst einen Login-Link ein, `--link -` liest ihn von stdin (`/auth/verify` mit `cookie: false` gibt den Token zurück). Danach liegt der Token dieses Geräts mit `0600` in `$XDG_CONFIG_HOME/musichub/session.json` (sonst `~/.config`, unter macOS `~/Library/Application Support`, unter Windows `%APPDATA%`), zusammen mit der Adresse, an andere Adressen geht er nie. Er ist eine gewöhnliche Session als Bearer mit `client = 'cli'`: gehasht in `sessions`, 365 Tage, verlängert sich bei Nutzung, jedes Gerät hat seine eigene. `whoami` zeigt das Konto, `logout` widerruft den Token auf dem Server und löscht die Datei, ein neuer Login widerruft den alten. Antwortet die Adresse des gespeicherten Tokens nicht mehr (gestoppter Dev-Server, umgezogene App), scheitern `login` ohne `--url` und `logout`, damit kein Token unbemerkt gültig bleibt. `logout --forget` löscht ihn dann nur auf diesem Gerät, am Server bleibt er bis zum Ablauf gültig.
- Befehle: `projects [--archived]` listet die eigenen Projekte mit Rollen und Anzahl der Tracks. `members --project <Name oder ID>` listet, wer im Projekt ist, mit Rollen und Rechten; `members set <E-Mail> --project <…> --allow <Rechte> --deny <Rechte>` schaltet einzelne Rechte einer Person an oder aus (nur als Owner; `upload`, `download`, `comment`, `approve`, `invite`, mit Komma getrennt). `board [--project <Name oder ID>]` listet die Tracks nach Produktionsphase wie das Board im Web, `board move <Phase> --project <Name oder ID> --track <Name oder ID>` schiebt einen in eine andere Phase (`sketch`, `recording`, `mixing`, `mastering`, `final`, `released`; nur wer hochladen darf). `tracks --project <Name oder ID>` listet die Tracks eines Projekts mit Phase und Zahl der Versionen, `tracks create <Name> --project <…>` legt einen an. Zum Aufräumen (nur als Owner beider Projekte, wie im Web): `tracks rename <neuer Name> --project <…> --track <…>` benennt um, `tracks section <Name> --project <…> --track <…>` legt den Track in einen Abschnitt (EP, Album), `--none` nimmt ihn heraus. `tracks move --project <…> --track <…> --to <Projekt> [--section <Name> | --none]` verschiebt ihn samt Versionen, Spuren und Dateien in ein anderes eigenes Projekt. `tracks merge --project <…> --track <…> --into <Track> [--into-project <…>] [--dry-run]` führt ihn in einen anderen zusammen (Versionen hinten angehängt, gleiche Dateien in den Papierkorb, Spuren gleichen Namens als Fassungen); `--dry-run` zeigt nur, was passieren würde. `tracks duplicates [--project <…>]` listet mögliche Dubletten (ähnlicher Name oder gleiche Datei). `versions move --project <…> --track <…> --version <n> --to <Track> [--to-project <…>]` verschiebt eine Version in einen anderen Track, `versions split … --version <n> [--name <Text>]` macht sie zu einem eigenen Track. `versions --project <…> --track <Name oder ID>` listet die Versionen eines Tracks, die neueste zuerst; `versions upload <Datei> --project <…> --track <…> [--label <Text>]` lädt eine Audiodatei als nächste Version hoch, wie das Web direkt in den Bucket, `versions download --project <…> --track <…> [--version <n>] [--out <Datei>]` speichert das Original (Standard die neueste Version unter ihrem Dateinamen, nie über eine vorhandene Datei; nur mit Download-Recht). `versions measure --project <…> --track <…> [--version <n>]` zeigt Terzspektrum, Stereobreite, Korrelation und Mono-Verlust einer Version und je Terz den Unterschied zur Vorversion bei gleicher Lautheit, mit Referenztrack auch zu ihm. `files reference <Name oder ID> --project <…>` macht eine Audiodatei des Projekts zu dessen Referenztrack, `files reference --none --project <…>` nimmt die Markierung weg (nur mit Upload-Recht). `files --project <…>` listet die Dateien eines Projekts (alles, was keine Version und keine Spur ist), `files upload <Datei> --project <…>` lädt eine beliebige Datei dorthin; mit `--track <…>` beides nur für die Dateien eines Tracks (sein Reiter „Dateien“), `files download <Name oder ID> --project <…> [--out <Datei>]` speichert sie (nur mit Download-Recht). `comments --project <…> --track <…> [--version <n>]` zeigt die Kommentare einer Version mit Antworten, `comments add <Text> … [--at 1:23]` kommentiert, auf Wunsch an einer Stelle im Song. `reviews …` zeigt, wer mit welchem Urteil fertig ist und wer noch fehlt, `reviews send <approve|fine|changes|notes> … [--note <Text>]` schließt den eigenen Durchgang wie „Fertig mit V4“. `--version` nimmt `3`, `V3` oder die ID. `share --project <Name oder ID>` gibt den eigenen Link zum Reinhören für ein ganzes Projekt aus und legt ihn beim ersten Mal an. `deliveries` verwaltet Aufträge auf diesem Link, nur als Besitzer des Projekts: `list [--project <Name oder ID>]` listet sie mit Status, Freigaben und Summe, `show <ID>` zeigt Songs, Runden und Zahlungen. `create --project <Name oder ID> --client <Name> --price <Euro>` legt einen an (braucht den Tarif Studio), der Preis gilt je Song; dazu `--track <Name>` (mehrfach, sonst alle Songs), `--email`, `--reference`, `--rounds` (inklusive Runden je Song, Standard 2), `--extra <Euro>` (Zusatzrunde) und `--no-stems`. `confirm-payment <ID>` bestätigt den Eingang der offenen Überweisung, `cancel <ID>` storniert einen offenen Auftrag. `studio` zeigt den Auftritt auf der Kundenseite, `studio set [--name <Text>] [--line <Text>] [--logo <Datei> | --clear-logo]` setzt ihn, leerer Text löscht. `plan` zeigt Tarif, Speicher und Zahlungen, gekauft wird im Web. `imports` listet die letzten Importe aus Dropbox, gestartet werden sie im Web. Beträge nimmt die CLI in Euro wie `40` oder `12,50`.
- Ausgabe: Text für Menschen, mit `--json` genau ein JSON-Wert auf stdout, auch Fehler als `{ "error": "…" }` und die Hilfe als Liste der Befehle. Exit-Codes: 0 erledigt, 1 Fehler (auch Absagen der API wie ein volles Music Hub), 2 falscher Aufruf, 3 nicht angemeldet. Hilfe und Meldungen stehen auf Englisch in `apps/cli/src/texts.ts`, auch die API antwortet der CLI auf Englisch.
- Eigene Befehle: Datei in `apps/cli/src/commands` nach dem Beispiel `projects.ts` und in `commands` in `src/cli.ts` eintragen. Ein Befehl nennt Hilfezeilen, Optionen und `run`. Das ruft über `ctx.api` die API auf, liest die Antwort mit zod und gibt `{ data, text }` zurück, `data` für `--json`. `currentUser(ctx)` verlangt den Login, Fehler enden als `Failure` mit einem Code aus `EXIT`. Die Tests in `src/cli.test.ts` rufen die CLI im Prozess gegen die echten API-Routen mit der Testdatenbank auf.
- Agenten: nur mit dem Testkonto admin@pleasance.org, nie mit Kundenkonten. Den Token holen sie über den Login-Link aus dem Kontor, per Pipe, so steht der Link nicht in ihrem Kontext: `login-link musichub | apps/cli/build/musichub login --link -`. Danach bleibt die CLI auf diesem Rechner angemeldet.
- Verteilen: Für andere Plattformen `bun run build --target=bun-darwin-arm64` in `apps/cli` (ebenso `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`), das überschreibt `build/musichub`. Die CI baut die Datei bei jedem Lauf zur Probe, veröffentlicht sie aber nicht.

## Projektstruktur

```
music-hub/
├── apps/
│   ├── api/          # Hono API (Bun)
│   ├── cli/          # Befehlszeile gegen die API, siehe „CLI“
│   └── web/          # SvelteKit Frontend
├── packages/
│   ├── db/           # Drizzle Schema + Migrationen
│   └── shared/       # Zod-Schemas, gemeinsame Typen
├── Dockerfile.api
├── Dockerfile.web
└── docker-compose.yml
```

## MCP (Pilot, nur lesend)

Chat-Clients verbinden sich per Streamable HTTP mit `https://hub.pleasance.org/mcp` (lokal `<APP_URL>/mcp`). Für den gebauten lokalen Webserver `bun src/server.ts` in `apps/web` verwenden (wie im Docker-Image und den Browser-Tests): Nur `/api/v1/oauth/token` und `/api/v1/oauth/revoke` gehen dort vor SvelteKit zur API, weil der OAuth-Formulartausch ohne Browser-Origin sonst am CSRF-Schutz scheitert. Die übrigen Routen behalten dessen Schutz. Das offizielle `@modelcontextprotocol/sdk` bedient den Endpunkt zustandslos; mehrere API-Instanzen teilen nur Postgres. Der Pilot ändert nichts an starter.

| Tool | Inhalt |
| --- | --- |
| `list_projects` | Eigene aktive oder archivierte Projekte |
| `get_project` | Projekt, eigene Rechte und angenommene Anfragen |
| `list_tracks` | Tracks eines Projekts mit Produktionsphasen für das Board |
| `list_versions` | Versionen eines Tracks, Messwerte und Zahl offener Kommentare |
| `get_feedback` | Kommentare einer Version, Rückmeldungen und ausstehendes Feedback |
| `get_overview` | Aktivitäten und Daten für Board und Plan aller eigenen aktiven Projekte |
| `list_deliveries` | Aufträge eines Projekts, nur mit Owner-Rechten |

Die Tools rufen ausschließlich fest vorgegebene GET-Routen derselben API auf, inklusive deren Rechteprüfungen. Es gibt weder frei wählbare Pfade noch Schreib- oder Download-Tools. Gast-Link-Tokens werden aus Antworten entfernt, weil sie Schreibrechte verleihen können. Die MCP-Authentifizierung ändert auch keine Lesemarken oder Sitzungen. Pro Konto gelten zusätzlich höchstens 120 MCP-Anfragen und 120 Tool-Aufrufe pro Minute, in derselben Postgres-Rate-Limit-Tabelle wie die API.

Anmeldung: Der Client entdeckt `/.well-known/oauth-protected-resource/mcp` und `/.well-known/oauth-authorization-server`, registriert sich bei `/api/v1/oauth/register` und startet Authorization Code mit PKCE S256, `resource=<APP_URL>/mcp` und Scope `music:read`. Die Zustimmung unter `/oauth/consent` setzt den bestehenden Login voraus (Mail-Code oder Passkey); OAuth legt keine Konten an. Die Freigabe nennt Client, angemeldetes Konto, Umfang und Rücksprungadresse. Abgelehnt wird ohne Token. Zugriffstokens gelten eine Stunde, rotierende Refresh-Tokens 30 Tage, die Freigabe insgesamt höchstens 90 Tage. Wiederverwendete Refresh-Tokens widerrufen die gesamte Verbindung. Codes sind fünf Minuten gültig und einmalig. Tokens und Client-Secrets stehen nur als Hash in der Datenbank. Cookie-Sitzungen gelten nicht am MCP-Endpunkt und OAuth-Tokens nicht an den übrigen API-Routen.

Unter **Konto → KI-Clients** stehen die verbundenen Clients und das Ende ihrer Freigabe. „Zugriff widerrufen“ löscht die Verbindung mit allen Codes und Tokens sofort; außerdem gibt es `/api/v1/oauth/revoke` nach RFC 7009. Registrierte Redirects müssen HTTPS verwenden, nur Loopback-Adressen dürfen HTTP nutzen. Es gelten exakte Redirects, keine Wildcards. Öffentliche Clients und Clients mit `client_secret_basic` oder `client_secret_post` werden unterstützt. Die Metadaten bewerben ausschließlich `music:read`, PKCE S256 und Code-/Refresh-Grants. Das bestehende stündliche Cleanup entfernt abgelaufene OAuth-Daten sowie seit 90 Tagen nicht mehr verbundene Client-Registrierungen.

OAuth-Baustein: [@node-oauth/oauth2-server](https://github.com/node-oauth/node-oauth2-server) übernimmt Code-Austausch, PKCE, Scope- und Client-Prüfung sowie Token-Erneuerung; unsere Adapter speichern den Zustand in Drizzle. Geprüfte Alternativen: Die [Auth-Helfer des MCP-SDK](https://github.com/modelcontextprotocol/typescript-sdk) sind an Express gebunden; [@jmondi/oauth2-server](https://github.com/jasonraimondi/ts-oauth2-server) bringt ein umfangreicheres Repository-/OIDC-Modell mit. Der gewählte Baustein passt mit einem kleinen Fetch-Adapter zur vorhandenen Hono-API und braucht keinen weiteren Dienst und keinen neuen Signierschlüssel.

Testen:

- `bun run check && bun run test && bun --bun run build`. `apps/api/src/mcp.test.ts` nutzt den offiziellen SDK-Client und die isolierte Testdatenbank: eigenes und fremdes Projekt, PKCE, Scope, Audience, Code-Replay, Refresh-Rotation, gesperrtes Konto und Widerruf. `apps/web/tests/mcp.test.ts` spielt Zustimmung und Widerruf auf Desktop und Pixel 7 auf Deutsch und Englisch durch.
- Mit dem [MCP Inspector](https://github.com/modelcontextprotocol/inspector) Streamable HTTP und die Server-URL wählen, OAuth starten, ausschließlich mit `admin@pleasance.org` anmelden, Lesen erlauben, `tools/list` und etwa `list_projects` aufrufen. Danach in **Konto → KI-Clients** widerrufen; weitere Aufrufe müssen 401 ergeben. Keine Konten der Kundschaft für Agententests verwenden.
- Live muss `GET /mcp` ohne Bearer 401 mit `WWW-Authenticate` und der Metadata-URL liefern. Bei `tools/call` mit fremder Projekt-ID liefert das Tool einen Fehler ohne Projektdaten. Live keine fremden IDs aus Kundenkonten suchen: Die automatisierte Suite belegt die Sperre mit eigens angelegten Testdaten.

## Tests und Prozessende

`bun run check && bun run test && bun --bun run build` prüft Typen, die `any`-Regeln von Biome, API, CLI und Browser und baut Web und CLI. Die API- und Browser-Suite laufen nacheinander, damit Browser-Build und API-Tests auf kleinen Rechnern nicht konkurrieren. Jede Suite bekommt eine eigene leere Datenbank auf dem Server aus `DATABASE_URL`; der Nutzer braucht `CREATEDB` (lokaler Compose- und CI-Nutzer haben es). `packages/db/test.ts` entfernt nur diese temporäre Datenbank nach Erfolg, Fehler oder SIGINT/SIGTERM. Direkte Aufrufe von `bun test` oder `playwright test` umgehen die Isolation. Playwright nutzt 31100/31101 unter dem ephemeren Linux-Portbereich; parallele Worktrees wählen andere Ports unter 32768 per `TEST_API_PORT` und `TEST_WEB_PORT`.

SIGTERM/SIGINT lässt die API laufende Anfragen und Mailjobs beenden, schließt SSE und danach Postgres. Datei-Uploads laufen direkt nach S3; ihre Bestätigung kann der Client nach dem Neustart senden. Der Worker stoppt ffmpeg, bevor er den Job zur Wiederaufnahme freigibt. Compose gewährt beiden 60 Sekunden. Die Prozesse prüfen formatierte Env-Werte beim Start mit zod; Fehler nennen nur die Feldnamen.

## Lizenz und Beiträge

Music Hub steht unter der [GNU AGPL 3.0](LICENSE). Wer zum ersten Mal einen Pull Request schickt, unterschreibt einmalig das [Contributor License Agreement](CLA.md) per Kommentar, der Bot (`.github/workflows/cla.yml`) sagt, welchen. Die Unterschriften liegen im Branch `cla-signatures`, nicht auf `main`. Das CLA erlaubt, Music Hub neben der AGPL auch unter einer kommerziellen Lizenz anzubieten; Beitragende behalten ihr Urheberrecht.
