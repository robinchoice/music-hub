# Spec: Listen Analytics

**Ziel:** Label-Manager und Produzenten sehen wer, wann und wie viel von einem geteilten Track gehört hat.

**Pitch:** "Schick einen Link. Kein Account nötig. Du siehst wer wann gehört hat."

---

## Was gebaut wird

### 1. DB — `listen_events`

| Feld | Typ | Beschreibung |
|---|---|---|
| `id` | uuid PK | — |
| `share_link_id` | uuid FK → share_links | Welcher Link |
| `listener_name` | varchar(255) nullable | Optional eingegeben |
| `ip_hash` | varchar(64) | SHA256(IP) — Dedup ohne PII |
| `user_agent` | text nullable | Browser-Info |
| `opened_at` | timestamp | Seite geladen |
| `first_play_at` | timestamp nullable | Erster Play-Klick |
| `listen_seconds` | integer default 0 | Kumulierte Hörzeit |
| `completed` | boolean default false | >80% des Tracks gehört |

### 2. API

| Route | Auth | Beschreibung |
|---|---|---|
| `POST /share/public/:token/listen` | — | Event anlegen, gibt `eventId` zurück |
| `PATCH /share/public/:token/listen/:eventId` | — | Name/Fortschritt/Abschluss updaten |
| `GET /share/version/:versionId/analytics` | requireAuth | Aggregierte Analytics |

### 3. Listen-Seite (Frontend)

- Soft Name-Prompt bei erstem Laden: "Wie heißt du?" — überspringbar, gespeichert in localStorage
- `onMount` → POST /listen → eventId in State
- `onFirstPlay` → PATCH mit `firstPlayAt`
- Alle 30s während Play → PATCH mit aktuellem `listenSeconds`
- `beforeunload` → `navigator.sendBeacon` mit finalem `listenSeconds` + `completed`

### 4. Analytics-Panel (Track-Seite)

Neuer "Analytik"-Button in der Track-Toolbar. Öffnet Modal mit:

- Zähler: Geöffnet / Gespielt / Ø Hörzeit / Abschlussrate
- Tabelle: Name (oder "Anonym") · Datum · Hörzeit · Abgeschlossen ✓

---

## Out of scope (jetzt)

- E-Mail-Alerts wenn jemand hört
- Heatmap welcher Teil des Tracks gehört wurde
- Link-spezifische vs. versions-aggregierte Ansicht (immer version-aggregiert)
