/**
 * Minimal DE/EN i18n for GUI + user-facing automation logs.
 * Locale: LOGA3_LOCALE env, else settings.locale, else "de".
 */

const MONTH_KEYS = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
];

const MESSAGES = {
    de: {
        appTitle: 'LOGA3 Zeitprotokolle',
        appSubtitle: 'Lokale Übersicht & Download',
        year: 'Jahr',
        settings: 'Einstellungen',
        refresh: 'Aktualisieren',
        setupBanner: 'Bitte einmal LOGA3-Benutzername und Passwort speichern — danach kannst du Monate laden.',
        setupNow: 'Jetzt einrichten',
        present: 'vorhanden',
        missing: 'fehlt',
        presentCount: 'vorhanden',
        missingCount: 'fehlen',
        monthsTotal: 'Monate gesamt',
        selectedCount: '{count} Monat ausgewählt',
        selectedCountPlural: '{count} Monate ausgewählt',
        selectMissing: 'Alle fehlenden auswählen',
        clearSelection: 'Auswahl löschen',
        downloadSelected: 'Ausgewählte laden',
        downloadSelectedN: 'Ausgewählte laden ({count})',
        downloadMissing: 'Alle fehlenden laden',
        downloadCurrent: 'Aktuellen LOGA3-Monat',
        stop: 'Abbrechen',
        handoffHint: 'Danach: PDFs in ShiftPlanConverter öffnen (Kalender / .ics).',
        openDownloads: 'PDF-Ordner öffnen',
        openConverter: 'Converter öffnen',
        usageHint: 'Monate anklicken, dann Ausgewählte laden. Bei 2FA im Browserfenster bestätigen.',
        liveLog: 'Live-Log',
        settingsTitle: 'Einstellungen',
        settingsWelcome: 'Willkommen — Zugang einrichten',
        settingsIntro: 'Einmal eingeben und speichern. Das Passwort wird nur lokal auf diesem Rechner abgelegt (nicht in der Cloud).',
        username: 'Benutzername',
        password: 'Passwort',
        passwordKeep: '•••••••• (leer = behalten)',
        passwordHint: 'Leer lassen = bisheriges Passwort behalten',
        headless: 'Browser verstecken (Headless) — für Server; zum Mitgucken auslassen',
        language: 'Sprache',
        langDe: 'Deutsch',
        langEn: 'English',
        cancel: 'Abbrechen',
        save: 'Speichern',
        errUsername: 'Benutzername fehlt.',
        errPassword: 'Passwort fehlt.',
        errRequest: 'Anfrage fehlgeschlagen',
        errNeedCredentials: 'Bitte zuerst Zugangsdaten speichern.',
        errSelectMonth: 'Bitte mindestens einen Monat auswählen.',
        errInventory: 'Inventar noch nicht geladen.',
        errNoMissing: 'Für {year} fehlen keine Monate.',
        errJobRunning: 'Ein Download läuft bereits.',
        errNeedSetup: 'Bitte zuerst LOGA3-Zugangsdaten unter „Einstellungen“ speichern.',
        errNoMissingYear: 'Keine fehlenden Monate für {year}.',
        errNoMonths: 'Keine Monate ausgewählt.',
        errTargets: 'Monatsliste konnte nicht erzeugt werden.',
        errStart: 'Startfehler: {message}',
        errReconnect: 'Verbindung zum Server unterbrochen, versuche erneut…',
        logCredentialsSaved: '✅ Zugangsdaten gespeichert ({username}).',
        logFolder: '📂 Ordner: {path}',
        logConverter: '🌐 Converter: {url}',
        logQueue: '▶ {count} Monat(e) für {year}: {months}',
        logCurrent: '▶ Download für aktuellen LOGA3-Monat…',
        log2fa: 'ℹ️  Bei 2FA im Browserfenster bestätigen.',
        logDone: '✅ Alle Downloads fertig.',
        logError: '❌ Fehler (Exit-Code {code})',
        logCancelled: '🛑 Abgebrochen.',
        logMissingList: '📋 Fehlende Monate ({count}): {months}',
        // Automation (user-facing)
        autoStart: '🚀 Starte LOGA3…',
        autoLogin: '🔐 Anmeldung…',
        autoLoginOk: '✅ Anmeldung erfolgreich',
        auto2fa: '🔐 2FA erkannt — bitte im Browser bestätigen',
        auto2faWait: '⏳ Warte auf 2FA…',
        autoMonth: '▶ {index}/{total} {label}',
        autoSaved: '✅ {filename}.pdf',
        autoNoPlan: 'ℹ️  {label} — noch kein Plan (übersprungen)',
        autoFinished: '🎉 Fertig — PDFs in {dir}',
        autoFailed: '❌ Fehler: {message}',
        autoNoCredentials: 'Keine Zugangsdaten — in der GUI unter Einstellungen speichern (oder .env).',
        autoShutdown: '🛑 Beende…',
        autoBrowserClosed: '🧹 Browser geschlossen',
        noPlanBadge: 'kein Plan',
        noPlanCount: 'kein Plan',
        january: 'Januar', february: 'Februar', march: 'März', april: 'April',
        may: 'Mai', june: 'Juni', july: 'Juli', august: 'August',
        september: 'September', october: 'Oktober', november: 'November', december: 'Dezember',
    },
    en: {
        appTitle: 'LOGA3 time sheets',
        appSubtitle: 'Local overview & download',
        year: 'Year',
        settings: 'Settings',
        refresh: 'Refresh',
        setupBanner: 'Save your LOGA3 username and password once — then you can download months.',
        setupNow: 'Set up now',
        present: 'present',
        missing: 'missing',
        presentCount: 'present',
        missingCount: 'missing',
        monthsTotal: 'months total',
        selectedCount: '{count} month selected',
        selectedCountPlural: '{count} months selected',
        selectMissing: 'Select all missing',
        clearSelection: 'Clear selection',
        downloadSelected: 'Download selected',
        downloadSelectedN: 'Download selected ({count})',
        downloadMissing: 'Download all missing',
        downloadCurrent: 'Current LOGA3 month',
        stop: 'Cancel',
        handoffHint: 'Next: open the PDFs in ShiftPlanConverter (calendar / .ics).',
        openDownloads: 'Open PDF folder',
        openConverter: 'Open converter',
        usageHint: 'Click months, then Download selected. Confirm 2FA in the browser window if prompted.',
        liveLog: 'Live log',
        settingsTitle: 'Settings',
        settingsWelcome: 'Welcome — set up access',
        settingsIntro: 'Enter once and save. The password stays on this computer only (not in the cloud).',
        username: 'Username',
        password: 'Password',
        passwordKeep: '•••••••• (leave blank to keep)',
        passwordHint: 'Leave blank to keep the current password',
        headless: 'Hide browser (headless) — for servers; leave unchecked to watch',
        language: 'Language',
        langDe: 'Deutsch',
        langEn: 'English',
        cancel: 'Cancel',
        save: 'Save',
        errUsername: 'Username is required.',
        errPassword: 'Password is required.',
        errRequest: 'Request failed',
        errNeedCredentials: 'Please save credentials first.',
        errSelectMonth: 'Please select at least one month.',
        errInventory: 'Inventory not loaded yet.',
        errNoMissing: 'No missing months for {year}.',
        errJobRunning: 'A download is already running.',
        errNeedSetup: 'Please save LOGA3 credentials under Settings first.',
        errNoMissingYear: 'No missing months for {year}.',
        errNoMonths: 'No months selected.',
        errTargets: 'Could not build the month list.',
        errStart: 'Startup error: {message}',
        errReconnect: 'Server connection lost, retrying…',
        logCredentialsSaved: '✅ Credentials saved ({username}).',
        logFolder: '📂 Folder: {path}',
        logConverter: '🌐 Converter: {url}',
        logQueue: '▶ {count} month(s) for {year}: {months}',
        logCurrent: '▶ Downloading current LOGA3 month…',
        log2fa: 'ℹ️  If 2FA is required, confirm in the browser window.',
        logDone: '✅ All downloads complete.',
        logError: '❌ Error (exit code {code})',
        logCancelled: '🛑 Cancelled.',
        logMissingList: '📋 Missing months ({count}): {months}',
        autoStart: '🚀 Starting LOGA3…',
        autoLogin: '🔐 Signing in…',
        autoLoginOk: '✅ Signed in',
        auto2fa: '🔐 2FA detected — confirm in the browser',
        auto2faWait: '⏳ Waiting for 2FA…',
        autoMonth: '▶ {index}/{total} {label}',
        autoSaved: '✅ {filename}.pdf',
        autoNoPlan: 'ℹ️  {label} — no schedule yet (skipped)',
        autoFinished: '🎉 Done — PDFs in {dir}',
        autoFailed: '❌ Failed: {message}',
        autoNoCredentials: 'No credentials — save them in the GUI Settings (or .env).',
        autoShutdown: '🛑 Shutting down…',
        autoBrowserClosed: '🧹 Browser closed',
        noPlanBadge: 'no plan',
        noPlanCount: 'no plan',
        january: 'January', february: 'February', march: 'March', april: 'April',
        may: 'May', june: 'June', july: 'July', august: 'August',
        september: 'September', october: 'October', november: 'November', december: 'December',
    },
};

