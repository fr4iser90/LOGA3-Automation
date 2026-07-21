#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');

require('dotenv').config({
    path: process.env.LOGA3_PORTABLE_ROOT
        ? path.join(process.env.LOGA3_PORTABLE_ROOT, '.env')
        : path.join(__dirname, '..', '.env'),
    quiet: true,
});

const { scanYear, getAvailableYears, getDownloadsDir } = require('./loga3-inventory');
const {
    getPublicSettings,
    saveSettings,
    isConfigured,
    applySettingsToEnv,
    getSettingsDir,
} = require('./loga3-settings');
const {
    listHospitals,
    readHospitalAsset,
    loadUserMappingOverlay,
    saveUserMappingOverlay,
    deleteUserMappingOverlay,
    mergeMapping,
    installPackFromZip,
    deletePack,
    listInstalledPacks,
    fetchPacksCatalog,
    installPackFromUrl,
} = require('./loga3-packs');
const { openPath } = require('./loga3-cli-args');
const { t, getMessages, setLocale } = require('./loga3-i18n');
const { getAppVersion, checkForAppUpdate } = require('./loga3-updates');

applySettingsToEnv(process.env);
const PORT = Number(process.env.LOGA3_GUI_PORT) || 3847;
const HOST = process.env.LOGA3_GUI_HOST || '127.0.0.1';

// Dev: src/loga3-gui-server.js → ../gui
// Portable AppImage/zip: flattened app/loga3-gui-server.js → ./gui
const PORTABLE_LAYOUT = fs.existsSync(path.join(__dirname, 'gui', 'index.html'));
const PROJECT_ROOT = PORTABLE_LAYOUT
    ? (process.env.LOGA3_BUNDLE_ROOT || path.join(__dirname, '..'))
    : path.join(__dirname, '..');
const APP_ROOT = PORTABLE_LAYOUT ? __dirname : PROJECT_ROOT;
const GUI_DIR = PORTABLE_LAYOUT
    ? path.join(__dirname, 'gui')
    : path.join(PROJECT_ROOT, 'gui');
const CONVERTER_DIR = path.join(APP_ROOT, 'converter');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.pdf': 'application/pdf',
    '.map': 'application/json; charset=utf-8',
};

let jobRunning = false;
let jobChild = null;
let jobCancelled = false;
const sseClients = new Set();

function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => {
            if (!data) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(data));
            } catch {
                reject(new Error('Invalid JSON request'));
            }
        });
        req.on('error', reject);
    });
}

function readRawBody(req, { maxBytes = 40 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error('Upload zu groß (max. 40 MB)'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        client.write(message);
    }
}

function pushLog(line) {
    const text = String(line).trimEnd();
    if (!text) return;
    broadcast('log', { line: text, time: new Date().toISOString() });
}

function resolveStaticPath(pathname) {
    if (pathname === '/converter' || pathname.startsWith('/converter/')) {
        const rel = pathname === '/converter' ? '' : pathname.slice('/converter/'.length);
        const filePath = path.normalize(path.join(CONVERTER_DIR, rel || 'README.md'));
        if (!filePath.startsWith(CONVERTER_DIR)) return null;
        return filePath;
    }
    const filePath = path.normalize(path.join(GUI_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!filePath.startsWith(GUI_DIR)) return null;
    return filePath;
}

function serveStatic(req, res) {
    const pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;
    const filePath = resolveStaticPath(pathname);
    if (!filePath) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            sendJson(res, 404, { error: 'Not found' });
            return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain; charset=utf-8' });
        res.end(content);
    });
}

function listDownloadedPdfs() {
    const dir = getDownloadsDir();
    let names = [];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return [];
    }
    return names
        .filter((name) => name.toLowerCase().endsWith('.pdf'))
        .map((name) => {
            const full = path.join(dir, name);
            let size = 0;
            let mtime = null;
            try {
                const st = fs.statSync(full);
                size = st.size;
                mtime = st.mtime.toISOString();
            } catch {
                // ignore
            }
            return { name, size, mtime };
        })
        .sort((a, b) => String(b.mtime || '').localeCompare(String(a.mtime || '')));
}

