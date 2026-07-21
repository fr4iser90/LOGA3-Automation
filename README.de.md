# LOGA3 Zeitprotokolle

All-in-one Desktop-App: Zeitprotokoll-PDFs aus LOGA3 **holen** → Schichten **umwandeln** → **`.ics`** oder **Google Kalender**.

Endnutzer brauchen **kein** `.env`: Zugang in der GUI speichern.

[English](README.md)

## Downloads

Desktop-Pakete (inkl. Chromium — große Dateien):

[![Latest](https://img.shields.io/github/v/release/fr4iser90/LOGA3-Automation?label=latest)](https://github.com/fr4iser90/LOGA3-Automation/releases/latest)
[![Windows](https://img.shields.io/badge/download-Windows-0078D4?logo=windows&logoColor=white)](https://github.com/fr4iser90/LOGA3-Automation/releases/latest/download/loga3-win-x64.zip)
[![Linux](https://img.shields.io/badge/download-Linux%20.tar.gz-FCC624?logo=linux&logoColor=black)](https://github.com/fr4iser90/LOGA3-Automation/releases/latest/download/loga3-linux-x64.tar.gz)
[![AppImage](https://img.shields.io/badge/download-AppImage-2CA5E0?logo=linux&logoColor=white)](https://github.com/fr4iser90/LOGA3-Automation/releases/latest)

| Plattform | Datei |
|-----------|--------|
| Windows | [`loga3-win-x64.zip`](https://github.com/fr4iser90/LOGA3-Automation/releases/latest/download/loga3-win-x64.zip) — entpacken, `Loga3.exe` starten |
| Linux | [`loga3-linux-x64.tar.gz`](https://github.com/fr4iser90/LOGA3-Automation/releases/latest/download/loga3-linux-x64.tar.gz) |
| Linux AppImage | unter [Latest Release](https://github.com/fr4iser90/LOGA3-Automation/releases/latest) (`Loga3-*-x86_64.AppImage`) |

Nur PDFs (ohne LOGA3-Login): [shift.fr4iser.com](https://shift.fr4iser.com).

Android / iOS (eigenes Repo, volle App am Gerät wie Desktop — WebView-Fetch): [LOGA3-Automation-Mobile](https://github.com/fr4iser90/LOGA3-Automation-Mobile) — siehe [docs/MOBILE.md](docs/MOBILE.md).

## Schnellstart

### Desktop / lokal

1. App starten (`Loga3.exe` / AppImage) oder:
   ```bash
   npm install && npx playwright install chromium
   npm run gui
   ```
2. Browser: http://127.0.0.1:3847
3. Monate wählen → **Ausgewählte laden** — Umwandlung läuft automatisch
4. **`.ics`** exportieren oder **Google Kalender** verbinden

Zugangsdaten: lokal in `data/loga3-settings.json` (AppImage: `loga3-data/` neben der Datei). Der Converter sieht keine LOGA3-Zugangsdaten.

### Docker

```bash
docker compose up -d --build
```

http://localhost:3847 — Login in der GUI. PDFs → `downloads/`, Settings → `data/`.

```bash
docker compose logs -f
docker compose down
```

### CLI (Entwickler)

```bash
npx loga3 fetch --months 2026-05,2026-06 --out ./pdfs
npx loga3 fetch --last 3 --out ./pdfs --open-folder --open-converter

npm run download:last3
npm run download:next3
```

`--open-converter` öffnet den Kalender-Bereich (`http://127.0.0.1:3847/#calendar`).

Optional statt GUI: `cp .env.example .env` und `LOGA3_BASE_URL` / `LOGA3_USERNAME` / `LOGA3_PASSWORD` setzen.

## npm-Scripts

| Script | Zweck |
|--------|--------|
| `gui` | Web-UI (Port 3847) — Holen → Kalender |
| `fetch` | `loga3 fetch` — Monate + `--out` |
| `download` / `download:lastN` / `download:nextN` | PDFs laden |
| `debug:content` | Monate navigieren ohne Export |
| `test` | Unit-Tests |
| `package:linux` / `package:win` | Desktop-Pakete bauen |

## Projektstruktur

```
Loga3/
  src/          App-Kern
  gui/          Web-UI (ein Ablauf)
  converter/    PDF → Schichten → ICS / Google
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
