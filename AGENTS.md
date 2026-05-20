# Music Hub

Webapp für Label-Kollaboration. Stack: SvelteKit + Hono + Postgres.

## Aktueller Stand

<!-- Zuletzt aktualisiert: 2026-05-20 via /save -->

**Aktive Spec:** `specs/mastering-delivery-live-ep.md`
**Sprint / Phase:** Audio-Mastering-Experiment fuer Live-Delivery

**Zuletzt implementiert:**
- Spec `specs/mastering-delivery-live-ep.md` angelegt und fuer warmen, analogen Live-Mastering-Flow genutzt.
- Externen Master fuer `S-Bahn.wav` gerendert und stream-sichere Version auf `-13.6 LUFS` / `-1.3 dBFS TP` gebracht.

**Als nächstes:**
- Finalen Master auf mehreren Abhoeren pruefen.
- Optional dunklere oder dichtere Alternative rendern.
- Danach wieder App-Backlog fortsetzen (`Background Sync`, `RESEND_API_KEY`, Onboarding-Role).

**Offene Punkte:**
- Erster Testexport war zu heiss; nur `S-Bahn_warm-analog-master_streamsafe_24b44k1.wav` verwenden.

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
