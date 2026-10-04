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
DATABASE_URL=postgresql://musichub:musichub@localhost:5433/musichub
MAGIC_LINK_SECRET=<openssl rand -hex 32>
APP_URL=http://localhost:5173
```

Für E-Mail-Versand (optional, ohne läuft Magic Link in der Konsole):
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
- optional einen SMTP-Zugang für die Login-Mails. Ohne `SMTP_HOST` stehen die Login-Links im Log der API (`docker compose -f docker-compose.prod.yml logs api`).

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

Jeder Push auf `main` deployt automatisch: Ein GitHub-Webhook ruft Coolify auf, Coolify baut Web und API neu. Umgebungsvariablen werden in Coolify gepflegt, siehe `.env.production.example`.

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
