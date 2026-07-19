# LOGA3 Zeitprotokolle

Lädt Zeitprotokoll-PDFs aus LOGA3 über eine lokale Web-Oberfläche.

Endnutzer brauchen **kein** `.env`: Zugang in der GUI speichern.

[English](README.md)

## Schnellstart

### Desktop / lokal

1. App starten (`Loga3.exe` / AppImage) oder:
   ```bash
   npm install && npx playwright install chromium
   npm run gui
   ```
2. Browser: http://127.0.0.1:3847
3. Benutzername + Passwort → **Speichern**
4. Monate wählen → **Ausgewählte laden**

Zugangsdaten: lokal in `data/loga3-settings.json` (AppImage: `loga3-data/` neben der Datei).

### Docker

```bash
docker compose up -d --build
```

http://localhost:3847 — Login in der GUI. PDFs → `downloads/`, Settings → `data/`.

```bash
docker compose logs -f
docker compose down
```

### CLI (Entwickler / ShiftPlanConverter)

```bash
npx loga3 fetch --months 2026-05,2026-06 --out ./pdfs
npx loga3 fetch --last 3 --out ./pdfs --open-folder --open-converter

npm run download:last3
npm run download:next3
```

Ablauf: **Loga3 holt PDFs** → in [ShiftPlanConverter](https://shift.fr4iser.com) öffnen (oder `--open-converter`). Der Converter sieht keine LOGA3-Zugangsdaten.

Optional statt GUI: `cp .env.example .env` und `LOGA3_USERNAME` / `LOGA3_PASSWORD` setzen.

## npm-Scripts

| Script | Zweck |
|--------|--------|
| `gui` | Web-UI (Port 3847) |
| `fetch` | `loga3 fetch` — Monate + `--out` für Converter-Übergabe |
| `download` / `download:lastN` / `download:nextN` | PDFs laden |
| `debug:content` | Monate navigieren ohne Export |
| `test` | Unit-Tests |
| `package:linux` / `package:win` | Desktop-Pakete bauen |

## Projektstruktur

```
Loga3/
  src/          App-Kern
  gui/          Web-UI
  docker/       Dockerfile + compose
  scripts/      Desktop-Packaging
  test/         Tests
  probes/       optionale Debug-Skripte
  downloads/    PDFs
  logs/         Screenshots / Debug
  data/         GUI-Einstellungen (gitignored)
```

## Secrets

Nicht committen: `.env`, `data/`, `loga3-config.js`, PDFs, `logs/`.

Login-Reihenfolge: **Env → GUI-Settings → optionale Config-Datei**.

GUI standardmäßig auf `127.0.0.1`. Vor Netz-Freigabe Auth vorsehen.

## CI

| Workflow | Wann | Was |
|----------|------|-----|
| `ci.yml` | PR / push `main` | Tests + Docker-Build |
| `docker-publish.yml` | `main` / Tags `v*` | Image → GHCR |
| `desktop.yml` | PR / push / Tags `v*` | AppImage + Windows-Zip; bei Tags Release |

Desktop-Pakete sind groß (Chromium). Server: Docker bevorzugen.

## Troubleshooting

- **Login fehlgeschlagen** — Zugangsdaten in Einstellungen prüfen; bei 2FA im Browser bestätigen; Screenshots in `logs/`
- **Browser startet nicht** — `npx playwright install chromium`
- **GUI-Port belegt** — `npm run gui:stop`
