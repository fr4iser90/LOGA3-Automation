# Arbeitgeber-Packs & User-Mappings

Ordnername `krankenhaeuser/` ist historisch — inhaltlich: **Arbeitgeber / Einrichtungen** mit LOGA3-Zeitprotokollen (Kliniken, Kommunen, Privatwirtschaft, …).

## Builtin

Unter `krankenhaeuser/<id>/`:

```
krankenhaeuser/mein-arbeitgeber/
  config.json      # name, groups[], areas[] mit mapping-Pfaden
  parser.js        # export function parse...(text) → { year, month, mainEntries, … }
  mappings/...
```

## Pack installieren (ohne neue .exe)

1. Ordner wie oben als **ZIP** packen (eine Root-Ebene mit `config.json`).
2. In der App: **Einstellungen → Arbeitgeber-Packs → Pack (.zip) installieren** (oder GitHub-Katalog).
3. Pack landet unter `data/packs/<id>/` und erscheint im Dropdown.

Optional in `config.json`: `"id": "mein-arbeitgeber"` (sonst Ordnername).

## User-Mapping

Wenn Zeiten im Plan fehlen:

1. Nach dem Umwandeln Codes neben den unbekannten Zeiten eintragen.
2. **User-Mapping speichern** → Overlay unter `data/user-mappings/`.
3. Gilt nur für den gewählten Arbeitgeber + Berufsgruppe + Bereich.

## Pull Request

Weiterhin willkommen: neue Builtin-Ordner per PR.
