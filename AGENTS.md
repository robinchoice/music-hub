# Music Hub

## Zweck & Links

- Läuft produktiv auf https://hub.pleasance.org, https://hub.diespaetzles.lol bleibt parallel erreichbar. Stabilität, Sicherheit und Datenerhalt gehen vor neuen Features.
- Coolify auf VPS 1, Projekt `pleasance-musichub`, getrennte Anwendungen für API, Audio-Worker und Web.
- Das DAW-Plugin `robinchoice/musichub-plugin` spricht dieselbe API. Ausgelieferte Plugin-Versionen müssen nach jedem Update weiter funktionieren, siehe Rückwärtskompatibilität.

## Checks

`bun run check && bun run test && bun --bun run build`, keine neuen Fehler. Die Tests (`apps/api/src/*.test.ts`) laufen gegen `DATABASE_URL`, legen nur eigene Zeilen an und räumen sie wieder ab. `bun run test` startet auch die Playwright-Tests in `apps/web/tests` (Desktop und Pixel 7): Sie bauen das Web und starten API und Web selbst auf den Ports 53100 und 54100 (testen mehrere Worktrees gleichzeitig, per `TEST_API_PORT` und `TEST_WEB_PORT` andere wählen), Chromium einmalig mit `bunx playwright install chromium` in `apps/web`.

## Deploy

- Jeder Push auf `main` geht sofort live: Die CI prüft, baut die Images und deployt über die Coolify-API erst die API, dann den Worker, dann das Web. Auf VPS 1 wird nicht gebaut.
- Prüfen: `gh run watch`. Der Deploy-Job ist erst grün, wenn `https://hub.pleasance.org/api/v1/health` den Commit als `revision` meldet.
- Destruktive Aktionen (Daten oder Volumes löschen, manuelle Änderungen an der Prod-DB) nur nach ausdrücklicher Freigabe.

## Fallen

- Die Landingpage zeigt die echte Track-Seite im Demo-Modus und ihre Komponenten mit Beispieldaten (`apps/web/src/lib/demo`). Nutzt eine Seite einen neuen API-Endpunkt, braucht `backend.ts` dafür eine Antwort, sonst meldet die Demo „In der Demo nicht verfügbar“.
- Die API ist zustandslos und darf mit mehreren Instanzen laufen. Nichts, was zwischen Anfragen gelten muss, gehört in den Speicher des Prozesses: Rate-Limits stehen in `rate_limits` (`lib/rate-limit.ts`), SSE-Events gehen per Postgres `NOTIFY` an alle Instanzen (`services/sse.ts`, Payload nur IDs, Grenze 8000 Bytes), Migrationen laufen unter einem Advisory-Lock (`migrateDb`).
- Audio verarbeitet nur der Worker (`apps/api/src/worker.ts`, Image `musichub-worker`, ein ffmpeg-Job gleichzeitig). Die API legt Jobs in `audio_jobs` an. Stirbt der Worker, holt er den Job nach Ablauf der Lease (5 Minuten) erneut ab, nach drei Versuchen wird die Version ohne MP3 und Wellenform `ready`. Der Worker leert auch den Papierkorb (alle sechs Stunden). Lokal startet `bun run dev` API und Worker.
- Neue Versionen kündigt die API nicht sofort an, sondern ein Intervall in der API (`lib/notices.ts`, Tabelle `version_notices`, nicht im Worker, der hat kein SMTP und kein VAPID): erst wenn der Uploader 2 Minuten pausiert, spätestens nach 10, als ein Push für alle mit Abo und eine Mail für alle ohne (`users.version_mails`, Abbestellen über `users.mail_token`). So wird ein Schwung aus der Sync-App nicht zu einer Flut. Lokal ohne `SMTP_HOST` stehen die Mails im Log.
- Rückmeldungen (`lib/reviews.ts`, Tabelle `reviews`): „Fertig mit V4“ schließt den Durchgang einer Person, also ihre Kommentare zur Version seit ihrer letzten Rückmeldung, höchstens der letzten `REVIEW_PASS_HOURS`. Wer hochgeladen hat, bekommt dazu einen Push oder ohne Push eine Mail (gleiches Abbestellen wie bei den Versions-Mails). Vergisst jemand „Fertig“, schreibt dasselbe Intervall in der API nach `REVIEW_QUIET_MINUTES` eine Rückmeldung ohne Urteil (`verdict` null) und schickt sie, unter einem Advisory-Lock. Freigeben und Ablehnen über die alten Routen sind auch Rückmeldungen; der Ablehnungsgrund steht in deren `note`.
- Für Agenten lesbar (README, „Für Agenten“): Startseite, Datenschutz und Impressum stehen als Markdown in `publicPages` (`apps/api/src/lib/public-pages.ts`), daraus entstehen `/llms.txt`, `/llms-full.txt` und `<seite>.md`. Ändert sich der Text einer dieser Seiten, im selben Zug dort nachziehen, der Browser-Test vergleicht nur die Überschriften. Hinein kommt nur, was jeder ohne Login sieht, nichts aus Projekten, offenen Tracks oder Profilen.
- Das Repo ist öffentlich, auch seine CI-Logs. `secrets.yml` scannt jeden Push und PR mit gitleaks (README, „Secret-Scan“). Fehlalarme eng abfangen, per Fingerprint in `.gitleaksignore` oder per Pfad und Regel in `.gitleaks.toml`, nie eine Regel ganz abschalten. Ein echter Fund ist schon öffentlich: das Secret sofort rotieren.
- Die WAV-Dateien im Bucket `music-hub` haben keine zweite Kopie.
- Registrieren geht nur, solange es weniger als `MAX_USERS` Konten gibt (`apps/api/src/lib/users.ts`, wegen des geteilten S3-Speichers). Eingeladene zählen mit, kommen aber immer rein.
- Offene Tracks (`lib/open.ts`, öffentlich unter `/offen`): Ein Remix übernimmt die Spuren mit denselben S3-Keys (`stems.forked`), sie zählen nicht zum Speicher. Dateien löscht nur `deleteUnusedFiles`, das noch genutzte Keys stehen lässt. Öffentlich sind nur Spuren, die vor `open_tracks.opened_at` hochgeladen wurden.
- Profile (`lib/profiles.ts`, öffentlich unter `/@handle`, Route `[handle=handle]`): Ein Chat ist bewusst nicht vorgesehen. Eine Anfrage ist eine einzelne Nachricht. Annehmen legt ein gemeinsames Projekt an oder lädt in eins ein. Ablehnen ist still und sperrt neue Anfragen derselben Person für 30 Tage, Blockieren für immer. Ein Profil zeigt nur offene Tracks, an denen die Person mitgearbeitet hat (offen gestellt, Mix oder eigene Spur hochgeladen).
- Spuren haben Fassungen (`lib/stems.ts`): Die Zeile in `stems` hält immer die aktuelle Datei, frühere liegen in `stem_revisions` und zählen zum Speicher dessen, der sie hochgeladen hat. Wer Speicher zählt oder Dateien löscht, muss `stem_revisions` mitnehmen. Solange ein Track offen ist, lassen sich seine Spuren nicht ersetzen.
- Upload-Link (`routes/upload-links.ts`, öffentlich unter `/upload/<token>`): Gäste ohne Konto legen Songs und Spuren an. Beides gehört in der DB dem Ersteller des Links (`created_by_id`) und zählt zu seinem Speicher, den Gast nennt nur `stems.guest_name`. Der Link gilt nur, solange der Ersteller im Projekt hochladen darf, Gäste in seinem Konto zulässt (`users.guest_uploads`) und das Projekt nicht archiviert ist. Was Gäste belegen dürfen, begrenzt `users.guest_storage_limit` (Standard `GUEST_STORAGE_DEFAULT`), gezählt über `guest_name` in `stems` und `stem_revisions`. Notizen der Gäste stehen in `guest_notes` beim Song.
- Track-Status: `sketch` heißt in der Oberfläche „Demo“. `in_progress` („In Arbeit“) stammt von vor den Produktionsphasen und wird nur noch angeboten, solange ein Track ihn hat. Neue Status kennt eine ältere, noch offene Web-Version nicht.
- `test@onboarding.invalid` ist der Test-Account für das Onboarding und zählt nicht gegen `MAX_USERS`. „Als neue Person testen“ im Lagebild setzt ihn zurück (`lib/test-account.ts`, löscht seine Projekte samt Dateien) und kopiert einen Login-Link fürs private Fenster.

