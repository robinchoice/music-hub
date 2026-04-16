# Music Hub

Webapp für Label-Kollaboration. Stack: SvelteKit + Hono + Postgres.

## Aktueller Stand

<!-- Zuletzt aktualisiert: 2026-04-13 via /save -->

**Sprint / Phase:** STEM-Feature + Bugfixes

**Zuletzt implementiert:**
- STEM-Support: Multi-File-Upload, ZIP-Download, StemList-Tab in Track-View
- Presigned URL fix: `ContentLength` entfernt (S3-Upload-Fehler)
- macOS Multi-Select fix: `accept="audio/*"` statt Extensions
- `/simplify`-Cleanup: async zip(), Null-Check, formatFileSize, Typ-Dedup

**Als nächstes:**
- STEM-Upload testen (Deploy läuft, noch nicht vom User bestätigt)
- RESEND_API_KEY setzen → echter E-Mail-Versand
- DB `is_public` nach Tests wieder deaktivieren

**Offene Punkte:**
- Upload-Fehler könnte noch S3-CORS sein (noch nicht ausgeschlossen)

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
