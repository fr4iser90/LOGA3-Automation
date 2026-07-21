# Krankenhaus-Packs (GitHub)

St. Elisabeth · Anästhesie ist **builtin** (kommt mit der App).

Dieser Ordner ist für **weitere Kliniken** oder **Hotfixes ohne neue .exe**.

## Manifest

`packs/manifest.json` listet verfügbare Packs. Die App kann den Katalog laden und ZIPs installieren.

Beispiel-Eintrag:

```json
{
  "id": "andere-klinik",
  "name": "Andere Klinik",
  "version": "1.0.0",
  "description": "Pflege Station X",
  "zipUrl": "https://github.com/fr4iser90/LOGA3-Automation/releases/download/packs-v1/andere-klinik.zip"
}
```

## ZIP-Inhalt

```
andere-klinik/
  config.json
  parser.js          # optional
  mappings/...
```

## Workflow

1. Pack lokal bauen und als Release-Asset hochladen (oder ZIP-URL setzen)
2. `manifest.json` aktualisieren und pushen
3. In der App: **Einstellungen → Packs von GitHub laden → Installieren**
