# Changelog

Alle wesentlichen Änderungen an LOGA3 Automation.

Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).
Versionierung: [SemVer](https://semver.org/lang/de/).

## [1.1.0] — 2026-07-21

### Hinzugefügt
- Linearer Flow: Monate laden → automatisch umwandeln → Kalender/ICS/Google-Sync
- Google-Kalender: eigener Schichtkalender empfohlen, Primary-Warnung, Kalender-Auswahl merken
- Preview: aktueller Monat/Woche/heute hervorgehoben, Auto-Scroll
- Support-Anfrage: anonymisierter PDF-Rohtext (mit echten Schichtzeiten) per Mail
- User-Mappings für fehlende Schichtzeiten speichern
- Arbeitgeber-Packs (ZIP lokal + Katalog von GitHub)
- Update-Prüfung: GitHub Release anzeigen, Download nur nach Zustimmung
- St. Elisabeth: nur freigeschaltet **Pflege · OP · Anästhesie**

### Geändert
- Sync bleibt wipe-in-range (Dokumentation/Hinweise klarer)
- Rich-Details optional in Event-Beschreibungen
- UI-Begriffe: „Arbeitgeber / Einrichtung“ statt nur „Krankenhaus“

### Sicherheit / Datenschutz
- Support-Mails ohne Roh-PDF; Namen/IDs anonymisiert; mailto-Länge begrenzt

## [1.0.0] — 2026-07-19

- Erste All-in-one Desktop-/GUI-Version (LOGA3-Fetch + Converter)
