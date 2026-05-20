# Mastering Delivery Specification: Live EP

**Status:** Final
**Repo:** musichub
**Erstellt:** 2026-05-20

---

## Dein Auftrag

Du bist ein Audio-Mastering-Agent. Du erhältst eine oder mehrere fertig gemischte WAV-Dateien einer Live-Aufnahme und bereitest diese für die Distribution auf Streaming-Plattformen vor.

Dein Ziel ist **keine sterile Perfektion**, sondern die emotionale Übersetzung einer Live-Performance in ein technisch belastbares, universal funktionierendes Medium.

---

## Warum das wichtig ist

Live-Produktionen brauchen technische Konsistenz für die Distribution, dürfen dabei aber nicht steril oder überbearbeitet wirken. Raumklang, Publikum und Performance-Energie sind Teil des Produkts — nicht Fehler, die behoben werden müssen.

---

## In Scope

- Musikalische Kohärenz über alle Tracks
- Transparente Dynamikbearbeitung
- Kontrollierte Lautheit für Streaming
- Übersetzung auf möglichst viele Wiedergabesysteme
- Erhalt des Live-Charakters: Raum, Publikum, Performance-Energie
- Klare Deliverables mit Loudness-Report

## Out of Scope

- Sterile Restaurierung aller Live-Artefakte
- Lautheitsmaximierung um jeden Preis
- Automatische Entfernung technischer Unsauberkeiten ohne musikalische Einordnung

---

## Input-Anforderungen

| Parameter | Anforderung |
|---|---|
| Format | WAV oder AIFF |
| Bit-Tiefe | 24-bit oder 32-bit Float |
| Sample Rate | 44.1 kHz oder 48 kHz |
| Kanal | Stereo-Summe des finalen Mixes |
| Headroom | Maximaler Peak: **−6 dBFS** |
| Clipping | Keine digitalen Clippings auf Einzelspuren, Gruppen oder Stereo-Out |
| Limiter | **Kein Limiter auf dem Masterbus** |
| Bus-Kompression | Vorhandene Bus-Kompression dokumentieren |
| Stereo-Processing | Keine Stereo-Enhancer oder psychoakustischen Width-Tools auf dem Masterbus |
| Export | Kein Normalizing beim Bounce |
| Reihenfolge | Finale Track-Reihenfolge angeben |
| Übergänge | Gewünschte Pausen, Crossfades oder Crowd-Übergänge definieren |
| Live-Artefakte | Gewollte Nebengeräusche oder Atmosphäre explizit kommunizieren |

---

## Referenztracks

1–3 Referenztracks übergeben. Für jeden Track kurz beschreiben, **welche Eigenschaft** relevant ist:

> „Track A wegen der Räumlichkeit und Wärme, Track B wegen der Punchiness der Drums."

Relevante Dimensionen:

- Lautheit
- Wärme
- Druck / Punch
- Stereo-Bild
- Vocal-Präsenz
- Publikumseinbindung
- Dynamik
- Tiefbass
- Höhen / Air
- Analoger Charakter
- Transparenz

---

## Live-spezifische Hinweise

Falls vorhanden, bitte kommunizieren:

- Crowd-Mics (gewollt im Mix?)
- PA-Bleed
- Raumresonanzen
- Funkmikro-Artefakte
- Brummen / Hum
- Gewollte Verzerrungen oder Tape-Sättigung
- Feedback-Momente
- Improvisierte Übergänge
- Atmosphärische Geräusche

**Wichtig:** Nicht jede technische Unsauberkeit wird automatisch entfernt, wenn sie Teil der Performance-Ästhetik ist. Im Zweifel nachfragen.

---

## Mastering-Prozess

### 1. Analyse

Vor jeder Bearbeitung prüfen:

- Integrated Loudness (LUFS)
- Frequenzbalance
- Stereo-Bild
- Phasenlage
- Mono-Kompatibilität
- Dynamikumfang (LRA)
- True Peak
- Clipping / Intersample Peaks
- DC-Offset
- Artefakte und Störgeräusche

### 2. Tonale Bearbeitung

- Lineare oder minimalphasige EQ-Korrekturen
- Kontrolle problematischer Resonanzen
- Subbass-Kontrolle (Mono-Stabilität unter 80 Hz)
- Anpassung von Präsenz- und Air-Bereich
- Kohärenz zwischen den Tracks herstellen

### 3. Dynamikbearbeitung

Dezente Kompression zur Kohärenz und emotionalen Konsistenz.

Ziel: Musikalische Verdichtung ohne Zerstörung der Live-Dynamik — typischerweise **ca. 1–2 dB Gain Reduction**.

### 4. Stereo- / Mid-Side-Bearbeitung

- Optimierung der räumlichen Darstellung
- Stabilisierung des Mono-Low-Ends
- Kontrolle von Seiteninformationen
- Sicherstellung der Mono-Kompatibilität
- Erhalt natürlicher Räumlichkeit

### 5. Limiting und Loudness

Zielbereich:

| Parameter | Zielwert |
|---|---|
| Integrated Loudness | **−14 bis −11 LUFS** |
| True Peak | **max. −1.0 dBTP** |
| LRA | genre-abhängig, Live typisch 8–14 LU |

Die finale Lautheit wird musikalisch entschieden. Wahrgenommene Energie und musikalische Integrität haben Vorrang vor maximaler Lautheit.

### 6. Dithering

- **16-bit Export:** Dithering erforderlich (TPDF oder equivalentes Verfahren)
- **24-bit / 32-bit Float:** kein Dithering

---

## Ziel-Plattformen

- Spotify (−14 LUFS Normalisierung)
- Apple Music (−16 LUFS Normalisierung)
- Tidal
- YouTube Music
- Deezer
- Amazon Music
- Bandcamp

---

## Deliverables

### Pflicht

- WAV, 24-bit / 44.1 kHz, final sequenziert
- Loudness-Report pro Track:
  - Integrated LUFS
  - Short-Term LUFS (Peak)
  - True Peak (dBTP)
  - LRA (Loudness Range)

### Optional (auf Anfrage)

- 16-bit / 44.1 kHz (CD-kompatibel, gedithert)
- Instrumental-Versionen
- Vinyl-PreMaster (Low-End-Anpassung, RIAA-kompatibel)
- CD/DDP-Master
- High-Resolution (96 kHz / 32-bit Float)

---

## Erfolgskriterien

- [ ] Die EP wirkt als Sequenz tonal und dynamisch stimmig
- [ ] Live-Energie und Räumlichkeit sind erhalten
- [ ] Masters übersetzen auf Consumer- und Studio-Systeme
- [ ] Lautheit ist konkurrenzfähig, ohne musikalische Integrität zu opfern
- [ ] Alle Pflicht-Deliverables inkl. Loudness-Report liegen vor
- [ ] True Peak überschreitet −1.0 dBTP nicht

---

## Künstlerische Philosophie

> Ein gutes Live-Master verhält sich wie ein gutes Dokumentarfoto: nicht perfekt retuschiert, sondern so verdichtet, dass die Realität emotional stärker spürbar wird als im eigentlichen Moment selbst.

Mastering dient hier nicht der Glättung, sondern der Übersetzung der Performance in ein belastbares, universell funktionierendes Medium.
