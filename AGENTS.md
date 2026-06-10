# Music Hub

Webapp für Label-Kollaboration. Stack: SvelteKit + Hono + Postgres.

## Aktueller Stand

<!-- Zuletzt aktualisiert: 2026-06-10 via /save -->

**Aktive Spec:** `specs/production-hardening.md`
**Sprint / Phase:** Production Hardening — App produktionsreif fuer externe Klienten

**Zuletzt implementiert:**
- DB privat gestellt: Production-`DATABASE_URL` auf internen Hostname (`qwcokswkccws04c08cko4c8w:5432` + Passwort) umgestellt, API redeployed (`running:healthy`), DB `is_public: false`, Port 15432 von aussen dicht (verifiziert).
- Geklaert: die „zwei DATABASE_URL" waren Production (preview=False) vs. Preview (preview=True) — kein Netzwerkproblem, nur falsch befuellte URL.
- Production-Hardening-Spec angelegt, Mastering-Experiment abgeloest.

**Als nächstes:**
- RESEND scharf schalten: Resend-Domain `mydrugismusic.com` verifizieren (SPF/DKIM, braucht Robin), `RESEND_API_KEY` in Coolify-API-App setzen, Magic-Link-Flow E2E testen.
- Nutzer-Flows (Login/Upload/Share) nach DB-URL-Wechsel gegenpruefen.

**Offene Punkte:**
- RESEND braucht Robins Account-Login + DNS — einziger verbleibender Prod-Blocker.
- Danach App-Backlog: `Background Sync` (PWA Phase 3), Onboarding-Role.

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
