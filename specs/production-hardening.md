# Production Hardening

**Status:** Active
**Repo:** musichub
**Erstellt:** 2026-06-09

## Ziel

Music Hub von „läuft im Test" auf produktionsreif für echte externe Klienten bringen — ohne Workarounds beim Login und ohne öffentlich erreichbare Datenbank.

## Warum

Die App ist feature-reich und live auf `hub.mydrugismusic.com`, aber zwei Produktions-Blocker stehen seit ~April offen (am 2026-06-09 via Coolify-API verifiziert):

- **Kein echter E-Mail-Versand:** `RESEND_API_KEY` ist in der API-App nicht gesetzt. `email.ts` fällt auf Logging zurück → Magic Links erreichen niemanden. Ohne das kann sich kein neuer Nutzer real einloggen.
- **DB öffentlich erreichbar:** Postgres ist `is_public: true` auf Port 15432. War ursprünglich nur für den Test geöffnet, weil der API-Container den internen Hostname nicht erreichte.

## In Scope

### 1. E-Mail-Versand scharf schalten
- Resend-Account / Domain `mydrugismusic.com` verifizieren (DNS: SPF, DKIM)
- `RESEND_API_KEY` in Coolify-API-App setzen (UUID `eccgw0cgggocwcss4og8so84`)
- `EMAIL_FROM` gegen verifizierte Domain prüfen (ist bereits gesetzt)
- Redeploy + echten Magic-Link-Flow End-to-End testen (Registrierung → Mail kommt an → Login klappt)

### 2. DB privat stellen
- Production-`DATABASE_URL` (Env-uuid `zo80kws0`, preview=False) von public IP auf internen Hostname mit Passwort umstellen: `postgres://musichub:<pw>@qwcokswkccws04c08cko4c8w:5432/musichub` (Wert siehe Coolify `internal_db_url`)
- API-App redeployen → prüfen ob `running:healthy` bleibt (= interner Hostname erreichbar)
- Wenn ja: DB auf `is_public: false` setzen, Port 15432 schließen
- Verifizieren: Login + Upload funktionieren weiter
- Rollback falls API nicht hochkommt: `DATABASE_URL` zurück auf `46.224.235.131:15432`, redeploy

## Out of Scope

- Background Sync (PWA Phase 3) — separates Feature, danach
- Onboarding-Role — danach
- Weiteres Feature-Polish

## Erfolgskriterien

- [ ] `RESEND_API_KEY` in Coolify gesetzt, Domain verifiziert
- [ ] Neue Registrierung → echte Magic-Link-Mail kommt an → Login erfolgreich
- [x] DB `is_public: false`, Port 15432 von außen nicht mehr erreichbar *(2026-06-09)*
- [x] API-Container verbindet über internen Hostname, App `running:healthy` *(2026-06-09)*
- [ ] Bestehende Nutzer-Flows (Login, Upload, Share) end-to-end gegenprüfen

## Implementierungsnotizen

- Coolify-Deploy-Workflow + UUIDs: siehe Memory `reference_coolify.md`
- Am 2026-06-09 via Coolify-API geklärt: die „zwei DATABASE_URL" sind kein Konflikt — public-IP-Variante ist Production (preview=False), interne-Hostname-Variante ist nur Preview (preview=True). Live-App nutzt ausschließlich die public IP.
- App (`musichub-api`) und DB (`musichub-db`) teilen `destination_id: 0` → selbe Destination, internes Docker-Network sollte stehen. Ursprüngliches „nicht erreichbar" war vermutlich eine falsch befüllte URL, kein echtes Netzwerkproblem — daher zuerst Umstellen+Redeploy testen statt Netzwerk-Debugging.
- Korrekte interne URL inkl. Passwort liefert Coolify als `internal_db_url` auf dem DB-Objekt.
- True-Peak des Mastering-Experiments (`mastering-delivery-live-ep.md`) ist erledigt — diese Spec löst sie als aktive Spec ab
