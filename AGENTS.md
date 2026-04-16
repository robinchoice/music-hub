# Music Hub

Webapp für Label-Kollaboration. Stack: SvelteKit + Hono + Postgres.

## Aktueller Stand

<!-- Zuletzt aktualisiert: 2026-04-16 via /save -->

**Sprint / Phase:** Full PWA — Phase 1 deployed, Phase 2+3 ausstehend

**Zuletzt implementiert:**
- PWA Phase 1: Offline-Audio-Download + Playback (commit `e58a7c2`)
  - API: `GET /versions/:id/audio?quality=stream|original` + `GET /versions/:id/waveform-data` (Server-Proxy)
  - SW: cache-first aus `musichub-offline-v1` für Proxy-Routen; Cache überlebt SW-Updates
  - IDB-Store (`idb` lib), Svelte 5 Runes Store mit Progress-Tracking
  - Track-Seite: Offline-Button mit Stream/Original-Picker, Cloud-Check wenn gecacht
  - `/offline`-Seite mit Speicheranzeige + Entfernen
  - Manifest: `shortcuts` für Dashboard + Offline-Tracks
- Security-Hardening (8 Issues), STEM Multi-Select Fix, S3-CORS gesetzt (frühere Session)

**Als nächstes:**
- Phase 1 verifizieren: SW unregistrieren, Track offline cachen, Flugmodus testen
- Phase 2: Push Notifications (`push_subscriptions`-Tabelle, `web-push`, VAPID-Keys)
- Phase 3: Background Sync für Uploads (IDB-Queue, SW sync-Handler)

**Offene Punkte:**
- RESEND_API_KEY noch nicht gesetzt (echter E-Mail-Versand)
- DB `is_public` nach STEM-Tests wieder deaktivieren

## Decisions

`docs/decisions/` — Architecture Decision Records für nicht-offensichtliche Entscheidungen.
Template: `docs/templates/adr.md`
Anlegen wenn: Alternative verworfen, Constraint akzeptiert, Richtungsentscheidung getroffen.

## Specs

`specs/` — ein File pro Sprint oder Feature, bevor Code geschrieben wird.
Template: `docs/templates/spec.md`

Konvention:
- Neues Sprint/Feature → erst `specs/sprint-N.md` oder `specs/feature-name.md` anlegen
- Kanban-Task verlinkt auf die Spec-Datei
- Aktive Spec steht im `## Aktueller Stand`

## Kanban

Board-ID: `cfddb658-6f5b-4d36-b311-369307a5fc51`

Konvention: Bei Session-Start `get-board-info` aufrufen und offene Tasks zeigen. Aktive Tasks nach In Progress ziehen, erledigte nach Done.
