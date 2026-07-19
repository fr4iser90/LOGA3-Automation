# LOGA3 time sheets

Downloads Zeitprotokoll PDFs from LOGA3 through a local web UI.

End users do **not** need a `.env` file — save login credentials in the GUI.

[Deutsch](README.de.md)

## Quick start

### Desktop / local

1. Start the app (`Loga3.exe` / AppImage) or:
   ```bash
   npm install && npx playwright install chromium
   npm run gui
   ```
2. Open http://127.0.0.1:3847
3. Enter username + password → **Save**
4. Select months → **Download selected**

Credentials are stored locally in `data/loga3-settings.json` (AppImage: `loga3-data/` next to the file).

### Docker

```bash
docker compose up -d --build
```

Open http://localhost:3847 — log in via the GUI. PDFs → `downloads/`, settings → `data/`.

```bash
docker compose logs -f
docker compose down
```

### CLI (developers / ShiftPlanConverter handoff)

```bash
# Engine API for PDF → calendar converter
npx loga3 fetch --months 2026-05,2026-06 --out ./pdfs
npx loga3 fetch --last 3 --out ./pdfs --open-folder --open-converter

npm run download:last3
npm run download:next3
```

Flow: **Loga3 fetches PDFs** → drop them into [ShiftPlanConverter](https://shift.fr4iser.com) (or use `--open-converter`). Loga3 does not embed the converter; the converter never sees LOGA3 credentials.

Optional instead of the GUI: `cp .env.example .env` and set `LOGA3_USERNAME` / `LOGA3_PASSWORD`.

## npm scripts

| Script | Purpose |
|--------|---------|
| `gui` | Web UI (port 3847) |
| `fetch` | `loga3 fetch` — months + `--out` for converter handoff |
| `download` / `download:lastN` / `download:nextN` | Download PDFs |
| `debug:content` | Navigate months without export |
| `test` | Unit tests |
| `package:linux` / `package:win` | Build desktop packages |

## Layout

```
Loga3/
  src/          App core
  gui/          Web UI
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