function safePdfPath(name) {
    const base = path.basename(String(name || ''));
    if (!base || base !== String(name) || !base.toLowerCase().endsWith('.pdf')) {
        throw new Error('Ungültiger Dateiname');
    }
    const dir = path.resolve(getDownloadsDir());
    const full = path.resolve(dir, base);
    if (!full.startsWith(dir + path.sep) && full !== dir) {
        throw new Error('Ungültiger Pfad');
    }
    if (!fs.existsSync(full)) {
        throw new Error('Datei nicht gefunden');
    }
    return full;
}

function buildTargets(body) {
    const year = Number(body.year) || new Date().getFullYear();
    const inventory = scanYear(getDownloadsDir(), year);
    let months = Array.isArray(body.months) ? body.months.map(Number) : [];

    if (body.allMissing) {
        months = inventory.months.filter((month) => !month.present).map((month) => month.month);
    }

    months = [...new Set(months.filter((month) => month >= 1 && month <= 12))].sort((a, b) => a - b);

    return {
        year,
        targets: months.map((month) => ({ month, year })),
        monthLabels: months.map((month) => inventory.months[month - 1]?.label || String(month)),
    };
}

function startDownload(request) {
    if (jobRunning) {
        return { ok: false, error: t('errJobRunning') };
    }

    if (!isConfigured()) {
        return {
            ok: false,
            error: t('errNeedSetup'),
            needsSetup: true,
        };
    }

    const { targets, monthLabels, year } = buildTargets(request);

    if (request.allMissing && targets.length === 0) {
        return { ok: false, error: t('errNoMissingYear', { year }) };
    }

    if ((request.months?.length || request.allMissing) && targets.length === 0) {
        return { ok: false, error: t('errNoMonths') };
    }

    if (request.requireTargets && targets.length === 0) {
        return { ok: false, error: t('errTargets') };
    }

    jobRunning = true;
    jobCancelled = false;
    broadcast('status', { running: true });

    const scriptPath = path.join(__dirname, 'loga3-complete.js');
    const env = applySettingsToEnv({ ...process.env });
    const args = [scriptPath, '--once'];

    if (targets.length) {
        env.LOGA3_TARGETS = JSON.stringify(targets);
        env.LOGA3_REQUIRE_TARGETS = '1';
        for (const target of targets) {
            args.push('--period', `${target.year}-${String(target.month).padStart(2, '0')}`);
        }
        pushLog(t('logQueue', {
            count: targets.length,
            year,
            months: monthLabels.join(' → '),
        }));
    } else {
        pushLog(t('logCurrent'));
    }

    pushLog(t('log2fa'));

    jobChild = spawn(process.execPath, args, {
        cwd: APP_ROOT,
        env,
    });

    const handleOutput = (chunk) => {
        chunk.toString().split('\n').forEach(pushLog);
    };

    jobChild.stdout.on('data', handleOutput);
    jobChild.stderr.on('data', handleOutput);

    jobChild.on('close', (code, signal) => {
        jobRunning = false;
        jobChild = null;
        const cancelled = jobCancelled
            || signal === 'SIGTERM'
            || signal === 'SIGINT'
            || code === 130
            || code === 143;
        jobCancelled = false;

        if (cancelled) {
            broadcast('done', { ok: false, cancelled: true, code, signal });
        } else if (code === 0) {
            pushLog(t('logDone'));
            broadcast('done', { ok: true, code });
        } else {
            pushLog(t('logError', { code: code ?? signal ?? '?' }));
            broadcast('done', { ok: false, code, signal });
        }

        broadcast('status', { running: false });
    });

    return { ok: true, count: targets.length || 1, targets: targets.map((row) => `${String(row.month).padStart(2, '0')}/${row.year}`) };
}

