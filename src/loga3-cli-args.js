const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_CONVERTER_URL = process.env.LOGA3_CONVERTER_URL || 'http://127.0.0.1:3847/#calendar';

function parsePeriodToken(token) {
    const value = String(token).trim();
    if (!value) return null;

    // YYYY-MM
    let match = value.match(/^(\d{4})-(\d{1,2})$/);
    if (match) {
        return { year: Number(match[1]), month: Number(match[2]) };
    }

    // MM/YYYY or M/YYYY
    match = value.match(/^(\d{1,2})\/(\d{4})$/);
    if (match) {
        return { month: Number(match[1]), year: Number(match[2]) };
    }

    return null;
}

function parseMonthsList(value) {
    return String(value)
        .split(/[,;\s]+/)
        .map(parsePeriodToken)
        .filter(Boolean);
}

/**
 * Parse CLI flags used by `loga3 fetch` / loga3-complete.
 * Returns { targets, outDir, openFolder, openConverter, once, converterUrl, help }.
 */
function parseCliOptions(argv, env = process.env) {
    const options = {
        targets: [],
        outDir: null,
        openFolder: false,
        openConverter: false,
        once: false,
        converterUrl: env.LOGA3_CONVERTER_URL || DEFAULT_CONVERTER_URL,
        help: false,
        command: null,
    };

    let lastMonths = null;
    let nextMonths = null;
    const explicit = [];

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];

        if (arg === 'fetch' || arg === 'help' || arg === '--help' || arg === '-h') {
            if (arg === 'fetch') options.command = 'fetch';
            if (arg === 'help' || arg === '--help' || arg === '-h') options.help = true;
            continue;
        }

        if (arg === '--once') {
            options.once = true;
            continue;
        }

        if (arg === '--open-folder') {
            options.openFolder = true;
            continue;
        }

        if (arg === '--open-converter') {
            options.openConverter = true;
            continue;
        }

        if (arg === '--out' && argv[index + 1]) {
            options.outDir = path.resolve(argv[++index]);
            continue;
        }

        if ((arg === '--months' || arg === '--month-list') && argv[index + 1]) {
            explicit.push(...parseMonthsList(argv[++index]));
            continue;
        }

        if (arg === '--month' && argv[index + 1] && argv[index + 2] === '--year' && argv[index + 3]) {
            explicit.push({
                month: Number(argv[index + 1]),
                year: Number(argv[index + 3]),
            });
            index += 3;
            continue;
        }

        if (arg === '--period' && argv[index + 1]) {
            const parsed = parsePeriodToken(argv[++index]);
            if (parsed) explicit.push(parsed);
            continue;
        }

        if (arg === '--last' && argv[index + 1]) {
            lastMonths = Number(argv[++index]);
            continue;
        }

        if (arg === '--next' && argv[index + 1]) {
            nextMonths = Number(argv[++index]);
            continue;
        }

        if (arg === '--converter-url' && argv[index + 1]) {
            options.converterUrl = argv[++index];
        }
    }

    if (lastMonths) {
        const { getLastNMonths } = require('./loga3-inventory');
        options.targets = normalizeTargets(getLastNMonths(lastMonths));
    } else if (nextMonths) {
        const { getNextNMonths } = require('./loga3-inventory');
        options.targets = normalizeTargets(getNextNMonths(nextMonths));
    } else if (explicit.length) {
        options.targets = normalizeTargets(explicit);
    } else if (env.LOGA3_LAST_MONTHS) {
        const { getLastNMonths } = require('./loga3-inventory');
        options.targets = normalizeTargets(getLastNMonths(env.LOGA3_LAST_MONTHS));
    } else if (env.LOGA3_NEXT_MONTHS) {
        const { getNextNMonths } = require('./loga3-inventory');
        options.targets = normalizeTargets(getNextNMonths(env.LOGA3_NEXT_MONTHS));
    } else if (env.LOGA3_TARGETS) {
        try {
            const parsed = JSON.parse(env.LOGA3_TARGETS);
            options.targets = normalizeTargets(Array.isArray(parsed) ? parsed : []);
        } catch (error) {
            console.error('❌ Could not read LOGA3_TARGETS:', error.message);
            options.targets = [];
        }
    } else {
        options.targets = normalizeTargets([]);
    }

    if (!options.outDir && env.LOGA3_DOWNLOADS_DIR) {
        options.outDir = path.resolve(env.LOGA3_DOWNLOADS_DIR);
    }

    return options;
}

/** @deprecated use parseCliOptions — kept for existing callers */
function parseTargets(argv, env = process.env) {
    return parseCliOptions(argv, env).targets;
}

function normalizeTargets(entries) {
    return entries
        .map((entry) => ({
            month: Number(entry.month),
            year: Number(entry.year),
        }))
        .filter((entry) => entry.month >= 1 && entry.month <= 12 && entry.year > 2000)
        .sort((left, right) => left.year - right.year || left.month - right.month);
}

function applyOutDir(outDir) {
    if (!outDir) return null;
    const resolved = path.resolve(outDir);
    fs.mkdirSync(resolved, { recursive: true });
    process.env.LOGA3_DOWNLOADS_DIR = resolved;
    return resolved;
}

function openPath(targetPath) {
    const opener = process.platform === 'win32'
        ? 'cmd'
        : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32'
        ? ['/c', 'start', '', targetPath]
        : [targetPath];
    try {
        spawn(opener, args, { detached: true, stdio: 'ignore' }).unref();
        return true;
    } catch {
        return false;
    }
}

function printFetchHelp() {
    console.log(`loga3 fetch — download Zeitprotokoll PDFs for the Convert tab

Usage:
  loga3 fetch --months 2026-05,2026-06 --out ./pdfs
  loga3 fetch --last 3 --out ./pdfs --open-folder
  loga3 fetch --months 2026-05 --out ./pdfs --open-converter

Options:
  --months LIST     Comma-separated YYYY-MM (or MM/YYYY)
  --last N          Last N calendar months (incl. current)
  --next N          Next N months after current
  --period YYYY-MM  Single month (repeatable via multiple flags)
  --out DIR         Output folder (sets LOGA3_DOWNLOADS_DIR)
  --open-folder     Open the output folder after download
  --open-converter  Open local Convert tab (GUI must be running)
  --converter-url   Override URL (default: ${DEFAULT_CONVERTER_URL})
  --once            Exit when done (implied by fetch)

Workflow:
  1) PDFs land in --out (or ./downloads)
  2) GUI „In den Kalender“ (or --open-converter → ${DEFAULT_CONVERTER_URL})
`);
}

module.exports = {
    DEFAULT_CONVERTER_URL,
    parsePeriodToken,
    parseMonthsList,
    parseCliOptions,
    parseTargets,
    normalizeTargets,
    applyOutDir,
    openPath,
    printFetchHelp,
};
