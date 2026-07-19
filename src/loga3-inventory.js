const fs = require('fs');
const path = require('path');

/** Repo root (parent of src/) */
const PROJECT_ROOT = path.join(__dirname, '..');

const MONTH_NAMES = [
    'januar', 'februar', 'märz', 'april', 'mai', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'dezember'
];

const MONTH_LABELS = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

function getDownloadsDir() {
    if (process.env.LOGA3_DOWNLOADS_DIR) {
        return path.resolve(process.env.LOGA3_DOWNLOADS_DIR);
    }

    const projectDownloads = path.join(PROJECT_ROOT, 'downloads');
    if (!fs.existsSync(projectDownloads)) {
        fs.mkdirSync(projectDownloads, { recursive: true });
    }
    return projectDownloads;
}

function getLogsDir() {
    if (process.env.LOGA3_LOGS_DIR) {
        return path.resolve(process.env.LOGA3_LOGS_DIR);
    }

    const projectLogs = path.join(PROJECT_ROOT, 'logs');
    if (!fs.existsSync(projectLogs)) {
        fs.mkdirSync(projectLogs, { recursive: true });
    }
    return projectLogs;
}

function normalizeName(value) {
    return value.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
}

function matchesMonthFile(filename, monthName, year) {
    const base = normalizeName(path.basename(filename, path.extname(filename)));
    const month = normalizeName(monthName);
    const patterns = [
        `${month}_${year}`,
        `loga3_${month}_${year}`,
        `zeitprotokoll_${month}_${year}`,
    ];
    return patterns.some((pattern) => base.includes(pattern));
}

function scanYear(downloadsDir, year) {
    let files = [];
    try {
        files = fs.readdirSync(downloadsDir);
    } catch {
        return { year, months: [], missingCount: 12, presentCount: 0 };
    }

    const pdfFiles = files.filter((file) => file.toLowerCase().endsWith('.pdf'));

    const months = MONTH_NAMES.map((monthName, index) => {
        const match = pdfFiles.find((file) => matchesMonthFile(file, monthName, year));
        return {
            month: index + 1,
            label: MONTH_LABELS[index],
            key: `${monthName}_${year}`,
            present: Boolean(match),
            file: match || null,
        };
    });

    const presentCount = months.filter((month) => month.present).length;

    return {
        year,
        downloadsDir,
        months,
        presentCount,
        missingCount: 12 - presentCount,
    };
}

function getAvailableYears() {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1];
}

/**
 * Last N calendar months including the current month, oldest first.
 * Example (Jul 2026, n=3): May 2026 → Jun 2026 → Jul 2026
 */
function getLastNMonths(count, referenceDate = new Date()) {
    const n = Math.max(1, Math.min(36, Number(count) || 3));
    const targets = [];
    const cursor = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);

    for (let i = 0; i < n; i++) {
        targets.push({
            month: cursor.getMonth() + 1,
            year: cursor.getFullYear(),
        });
        cursor.setMonth(cursor.getMonth() - 1);
    }

    return targets.reverse();
}

/**
 * Next N calendar months after the current month, oldest first.
 * Example (Jul 2026, n=3): Aug 2026 → Sep 2026 → Oct 2026
 */
function getNextNMonths(count, referenceDate = new Date()) {
    const n = Math.max(1, Math.min(36, Number(count) || 3));
    const targets = [];
    const cursor = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1);

    for (let i = 0; i < n; i++) {
        targets.push({
            month: cursor.getMonth() + 1,
            year: cursor.getFullYear(),
        });
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return targets;
}

/** LOGA3_HEADLESS=1|0 overrides config; else config.browser.headless; else false. */
function resolveHeadless(browserConfig = {}) {
    const env = process.env.LOGA3_HEADLESS;
    if (env === '1' || env === 'true') return true;
    if (env === '0' || env === 'false') return false;
    if (browserConfig.headless !== undefined) return Boolean(browserConfig.headless);
    return false;
}

module.exports = {
    PROJECT_ROOT,
    MONTH_NAMES,
    MONTH_LABELS,
    getDownloadsDir,
    getLogsDir,
    scanYear,
    getAvailableYears,
    getLastNMonths,
    getNextNMonths,
    resolveHeadless,
};
