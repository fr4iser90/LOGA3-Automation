/**
 * Lädt Krankenhaus-Konfiguration, Schicht-Mappings und Parser.
 * Builtin + installierte Packs über /api/hospital-assets/; User-Overlays gemerged.
 */

function hospitalAssetUrl(krankenhaus, relativePath) {
    const clean = String(relativePath || '').replace(/^\/+/, '');
    return `/api/hospital-assets/${encodeURIComponent(krankenhaus)}/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * @param {string} krankenhaus - z.B. "st-elisabeth-leipzig"
 * @returns {Promise<Object>}
 */
export async function loadHospitalConfig(krankenhaus) {
    const url = hospitalAssetUrl(krankenhaus, 'config.json');
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Konnte Konfiguration für ${krankenhaus} nicht laden: ${response.statusText}`);
    }
    return await response.json();
}

/**
 * @param {string} krankenhaus
 * @param {string} mappingPath - relativ zum Krankenhaus-Ordner
 * @param {{ group?: string, area?: string }} [opts] - für User-Overlay
 * @returns {Promise<Object>}
 */
export async function loadMapping(krankenhaus, mappingPath, opts = {}) {
    const url = hospitalAssetUrl(krankenhaus, mappingPath);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Konnte Mapping ${mappingPath} nicht laden: ${response.statusText}`);
    }
    let mapping = await response.json();

    const group = opts.group;
    const area = opts.area;
    if (group && area) {
        try {
            const q = new URLSearchParams({ hospital: krankenhaus, group, area });
            const overlayResp = await fetch(`/api/user-mapping?${q}`);
            if (overlayResp.ok) {
                const data = await overlayResp.json();
                if (data.overlay) {
                    mapping = mergeMappingClient(mapping, data.overlay);
                }
            }
        } catch {
            // Overlay optional
        }
    }
    return mapping;
}

export function mergeMappingClient(base, overlay) {
    if (!base) return overlay || null;
    if (!overlay) return base;
    const out = {
        ...base,
        colors: { ...(base.colors || {}), ...(overlay.colors || {}) },
        presets: { ...(base.presets || {}) },
    };
    for (const [preset, shifts] of Object.entries(overlay.presets || {})) {
        out.presets[preset] = { ...(out.presets[preset] || {}), ...shifts };
    }
    return out;
}

/**
 * @param {string} krankenhaus
 * @returns {Promise<Function|null>}
 */
export async function loadHospitalParser(krankenhaus) {
    try {
        const url = hospitalAssetUrl(krankenhaus, 'parser.js');
        const module = await import(/* @vite-ignore */ url);
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
    const response = await fetch('/converter/src/specialShiftTypes.json');
    if (!response.ok) {
        throw new Error(`Konnte Sonder-Schichttypen-Konfiguration nicht laden: ${response.statusText}`);
    }
    return await response.json();
}

/**
 * @returns {Promise<Array<{id:string,name:string,source:string}>>}
 */
export async function listHospitals() {
    const response = await fetch('/api/hospitals');
    if (!response.ok) throw new Error('Krankenhausliste nicht ladbar');
    const data = await response.json();
    return data.hospitals || [];
}
