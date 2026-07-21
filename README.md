# LOGA3 time sheets

All-in-one desktop app: **fetch** Zeitprotokoll PDFs from LOGA3 → **convert** to shifts → **export `.ics`** or **sync Google Calendar**.

End users do **not** need a `.env` file — save login credentials in the GUI.

[Deutsch](README.de.md)

## Downloads

Desktop packages (Chromium included — large files):

[![Latest](https://img.shields.io/github/v/release/fr4iser90/LOGA3-Automation?label=latest)](https://github.com/fr4iser90/LOGA3-Automation/releases/latest)
[![Windows](https://img.shields.io/badge/download-Windows-0078D4?logo=windows&logoColor=white)](https://github.com/fr4iser90/LOGA3-Automation/releases/latest/download/loga3-win-x64.zip)
[![Linux](https://img.shields.io/badge/download-Linux%20.tar.gz-FCC624?logo=linux&logoColor=black)](https://github.com/fr4iser90/LOGA3-Automation/releases/latest/download/loga3-linux-x64.tar.gz)
[![AppImage](https://img.shields.io/badge/download-AppImage-2CA5E0?logo=linux&logoColor=white)](https://github.com/fr4iser90/LOGA3-Automation/releases/latest)

| Platform | File |
|----------|------|
| Windows | [`loga3-win-x64.zip`](https://github.com/fr4iser90/LOGA3-Automation/releases/latest/download/loga3-win-x64.zip) — unzip, run `Loga3.exe` |
| Linux | [`loga3-linux-x64.tar.gz`](https://github.com/fr4iser90/LOGA3-Automation/releases/latest/download/loga3-linux-x64.tar.gz) |
| Linux AppImage | on the [latest release](https://github.com/fr4iser90/LOGA3-Automation/releases/latest) (`Loga3-*-x86_64.AppImage`) |

PDF-only (no LOGA3 login): [shift.fr4iser.com](https://shift.fr4iser.com).

## Quick start

### Desktop / local

1. Start the app (`Loga3.exe` / AppImage) or:
   ```bash
   npm install && npx playwright install chromium
   npm run gui
   ```
2. Open http://127.0.0.1:3847
3. Select months → **Download selected** — conversion runs automatically
4. Export **`.ics`** or connect **Google Calendar**

Credentials stay local in `data/loga3-settings.json` (AppImage: `loga3-data/` next to the file). The converter never sees LOGA3 credentials.

### Docker

```bash
docker compose up -d --build
```

Open http://localhost:3847 — log in via the GUI. PDFs → `downloads/`, settings → `data/`.

```bash
docker compose logs -f
docker compose down
```

### CLI (developers)

```bash
npx loga3 fetch --months 2026-05,2026-06 --out ./pdfs
npx loga3 fetch --last 3 --out ./pdfs --open-folder --open-converter

npm run download:last3
npm run download:next3
```

`--open-converter` opens the local calendar section (`http://127.0.0.1:3847/#calendar`).

Optional instead of the GUI: `cp .env.example .env` and set `LOGA3_USERNAME` / `LOGA3_PASSWORD`.

## npm scripts

| Script | Purpose |
|--------|---------|
| `gui` | Web UI (port 3847) — fetch → calendar |
| `fetch` | `loga3 fetch` — months + `--out` |
| `download` / `download:lastN` / `download:nextN` | Download PDFs |
| `debug:content` | Navigate months without export |
| `test` | Unit tests |
| `package:linux` / `package:win` | Build desktop packages |

## Layout

```
Loga3/
  src/          App core
  gui/          Web UI (single flow)
  converter/    PDF → shifts → ICS / Google (shared core)
  docker/       Dockerfile + compose
  scripts/      Desktop packaging
  test/         Tests
  probes/       Optional debug scripts
  downloads/    PDFs
  logs/         Screenshots / debug
  data/         GUI settings (gitignored)
```

## Secrets

Do not commit: `.env`, `data/`, `loga3-config.js`, PDFs, `logs/`.

Login priority: **env → GUI settings → optional config file**.

GUI binds to `127.0.0.1` by default. Add auth before exposing it on a network.

## CI

| Workflow | When | What |
|----------|------|------|
| `ci.yml` | PR / push `main` | Tests + Docker build |
| `docker-publish.yml` | `main` / tags `v*` | Image → GHCR |
| `desktop.yml` | PR / push / tags `v*` | AppImage + Windows zip; release on tags |

Desktop packages are large (Chromium). Prefer Docker for servers.

## Troubleshooting

- **Login failed** — check credentials in Settings; confirm 2FA in the browser; see screenshots in `logs/`
- **Browser won’t start** — `npx playwright install chromium`
- **GUI port in use** — `npm run gui:stop`
