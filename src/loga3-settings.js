const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SETTINGS_FILE = 'loga3-settings.json';

function getSettingsDir() {
    if (process.env.LOGA3_PORTABLE_ROOT) {
        return path.resolve(process.env.LOGA3_PORTABLE_ROOT);
    }
    return path.join(PROJECT_ROOT, 'data');
}

function getSettingsPath() {
    return path.join(getSettingsDir(), SETTINGS_FILE);
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
        };
    } catch {
        return { username: '', password: '', headless: null };
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
    };

    if (patch.password !== undefined && String(patch.password).length > 0) {
        next.password = String(patch.password);
    }

    if (!next.username) {
        throw new Error('Benutzername fehlt.');
    }
    if (!next.password) {
        throw new Error('Passwort fehlt.');
    }

    const dir = getSettingsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = getSettingsPath();
    fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    try {
        fs.chmodSync(filePath, 0o600);
    } catch {
        // Windows may ignore mode
    }

    return {
        configured: true,
        username: next.username,
        headless: next.headless === null ? undefined : next.headless,
        path: filePath,
    };
}

function getPublicSettings() {
    const settings = loadSettings();
    const envConfigured = Boolean(process.env.LOGA3_USERNAME && process.env.LOGA3_PASSWORD);
    return {
        configured: isConfigured(settings),
        username: process.env.LOGA3_USERNAME || settings.username || '',
        headless: process.env.LOGA3_HEADLESS !== undefined
            ? (process.env.LOGA3_HEADLESS === '1' || process.env.LOGA3_HEADLESS === 'true')
            : (settings.headless === null ? undefined : settings.headless),
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
    if (env.LOGA3_HEADLESS === undefined && settings.headless !== null) {
        env.LOGA3_HEADLESS = settings.headless ? '1' : '0';
    }
    return env;
}

module.exports = {
    getSettingsDir,
    getSettingsPath,
    loadSettings,
    saveSettings,
    isConfigured,
    getPublicSettings,
    applySettingsToEnv,
};
