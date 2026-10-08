# Music Hub

## Zweck & Links

- Läuft produktiv auf https://hub.pleasance.org, https://hub.diespaetzles.lol bleibt parallel erreichbar. Stabilität, Sicherheit und Datenerhalt gehen vor neuen Features.
- Coolify auf VPS 1, Projekt `pleasance-musichub`, getrennte Anwendungen für API, Audio-Worker und Web.
- Das DAW-Plugin `robinchoice/musichub-plugin` spricht dieselbe API. Ausgelieferte Plugin-Versionen müssen nach jedem Update weiter funktionieren, siehe Rückwärtskompatibilität.

## Checks

`bun run check && bun run test && bun --bun run build`, keine neuen Fehler. Die Tests (`apps/api/src/*.test.ts`) laufen gegen `DATABASE_URL`, legen nur eigene Zeilen an und räumen sie wieder ab.

## Deploy

- Jeder Push auf `main` geht sofort live: Die CI prüft, baut die Images und deployt über die Coolify-API erst die API, dann den Worker, dann das Web. Auf VPS 1 wird nicht gebaut.
- Prüfen: `gh run watch`, dann `curl -s https://hub.pleasance.org/api/v1/health`.
- Destruktive Aktionen (Daten oder Volumes löschen, manuelle Änderungen an der Prod-DB) nur nach ausdrücklicher Freigabe.

## Fallen

- Die Landingpage zeigt die echte Track-Seite im Demo-Modus und ihre Komponenten mit Beispieldaten (`apps/web/src/lib/demo`). Nutzt eine Seite einen neuen API-Endpunkt, braucht `backend.ts` dafür eine Antwort, sonst meldet die Demo „In der Demo nicht verfügbar“.
- Die API ist zustandslos und darf mit mehreren Instanzen laufen. Nichts, was zwischen Anfragen gelten muss, gehört in den Speicher des Prozesses: Rate-Limits stehen in `rate_limits` (`lib/rate-limit.ts`), SSE-Events gehen per Postgres `NOTIFY` an alle Instanzen (`services/sse.ts`, Payload nur IDs, Grenze 8000 Bytes), Migrationen laufen unter einem Advisory-Lock (`migrateDb`).
- Audio verarbeitet nur der Worker (`apps/api/src/worker.ts`, Image `musichub-worker`, ein ffmpeg-Job gleichzeitig). Die API legt Jobs in `audio_jobs` an. Stirbt der Worker, holt er den Job nach Ablauf der Lease (5 Minuten) erneut ab, nach drei Versuchen wird die Version ohne MP3 und Wellenform `ready`. Lokal startet `bun run dev` API und Worker.
- Die WAV-Dateien im Bucket `music-hub` haben keine zweite Kopie.
- Registrieren geht nur, solange es weniger als `MAX_USERS` Konten gibt (`apps/api/src/lib/users.ts`, wegen des geteilten S3-Speichers). Eingeladene zählen mit, kommen aber immer rein.
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
