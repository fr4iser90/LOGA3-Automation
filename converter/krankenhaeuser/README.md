# Krankenhaus-Packs & User-Mappings

## Builtin

Unter `krankenhaeuser/<id>/`:

```
krankenhaeuser/mein-kh/
  config.json      # name, groups[], areas[] mit mapping-Pfaden
  parser.js        # export function parse...(text) → { year, month, mainEntries, … }
  mappings/...
```

## Pack installieren (ohne neue .exe)

1. Ordner wie oben als **ZIP** packen (eine Root-Ebene mit `config.json`).
2. In der App: **Einstellungen → Krankenhaus-Packs → Pack (.zip) installieren**.
3. Pack landet unter `data/packs/<id>/` (bzw. portable Root) und erscheint im Krankenhaus-Dropdown.

Optional in `config.json`: `"id": "mein-kh"` (sonst Ordnername).

## User-Mapping

Wenn Zeiten im Plan fehlen:

1. Nach dem Umwandeln Codes neben den unbekannten Zeiten eintragen.
2. **User-Mapping speichern** → Overlay unter `data/user-mappings/`.
3. Gilt nur für das gewählte Krankenhaus + Berufsgruppe + Bereich; Basis-Mapping bleibt unangetastet.

## Pull Request

Weiterhin willkommen: neue Builtin-Ordner per PR.
