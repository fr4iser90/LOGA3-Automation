/**
 * User vs debug logging. Default: quiet user milestones only.
 * Set LOGA3_DEBUG=1 for full automation chatter (CONTENT checks, selectors, …).
 */

const { t, getLocale } = require('./loga3-i18n');

function isDebug(env = process.env) {
    return env.LOGA3_DEBUG === '1' || env.LOGA3_DEBUG === 'true';
}

function formatArgs(args) {
    return args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
}

function userLog(...args) {
    console.log(formatArgs(args));
}

function userError(...args) {
    console.error(formatArgs(args));
}

function debugLog(...args) {
    if (!isDebug()) return;
    console.log(formatArgs(args));
}

function debugError(...args) {
    if (!isDebug()) return;
    console.error(formatArgs(args));
}

/** Log a translated user-facing message. */
function userT(key, vars = {}, locale = getLocale()) {
    userLog(t(key, vars, locale));
}

function userErrorT(key, vars = {}, locale = getLocale()) {
    userError(t(key, vars, locale));
}

module.exports = {
    isDebug,
    userLog,
    userError,
    debugLog,
    debugError,
    userT,
    userErrorT,
};
