# Music Hub

Webapp für Label-Kollaboration. Stack: SvelteKit + Hono + Postgres.

## Aktueller Stand

<!-- Zuletzt aktualisiert: 2026-04-23 via /save -->

**Sprint / Phase:** UX-Qualität — Onboarding + Mobile abgeschlossen, deployed

**Zuletzt implementiert:**
- PWA Phase 2: Push Notifications (VAPID, `push_subscriptions`-Tabelle, SW push-Handler)
- Listen Analytics (`listen_events`-Tabelle, IP-Hashing, sendBeacon, AnalyticsPanel)
- Reject with Feedback (Modal mit Pflichtbegründung → Auto-Kommentar `❌`)
- SSE Real-time (`EventSource`, In-Memory Pub/Sub, `version:new`/`version:status`/`comment:new`)
- Onboarding Flow (`OnboardingFlow.svelte`): 3-Step Overlay mit Rollen-Picker, Demo/Projekt-Wahl, Invite
- Bottom Navigation (`BottomNav.svelte`): Nur ≤640px, safe-area-aware, öffnet Sidebar-Drawer
- Mobile-Polish: scrollbare Tabs, TopBar-Labels auf ≤480px ausgeblendet

**Als nächstes:**
- Phase 3: Background Sync für Uploads (IDB-Queue, SW sync-Handler)
- RESEND_API_KEY setzen für echten E-Mail-Versand
- Onboarding-Role für Backend-Personalisierung nutzen (aktuell nur localStorage)

**Offene Punkte:**
- RESEND_API_KEY fehlt noch (E-Mails nur geloggt)
- DB `is_public` nach STEM-Tests wieder auf privat

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