## Konventionen

- Ein Push ist nur ein Signal: Ereignistyp und Objekt-ID oder Cursor, keine Inhalte und keine personenbezogenen Daten, wegen des Datenschutzes (Grundsätze 1 und 2). Die App holt die Daten über einen Endpunkt hinter `requireAuth` ab ihrem letzten Cursor (`since`) und fragt ihn auch beim Öffnen und regelmäßig ab, so schaden verlorene oder doppelte Pushes nicht. Die SSE-Events (`services/sse.ts`) folgen dem schon. Die Web-Pushes (`services/push.ts`) tragen noch Titel und Text der Benachrichtigung mit Namen von Personen und Tracks; ob sie auf Signal plus Abruf im Service Worker umgestellt werden, entscheidet Robin (Backlog).

## Abweichungen vom Standard

- Die Health-Route der API heißt `/api/v1/health` statt `/api/health`, umbenennen verbietet die Rückwärtskompatibilität. Der Deploy-Job prüft dort die `revision`.
- Der Papierkorb-Purge läuft im Worker per `setInterval` statt über eine Zeitplan-Tabelle: Er ist idempotent, ein doppelter Lauf findet nichts mehr, ein verpasster holt beim nächsten nach.
- Link-Vorschau nach dem starter (AGENTS.md, „Link-Vorschau“), aber nur auf Deutsch: ein Bild `static/og-image.png`. Nach Änderung von Claim, `APP_BAND` oder Kachel (`static/favicon.svg`) mit `bun run og-image` in `apps/web` neu rendern und committen.

## Rückwärtskompatibilität

Gilt für Daten, API und URLs. Interner Code darf weiterhin direkt umgebaut werden.

- Jedes Update muss mit den bestehenden Daten und mit bereits ausgelieferten Clients funktionieren. Web und API deployen getrennt, und der Service Worker hält alte Web-Versionen eine Weile am Leben.
- Migrationen nur additiv (expand/contract): kein `DROP`, kein Umbenennen, keine engeren Typen, keine neue `NOT NULL`-Spalte ohne Default. Alte Spalten erst entfernen, wenn kein deployter Code sie mehr nutzt, und nur nach Rückfrage.
- Migrationen laufen beim API-Start automatisch. Sie dürfen bestehende Daten nie löschen oder verlustbehaftet umschreiben.
- API: Endpunkte und Felder nur hinzufügen, nichts entfernen oder umbenennen. Neue Request-Felder sind optional und haben einen Default.
- Hochgeladene Dateien (S3): Bestehende Keys bleiben gültig. Ein Update löscht oder verschiebt keine Objekte.
- Bestehende URLs (Share-Links, Projekt- und Track-Seiten) bleiben erreichbar.
- Secrets, an denen Daten hängen, bleiben unverändert: `MAGIC_LINK_SECRET` (Sessions), VAPID-Keys (Push-Abos), S3-Bucket.
