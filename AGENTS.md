# Music Hub

## Zweck & Links

- Läuft produktiv auf https://hub.pleasance.org, https://hub.diespaetzles.lol bleibt parallel erreichbar. Stabilität, Sicherheit und Datenerhalt gehen vor neuen Features.
- Coolify auf VPS 1, Projekt `pleasance-musichub`, getrennte Anwendungen für API und Web.
- Das DAW-Plugin `robinchoice/musichub-plugin` spricht dieselbe API. Ausgelieferte Plugin-Versionen müssen nach jedem Update weiter funktionieren, siehe Rückwärtskompatibilität.

## Checks

`bun run check && bun --bun run build`, keine neuen Fehler. Tests gibt es nicht.

## Deploy

- Jeder Push auf `main` geht sofort live: Die CI prüft, baut die Images und deployt erst die API, dann das Web über die Coolify-API. Auf VPS 1 wird nicht gebaut.
- Prüfen: `gh run watch`, dann `curl -s https://hub.pleasance.org/api/v1/health`.
- Destruktive Aktionen (Daten oder Volumes löschen, manuelle Änderungen an der Prod-DB) nur nach ausdrücklicher Freigabe.

## Fallen

- Die Landingpage zeigt die echte Track-Seite im Demo-Modus und ihre Komponenten mit Beispieldaten (`apps/web/src/lib/demo`). Nutzt eine Seite einen neuen API-Endpunkt, braucht `backend.ts` dafür eine Antwort, sonst meldet die Demo „In der Demo nicht verfügbar“.
- Die WAV-Dateien im Bucket `music-hub` haben keine zweite Kopie.

## Rückwärtskompatibilität

Gilt für Daten, API und URLs. Interner Code darf weiterhin direkt umgebaut werden.

- Jedes Update muss mit den bestehenden Daten und mit bereits ausgelieferten Clients funktionieren. Web und API deployen getrennt, und der Service Worker hält alte Web-Versionen eine Weile am Leben.
- Migrationen nur additiv (expand/contract): kein `DROP`, kein Umbenennen, keine engeren Typen, keine neue `NOT NULL`-Spalte ohne Default. Alte Spalten erst entfernen, wenn kein deployter Code sie mehr nutzt, und nur nach Rückfrage.
- Migrationen laufen beim API-Start automatisch. Sie dürfen bestehende Daten nie löschen oder verlustbehaftet umschreiben.
- API: Endpunkte und Felder nur hinzufügen, nichts entfernen oder umbenennen. Neue Request-Felder sind optional und haben einen Default.
- Hochgeladene Dateien (S3): Bestehende Keys bleiben gültig. Ein Update löscht oder verschiebt keine Objekte.
- Bestehende URLs (Share-Links, Projekt- und Track-Seiten) bleiben erreichbar.
- Secrets, an denen Daten hängen, bleiben unverändert: `MAGIC_LINK_SECRET` (Sessions), VAPID-Keys (Push-Abos), S3-Bucket.
