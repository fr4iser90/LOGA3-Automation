# Converter-Core (aus ShiftPlanConverter)

Gemeinsame Logik für PDF → Schichten → ICS / Google-Sync.
Wird von der LOGA3-Desktop-GUI eingebunden; die Website kann denselben Ordner nutzen.

## Inhalt

```
converter/
  src/                 Kernmodule (ESM, Browser)
  krankenhäuser/       Parser + Schicht-Mappings
```

| Modul | Rolle |
|-------|--------|
| `convert.js` | Rohparser → fertige Einträge |
| `pdfText.js` | PDF.js → Text |
| `monthSummary.js` | AZK / Monatsübersicht |
| `icsGenerator.js` | `.ics`-Export |
| `google.js` | Google-Kalender-Sync |
| `shiftTypesLoader.js` | Config / Mappings / Parser laden |
| `preview.js` / `pdfLoader.js` | UI-Helfer (Vorschau, Drag&Drop) |

## Abhängigkeiten (zur Laufzeit)

- **PDF.js** (`window.pdfjsLib`) — für `pdfText.js`
- **Google Identity Services** — nur für Sync (`google.js`)

## Nutzung

```js
import {
  loadHospitalConfig,
  loadHospitalParser,
  loadMapping,
  extractTextFromPdfBuffer,
  parseTimeSheet,
  exportToICS,
} from './converter/src/index.js';
```

Krankenhaus-Assets werden über `import.meta.url` relativ zu `converter/` geladen — die HTML-Seite darf woanders liegen, solange `converter/` vom GUI-Server ausgeliefert wird.

## Nicht übernommen

Website-HTML, Docker/Nginx, Marketing-Assets, `main.js`-Orchestrierung (kommt in die LOGA3-GUI-Tabs).
