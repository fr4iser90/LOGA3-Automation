/**
 * Lädt Krankenhaus-Konfiguration, Schicht-Mappings und Parser.
 * Pfade relativ zu converter/ (via import.meta.url), unabhängig von der HTML-URL.
 */

const CONVERTER_ROOT = new URL('../', import.meta.url);

function assetUrl(relativePath) {
    return new URL(relativePath, CONVERTER_ROOT);
}

/**
 * @param {string} krankenhaus - z.B. "st-elisabeth-leipzig"
 * @returns {Promise<Object>}
 */
export async function loadHospitalConfig(krankenhaus) {
    const url = assetUrl(`krankenhaeuser/${krankenhaus}/config.json`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Konnte Konfiguration für ${krankenhaus} nicht laden: ${response.statusText}`);
    }
    return await response.json();
}

/**
 * @param {string} krankenhaus
 * @param {string} mappingPath - relativ zum Krankenhaus-Ordner
 * @returns {Promise<Object>}
 */
export async function loadMapping(krankenhaus, mappingPath) {
    const url = assetUrl(`krankenhaeuser/${krankenhaus}/${mappingPath}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Konnte Mapping ${mappingPath} nicht laden: ${response.statusText}`);
    }
    return await response.json();
}

/**
 * @param {string} krankenhaus
 * @returns {Promise<Function|null>}
 */
export async function loadHospitalParser(krankenhaus) {
    try {
        const module = await import(`../krankenhaeuser/${krankenhaus}/parser.js`);
        if (module.parseStElisabeth) return module.parseStElisabeth;
        if (module.default) return module.default;
        return Object.values(module).find((f) => typeof f === 'function') || null;
    } catch (e) {
        console.warn('Kein spezifischer Parser für', krankenhaus, 'gefunden.', e);
        return null;
    }
}

/**
 * @returns {Promise<Object>}
 */
export async function loadSpecialShiftTypes() {
    const url = assetUrl('src/specialShiftTypes.json');
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Konnte Sonder-Schichttypen-Konfiguration nicht laden: ${response.statusText}`);
    }
    return await response.json();
}
