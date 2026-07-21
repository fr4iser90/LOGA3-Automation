# Arbeitgeber-Packs (GitHub)

**P&I LOGA / LOGA3** wird nicht nur in Kliniken genutzt, sondern u. a. auch in:

- **Gesundheits- und Sozialwesen** (Krankenhäuser, Pflege, …)
- **Öffentlicher Dienst / Kommunen** (Städte, Landkreise, Verwaltungen)
- **Privatwirtschaft** (Dienstleistung und andere Branchen)

Packs hier = **weitere Arbeitgeber / Einrichtungen** (oder Mapping-Hotfixes), nicht nur Kliniken.

St. Elisabeth · Anästhesie ist **builtin** (kommt mit der App).

## Manifest

`packs/manifest.json` listet verfügbare Packs. Die App kann den Katalog laden und ZIPs installieren.

Beispiel-Eintrag:

```json
{
  "id": "anderer-arbeitgeber",
  "name": "Anderer Arbeitgeber",
  "version": "1.0.0",
  "description": "Bereich X / Schichtplan-Mapping",
  "zipUrl": "https://github.com/fr4iser90/LOGA3-Automation/releases/download/packs-v1/anderer-arbeitgeber.zip"
}
```

## ZIP-Inhalt

```
anderer-arbeitgeber/
  config.json
  parser.js          # optional
  mappings/...
```

## Workflow

1. Pack lokal bauen und als Release-Asset hochladen (oder ZIP-URL setzen)
2. `manifest.json` aktualisieren und pushen
3. In der App: **Einstellungen → Packs von GitHub laden → Installieren**