function normalizeLocale(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw.startsWith('en')) return 'en';
    if (raw.startsWith('de')) return 'de';
    return null;
}

function getLocale(env = process.env) {
    return normalizeLocale(env.LOGA3_LOCALE) || 'de';
}

function setLocale(locale, env = process.env) {
    const next = normalizeLocale(locale) || 'de';
    env.LOGA3_LOCALE = next;
    return next;
}

function t(key, vars = {}, locale = getLocale()) {
    const table = MESSAGES[locale] || MESSAGES.de;
    let text = table[key] ?? MESSAGES.de[key] ?? key;
    for (const [name, value] of Object.entries(vars)) {
        text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    }
    return text;
}

function monthLabel(month, locale = getLocale()) {
    const key = MONTH_KEYS[Number(month) - 1];
    return key ? t(key, {}, locale) : String(month);
}

function monthLabels(locale = getLocale()) {
    return MONTH_KEYS.map((key) => t(key, {}, locale));
}

function getMessages(locale = getLocale()) {
    return { ...(MESSAGES[locale] || MESSAGES.de) };
}

module.exports = {
    MESSAGES,
    MONTH_KEYS,
    getLocale,
    setLocale,
    normalizeLocale,
    t,
    monthLabel,
    monthLabels,
    getMessages,
};
