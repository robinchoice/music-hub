# Music Hub

Webapp für Label-Kollaboration. Stack: SvelteKit + Hono + Postgres.

## Aktueller Stand

<!-- Zuletzt aktualisiert: 2026-04-13 via /save -->

**Sprint / Phase:** Deploy + erster Klienten-Test

**Zuletzt implementiert:**
- App live auf hub.mydrugismusic.com (Registrierung, Login funktionieren)
- Coolify-Deploy via Webhook-Script (kein UI nötig, im Memory dokumentiert)
- DATABASE_URL auf public port umgestellt (interner Coolify-Hostname war nicht erreichbar)
- README geschrieben und gepusht

**Als nächstes:**
- RESEND_API_KEY setzen → echter E-Mail-Versand
- App-Bugs fixen (User: „man kann quasi nichts machen außer Profil/Karte")
- DB `is_public` nach Tests wieder deaktivieren

**Offene Punkte:**
- Interner Coolify-Netzwerkfehler (API→DB via UUID-Hostname) ungeklärt

## Decisions

`docs/decisions/` — Architecture Decision Records für nicht-offensichtliche Entscheidungen.
Template: `~/.claude/templates/adr.md`
Anlegen wenn: Alternative verworfen, Constraint akzeptiert, Richtungsentscheidung getroffen.

## Specs

`specs/` — ein File pro Sprint oder Feature, bevor Code geschrieben wird.
Template: `~/.claude/templates/spec.md`

Konvention:
- Neues Sprint/Feature → erst `specs/sprint-N.md` oder `specs/feature-name.md` anlegen
- Kanban-Task verlinkt auf die Spec-Datei
- Aktive Spec steht im `## Aktueller Stand`

## Kanban

Board-ID: `cfddb658-6f5b-4d36-b311-369307a5fc51`

Konvention: Bei Session-Start `get-board-info` aufrufen und offene Tasks zeigen. Aktive Tasks nach In Progress ziehen, erledigte nach Done.
