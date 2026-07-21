const fs = require('fs');
const path = require('path');
const { normalizeLocale, getLocale, setLocale, t } = require('./loga3-i18n');

const PROJECT_ROOT = path.join(__dirname, '..');
const SETTINGS_FILE = 'loga3-settings.json';

const DEFAULT_CONVERT = {
    hospital: 'st-elisabeth-leipzig',
    group: 'pflege',
    area: 'op-bereich',
    preset: 'Anästhesie',
    showMonthSummary: true,
    richEventDetails: false,
    // Public OAuth web client (ShiftPlanConverter) — not a secret
    googleClientId: '443643010945-l4r4n5t6vaj93tcqs8jlbvccltd06kaf.apps.googleusercontent.com',
};

function getSettingsDir() {
    if (process.env.LOGA3_PORTABLE_ROOT) {
        return path.resolve(process.env.LOGA3_PORTABLE_ROOT);
    }
    return path.join(PROJECT_ROOT, 'data');
}

function getSettingsPath() {
    return path.join(getSettingsDir(), SETTINGS_FILE);
}

function normalizeConvert(raw = {}) {
    return {
        hospital: String(raw.hospital || DEFAULT_CONVERT.hospital).trim() || DEFAULT_CONVERT.hospital,
        group: String(raw.group || DEFAULT_CONVERT.group).trim() || DEFAULT_CONVERT.group,
        area: String(raw.area || DEFAULT_CONVERT.area).trim() || DEFAULT_CONVERT.area,
        preset: String(raw.preset || '').trim(),
        showMonthSummary: raw.showMonthSummary === undefined
            ? DEFAULT_CONVERT.showMonthSummary
            : Boolean(raw.showMonthSummary),
        richEventDetails: raw.richEventDetails === undefined
            ? DEFAULT_CONVERT.richEventDetails
            : Boolean(raw.richEventDetails),
        googleClientId: String(raw.googleClientId || DEFAULT_CONVERT.googleClientId).trim()
            || DEFAULT_CONVERT.googleClientId,
    };
}

function loadSettings() {
    const filePath = getSettingsPath();
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        return {
            username: String(data.username || ''),
            password: String(data.password || ''),
            headless: data.headless === undefined ? null : Boolean(data.headless),
            locale: normalizeLocale(data.locale) || null,
            convert: normalizeConvert(data.convert || {}),
        };
    } catch {
        return {
            username: '',
            password: '',
            headless: null,
            locale: null,
            convert: normalizeConvert({}),
        };
    }
}

function isConfigured(settings = loadSettings()) {
    if (process.env.LOGA3_USERNAME && process.env.LOGA3_PASSWORD) return true;
    return Boolean(settings.username && settings.password);
}

/**
 * Persist settings. Empty password keeps the previous one (change-username-only).
 */
function saveSettings(patch = {}) {
    const current = loadSettings();
    const next = {
        username: patch.username !== undefined ? String(patch.username).trim() : current.username,
        password: current.password,
        headless: patch.headless !== undefined ? Boolean(patch.headless) : current.headless,
        locale: patch.locale !== undefined
            ? (normalizeLocale(patch.locale) || current.locale || 'de')
            : current.locale,
        convert: patch.convert !== undefined
            ? normalizeConvert({ ...current.convert, ...patch.convert })
            : current.convert,
    };

    if (patch.password !== undefined && String(patch.password).length > 0) {
        next.password = String(patch.password);
    }

    if (!next.username) {
        if (process.env.LOGA3_USERNAME) {
            next.username = process.env.LOGA3_USERNAME;
        } else {
            throw new Error(t('errUsername'));
        }
    }
    if (!next.password) {
        const envOk = Boolean(process.env.LOGA3_USERNAME && process.env.LOGA3_PASSWORD);
        if (!envOk) {
            throw new Error(t('errPassword'));
        }
    }

    const dir = getSettingsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = getSettingsPath();
    const toWrite = {
        username: next.username,
        password: next.password,
        headless: next.headless,
        locale: next.locale,
        convert: next.convert,
    };
    fs.writeFileSync(filePath, `${JSON.stringify(toWrite, null, 2)}\n`, { mode: 0o600 });
    try {
        fs.chmodSync(filePath, 0o600);
    } catch {
        // Windows may ignore mode
    }

    if (next.locale) setLocale(next.locale);
    if (next.headless !== null) {
        process.env.LOGA3_HEADLESS = next.headless ? '1' : '0';
    }

    return {
        configured: true,
        username: next.username,
        headless: next.headless === null ? undefined : next.headless,
        locale: next.locale || getLocale(),
        convert: next.convert,
        path: filePath,
    };
}

function getPublicSettings() {
    const settings = loadSettings();
    const envConfigured = Boolean(process.env.LOGA3_USERNAME && process.env.LOGA3_PASSWORD);
    const locale = getLocale();
    let headless;
    if (settings.headless !== null) {
        headless = settings.headless;
    } else if (process.env.LOGA3_HEADLESS !== undefined) {
        headless = process.env.LOGA3_HEADLESS === '1' || process.env.LOGA3_HEADLESS === 'true';
    } else {
        headless = undefined;
    }
    return {
        configured: isConfigured(settings),
        username: process.env.LOGA3_USERNAME || settings.username || '',
        headless,
        locale,
        convert: settings.convert,
        source: envConfigured ? 'env' : (settings.username ? 'gui' : 'none'),
        settingsPath: getSettingsPath(),
    };
}

/** Fill process env from saved GUI settings when env/config not set. */
function applySettingsToEnv(env = process.env) {
    const settings = loadSettings();
    if (!env.LOGA3_USERNAME && settings.username) {
        env.LOGA3_USERNAME = settings.username;
    }
    if (!env.LOGA3_PASSWORD && settings.password) {
        env.LOGA3_PASSWORD = settings.password;
    }
    // GUI checkbox is source of truth once set (overrides stale process env).
    if (settings.headless !== null) {
        env.LOGA3_HEADLESS = settings.headless ? '1' : '0';
    }
    if (!env.LOGA3_LOCALE && settings.locale) {
        env.LOGA3_LOCALE = settings.locale;
    } else if (!env.LOGA3_LOCALE) {
        env.LOGA3_LOCALE = 'de';
    }
    return env;
}

module.exports = {
    DEFAULT_CONVERT,
    getSettingsDir,
    getSettingsPath,
    loadSettings,
    saveSettings,
    isConfigured,
    getPublicSettings,
    applySettingsToEnv,
    normalizeConvert,
};