function stopDownload() {
    if (!jobRunning || !jobChild) {
        return { ok: false, error: 'No job running.' };
    }
    jobCancelled = true;
    jobChild.kill('SIGTERM');
    pushLog(t('logCancelled'));
    return { ok: true };
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    try {
        if (url.pathname === '/api/status' && req.method === 'GET') {
            sendJson(res, 200, {
                running: jobRunning,
                downloadsDir: getDownloadsDir(),
                version: getAppVersion(),
                messages: getMessages(),
                ...getPublicSettings(),
            });
            return;
        }

        if (url.pathname === '/api/updates/check' && req.method === 'GET') {
            try {
                const result = await checkForAppUpdate(CONVERTER_DIR);
                sendJson(res, 200, result);
            } catch (error) {
                sendJson(res, 502, {
                    currentVersion: getAppVersion(),
                    updateAvailable: false,
                    error: error.message || String(error),
                });
            }
            return;
        }

        if (url.pathname === '/api/settings' && req.method === 'GET') {
            sendJson(res, 200, {
                messages: getMessages(),
                ...getPublicSettings(),
            });
            return;
        }

        if (url.pathname === '/api/settings' && req.method === 'POST') {
            const body = await readBody(req);
            if (body.locale) setLocale(body.locale);
            const saved = saveSettings({
                username: body.username,
                password: body.password,
                baseUrl: body.baseUrl,
                headless: body.headless,
                locale: body.locale,
                convert: body.convert,
            });
            pushLog(t('logCredentialsSaved', { username: saved.username }));
            sendJson(res, 200, {
                ok: true,
                messages: getMessages(),
                ...getPublicSettings(),
            });
            return;
        }

        if (url.pathname === '/api/years' && req.method === 'GET') {
            sendJson(res, 200, { years: getAvailableYears() });
            return;
        }

        if (url.pathname === '/api/inventory' && req.method === 'GET') {
            const year = Number(url.searchParams.get('year')) || new Date().getFullYear();
            sendJson(res, 200, scanYear(getDownloadsDir(), year));
            return;
        }

        if (url.pathname === '/api/download' && req.method === 'POST') {
            const body = await readBody(req);
            const result = startDownload(body);
            sendJson(res, result.ok ? 200 : 409, result);
            return;
        }

        if (url.pathname === '/api/stop' && req.method === 'POST') {
            const result = stopDownload();
            sendJson(res, result.ok ? 200 : 409, result);
            return;
        }

        if (url.pathname === '/api/open-downloads' && req.method === 'POST') {
            const dir = getDownloadsDir();
            const ok = openPath(dir);
            sendJson(res, ok ? 200 : 500, { ok, path: dir });
            return;
        }

        if (url.pathname === '/api/open-converter' && req.method === 'POST') {
            // Built-in convert tab — keep API for CLI/old clients; open local GUI convert view
            const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
            const localUrl = `http://${displayHost}:${PORT}/#calendar`;
            const ok = openPath(localUrl);
            sendJson(res, ok ? 200 : 500, { ok, url: localUrl });
            return;
        }

        if (url.pathname === '/api/downloads' && req.method === 'GET') {
            sendJson(res, 200, {
                dir: getDownloadsDir(),
                files: listDownloadedPdfs(),
            });
            return;
        }

        if (url.pathname === '/api/downloads/file' && req.method === 'GET') {
            const name = url.searchParams.get('name');
            try {
                const filePath = safePdfPath(name);
                const content = fs.readFileSync(filePath);
                res.writeHead(200, {
                    'Content-Type': 'application/pdf',
                    'Content-Length': content.length,
                    'Content-Disposition': `inline; filename="${path.basename(filePath)}"`,
                });
                res.end(content);
            } catch (error) {
                sendJson(res, 404, { error: error.message });
            }
            return;
        }

        if (url.pathname === '/api/hospitals' && req.method === 'GET') {
            sendJson(res, 200, { hospitals: listHospitals(CONVERTER_DIR) });
            return;
        }

        if (url.pathname.startsWith('/api/hospital-assets/') && req.method === 'GET') {
            const rel = decodeURIComponent(url.pathname.slice('/api/hospital-assets/'.length));
            const slash = rel.indexOf('/');
            if (slash <= 0) {
                sendJson(res, 400, { error: 'Pfad: /api/hospital-assets/<id>/…' });
                return;
            }
            const hospitalId = rel.slice(0, slash);
            const assetPath = rel.slice(slash + 1);
            try {
                const { path: filePath, content } = readHospitalAsset(CONVERTER_DIR, hospitalId, assetPath);
                const ext = path.extname(filePath);
                res.writeHead(200, {
                    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
                    'Cache-Control': 'no-cache',
                });
                res.end(content);
            } catch (error) {
                sendJson(res, 404, { error: error.message });
            }
            return;
        }

        if (url.pathname === '/api/user-mapping' && req.method === 'GET') {
            const hospital = url.searchParams.get('hospital') || '';
            const group = url.searchParams.get('group') || '';
            const area = url.searchParams.get('area') || '';
            sendJson(res, 200, {
                overlay: loadUserMappingOverlay(hospital, group, area),
            });
            return;
        }

        if (url.pathname === '/api/user-mapping' && req.method === 'PUT') {
            const body = await readBody(req);
            const hospital = body.hospital || '';
            const group = body.group || '';
            const area = body.area || '';
            if (!hospital || !group || !area) {
                sendJson(res, 400, { error: 'hospital, group, area erforderlich' });
                return;
            }
            const existing = loadUserMappingOverlay(hospital, group, area) || { presets: {}, colors: {} };
            const next = mergeMapping(existing, {
                colors: body.colors || {},
                presets: body.presets || {},
            });
            const saved = saveUserMappingOverlay(hospital, group, area, next);
            sendJson(res, 200, { ok: true, overlay: saved });
            return;
        }

        if (url.pathname === '/api/user-mapping' && req.method === 'DELETE') {
            const hospital = url.searchParams.get('hospital') || '';
            const group = url.searchParams.get('group') || '';
            const area = url.searchParams.get('area') || '';
            sendJson(res, 200, deleteUserMappingOverlay(hospital, group, area));
            return;
        }

        if (url.pathname === '/api/packs' && req.method === 'GET') {
            sendJson(res, 200, {
                packs: listInstalledPacks(),
                packsDir: path.join(getSettingsDir(), 'packs'),
            });
            return;
        }

        if (url.pathname === '/api/packs/catalog' && req.method === 'GET') {
            try {
                const cfgPath = path.join(CONVERTER_DIR, 'src', 'config.json');
                let manifestUrl = '';
                let githubRepo = '';
                try {
                    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                    manifestUrl = cfg.packsManifestUrl || '';
                    githubRepo = cfg.githubRepo || '';
                } catch { /* ignore */ }
                if (!manifestUrl && githubRepo) {
                    // Fallback: raw main/packs/manifest.json
                    const m = String(githubRepo).match(/github\.com[/:]([^/]+)\/([^/#]+)/i);
                    if (m) {
                        manifestUrl = `https://raw.githubusercontent.com/${m[1]}/${m[2].replace(/\.git$/, '')}/main/packs/manifest.json`;
                    }
                }
                const catalog = await fetchPacksCatalog(manifestUrl);
                sendJson(res, 200, { ...catalog, githubRepo });
            } catch (error) {
                sendJson(res, 502, { error: error.message || String(error) });
            }
            return;
        }

        if (url.pathname === '/api/packs/install' && req.method === 'POST') {
            const buf = await readRawBody(req);
            if (!buf.length) {
                sendJson(res, 400, { error: 'ZIP-Body fehlt' });
                return;
            }
            const tmpZip = path.join(getSettingsDir(), `pack-upload-${Date.now()}.zip`);
            try {
                if (!fs.existsSync(getSettingsDir())) fs.mkdirSync(getSettingsDir(), { recursive: true });
                fs.writeFileSync(tmpZip, buf);
                const installed = installPackFromZip(tmpZip);
                pushLog(`📦 Pack installiert: ${installed.name} (${installed.id})`);
                sendJson(res, 200, { ok: true, ...installed, hospitals: listHospitals(CONVERTER_DIR) });
            } catch (error) {
                sendJson(res, 400, { error: error.message || String(error) });
            } finally {
                try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }
            }
            return;
        }

        if (url.pathname === '/api/packs/install-url' && req.method === 'POST') {
            try {
                const body = await readBody(req);
                if (!body.zipUrl) {
                    sendJson(res, 400, { error: 'zipUrl fehlt' });
                    return;
                }
                const installed = await installPackFromUrl(body.zipUrl);
                pushLog(`📦 Pack von URL: ${installed.name} (${installed.id})`);
                sendJson(res, 200, { ok: true, ...installed, hospitals: listHospitals(CONVERTER_DIR) });
            } catch (error) {
                sendJson(res, 400, { error: error.message || String(error) });
            }
            return;
        }

        if (url.pathname.startsWith('/api/packs/') && req.method === 'DELETE') {
            const id = decodeURIComponent(url.pathname.slice('/api/packs/'.length));
            if (id === 'catalog' || id === 'install' || id === 'install-url') {
                sendJson(res, 405, { error: 'Method not allowed' });
                return;
            }
            try {
                const result = deletePack(id);
                pushLog(`🗑️ Pack entfernt: ${result.id}`);
                sendJson(res, 200, { ...result, hospitals: listHospitals(CONVERTER_DIR) });
            } catch (error) {
                sendJson(res, 404, { error: error.message });
            }
            return;
        }

        if (url.pathname === '/api/events' && req.method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
            res.write(`event: status\ndata: ${JSON.stringify({ running: jobRunning })}\n\n`);
            sseClients.add(res);
            req.on('close', () => sseClients.delete(res));
            return;
        }

        if (req.method === 'GET') {
            serveStatic(req, res);
            return;
        }

        sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
        sendJson(res, 400, { error: error.message });
    }
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use (old GUI server still running).`);
        console.error('   Stop with: npm run gui:stop');
        console.error('   or: kill $(lsof -ti :3847)');
        process.exit(1);
    }
    throw error;
});

server.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    const url = `http://${displayHost}:${PORT}`;
    if (!fs.existsSync(path.join(GUI_DIR, 'index.html'))) {
        console.error(`❌ GUI files missing at ${GUI_DIR}`);
        console.error('   Portable builds need gui/ next to loga3-gui-server.js');
        process.exit(1);
    }
    console.log(`LOGA3 GUI: ${url} (bind ${HOST})`);
    console.log(`Downloads: ${getDownloadsDir()}`);
    if (!isConfigured()) {
        console.log('ℹ️  No login yet — open the GUI and save credentials (Einstellungen).');
    }
    console.log('Stop: Ctrl+C here, or in another terminal: npm run gui:stop');

    if (process.env.LOGA3_OPEN_BROWSER === '1' || process.env.LOGA3_OPEN_BROWSER === 'true') {
        const opener = process.platform === 'win32'
            ? 'cmd'
            : process.platform === 'darwin' ? 'open' : 'xdg-open';
        const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
        try {
            spawn(opener, args, { detached: true, stdio: 'ignore' }).unref();
        } catch {
            // ignore
        }
    }
});

function shutdown(signal) {
    console.log(`\n🛑 ${signal} — shutting down server...`);

    for (const client of sseClients) {
        try { client.end(); } catch { /* ignore */ }
    }
    sseClients.clear();

    if (jobChild) {
        jobChild.kill('SIGTERM');
        setTimeout(() => {
            if (jobChild) jobChild.kill('SIGKILL');
        }, 2000);
    }

    server.close(() => {
        console.log('✅ GUI server stopped.');
        process.exit(0);
    });

    setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
