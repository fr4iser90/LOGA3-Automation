/**
 * User hospital packs + user mapping overlays (writable under settings dir).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getSettingsDir } = require('./loga3-settings');

function getPacksDir() {
    return path.join(getSettingsDir(), 'packs');
}

function getUserMappingsDir() {
    return path.join(getSettingsDir(), 'user-mappings');
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function slugify(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'pack';
}

function listBuiltinHospitals(converterDir) {
    const root = path.join(converterDir, 'krankenhaeuser');
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => {
            const id = d.name;
            let name = id;
            try {
                const cfg = JSON.parse(fs.readFileSync(path.join(root, id, 'config.json'), 'utf8'));
                if (cfg.name) name = cfg.name;
            } catch {
                // ignore
            }
            return { id, name, source: 'builtin' };
        });
}

function listInstalledPacks() {
    const root = getPacksDir();
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => {
            const id = d.name;
            let name = id;
            try {
                const cfg = JSON.parse(fs.readFileSync(path.join(root, id, 'config.json'), 'utf8'));
                if (cfg.name) name = cfg.name;
            } catch {
                // ignore
            }
            return { id, name, source: 'pack' };
        });
}

function listHospitals(converterDir) {
    const builtin = listBuiltinHospitals(converterDir);
    const packs = listInstalledPacks();
    const byId = new Map();
    for (const h of builtin) byId.set(h.id, h);
    for (const h of packs) byId.set(h.id, h);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function resolveHospitalRoot(converterDir, hospitalId) {
    const id = String(hospitalId || '').trim();
    if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
        throw new Error('Ungültige Krankenhaus-ID');
    }
    const packRoot = path.join(getPacksDir(), id);
    if (fs.existsSync(path.join(packRoot, 'config.json'))) return { root: packRoot, source: 'pack' };
    const builtinRoot = path.join(converterDir, 'krankenhaeuser', id);
    if (fs.existsSync(path.join(builtinRoot, 'config.json'))) return { root: builtinRoot, source: 'builtin' };
    throw new Error(`Krankenhaus „${id}“ nicht gefunden`);
}

function safeJoin(root, relPath) {
    const clean = String(relPath || '').replace(/^[/\\]+/, '');
    if (!clean || clean.includes('..')) throw new Error('Ungültiger Pfad');
    const full = path.resolve(root, clean);
    const rootResolved = path.resolve(root);
    if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
        throw new Error('Pfad außerhalb des Packs');
    }
    return full;
}

function readHospitalAsset(converterDir, hospitalId, relPath) {
    const { root } = resolveHospitalRoot(converterDir, hospitalId);
    const full = safeJoin(root, relPath);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        throw new Error('Datei nicht gefunden');
    }
    return { path: full, content: fs.readFileSync(full) };
}

function mappingOverlayKey(hospital, group, area) {
    return `${slugify(hospital)}__${slugify(group)}__${slugify(area)}.json`;
}

function loadUserMappingOverlay(hospital, group, area) {
    const file = path.join(getUserMappingsDir(), mappingOverlayKey(hospital, group, area));
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function saveUserMappingOverlay(hospital, group, area, overlay) {
    ensureDir(getUserMappingsDir());
    const file = path.join(getUserMappingsDir(), mappingOverlayKey(hospital, group, area));
    const data = {
        hospital,
        group,
        area,
        updatedAt: new Date().toISOString(),
        colors: overlay.colors || {},
        presets: overlay.presets || {},
    };
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return data;
}

function deleteUserMappingOverlay(hospital, group, area) {
    const file = path.join(getUserMappingsDir(), mappingOverlayKey(hospital, group, area));
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true };
}

function mergeMapping(base, overlay) {
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

function unzipToDir(zipPath, destDir) {
    ensureDir(destDir);
    if (process.platform === 'win32') {
        execFileSync(
            'powershell',
            [
                '-NoProfile',
                '-Command',
                `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] }
        );
        return;
    }
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Install pack from a zip file path. Returns { id, name }.
 */
function installPackFromZip(zipPath) {
    if (!fs.existsSync(zipPath)) throw new Error('ZIP nicht gefunden');
    ensureDir(getPacksDir());
    const tmp = path.join(getPacksDir(), `.tmp-install-${Date.now()}`);
    ensureDir(tmp);
    try {
        unzipToDir(zipPath, tmp);
        const entries = fs.readdirSync(tmp, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
        let packSource = tmp;
        if (entries.length === 1 && entries[0].isDirectory()) {
            packSource = path.join(tmp, entries[0].name);
        }
        const cfgPath = path.join(packSource, 'config.json');
        if (!fs.existsSync(cfgPath)) {
            throw new Error('Pack ungültig: config.json fehlt (Ordner mit config.json + mappings/)');
        }
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const id = slugify(cfg.id || path.basename(packSource) || cfg.name);
        const dest = path.join(getPacksDir(), id);
        if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
        fs.renameSync(packSource, dest);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
        return { id, name: cfg.name || id, source: 'pack' };
    } catch (e) {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
        throw e;
    }
}

function deletePack(id) {
    const clean = slugify(id);
    const dest = path.join(getPacksDir(), clean);
    if (!fs.existsSync(dest)) throw new Error('Pack nicht gefunden');
    fs.rmSync(dest, { recursive: true, force: true });
    return { ok: true, id: clean };
}

function fetchUrlBuffer(urlString, { maxRedirects = 5, maxBytes = 40 * 1024 * 1024 } = {}) {
    const https = require('https');
    const http = require('http');
    return new Promise((resolve, reject) => {
        const getter = urlString.startsWith('https') ? https : http;
        const req = getter.get(urlString, { headers: { 'User-Agent': 'LOGA3-Automation' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
                fetchUrlBuffer(res.headers.location, { maxRedirects: maxRedirects - 1, maxBytes })
                    .then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`Download fehlgeschlagen (${res.statusCode})`));
                res.resume();
                return;
            }
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxBytes) {
                    reject(new Error('Download zu groß'));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
    });
}

async function fetchPacksCatalog(manifestUrl) {
    if (!manifestUrl) throw new Error('Keine packsManifestUrl konfiguriert');
    const buf = await fetchUrlBuffer(manifestUrl, { maxBytes: 2 * 1024 * 1024 });
    const data = JSON.parse(buf.toString('utf8'));
    return {
        updatedAt: data.updatedAt || null,
        note: data.note || '',
        packs: Array.isArray(data.packs) ? data.packs : [],
        source: manifestUrl,
    };
}

async function installPackFromUrl(zipUrl) {
    if (!zipUrl || !/^https?:\/\//i.test(zipUrl)) {
        throw new Error('Ungültige ZIP-URL');
    }
    ensureDir(getPacksDir());
    const tmpZip = path.join(getPacksDir(), `pack-url-${Date.now()}.zip`);
    try {
        const buf = await fetchUrlBuffer(zipUrl);
        fs.writeFileSync(tmpZip, buf);
        return installPackFromZip(tmpZip);
    } finally {
        try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }
    }
}

module.exports = {
    getPacksDir,
    getUserMappingsDir,
    listHospitals,
    listInstalledPacks,
    resolveHospitalRoot,
    readHospitalAsset,
    loadUserMappingOverlay,
    saveUserMappingOverlay,
    deleteUserMappingOverlay,
    mergeMapping,
    installPackFromZip,
    installPackFromUrl,
    fetchPacksCatalog,
    deletePack,
    slugify,
};
