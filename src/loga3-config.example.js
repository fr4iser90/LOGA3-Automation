/**
 * LOGA3 Configuration Example
 * Copy to loga3-config.js and fill in your credentials:
 *   cp loga3-config.example.js loga3-config.js
 *
 * Prefer environment variables for secrets (see .env.example).
 * Values in loga3-config.js override nothing if env is set — use either file OR .env.
 */

module.exports = {
    // Leave empty and use LOGA3_USERNAME / LOGA3_PASSWORD in .env instead
    username: '',
    password: '',

    browser: {
        type: 'chromium', // 'chromium' or 'firefox'
        headless: true, // false = show browser (local debug); true = server / unattended
        slowMo: 0,
        timeout: 60000,
        pageLoadTimeout: 90000,
        sleepBetweenSteps: 2000,
    },

    // Prefer LOGA3_BASE_URL in .env or GUI Settings — no employer URL in git
    baseUrl: '',


    screenshots: {
        enabled: true,
        directory: './logs/',
        filename: 'loga3-screenshot.png',
    },
};
