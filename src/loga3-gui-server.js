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
});

const { scanYear, getAvailableYears, getDownloadsDir } = require('./loga3-inventory');
const {
    getPublicSettings,
    saveSettings,
    isConfigured,
    applySettingsToEnv,
} = require('./loga3-settings');
const { openPath, DEFAULT_CONVERTER_URL } = require('./loga3-cli-args');

const PORT = Number(process.env.LOGA3_GUI_PORT) || 3847;
const HOST = process.env.LOGA3_GUI_HOST || '127.0.0.1';
const PROJECT_ROOT = path.join(__dirname, '..');
const GUI_DIR = path.join(PROJECT_ROOT, 'gui');
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
};

let jobRunning = false;
let jobChild = null;
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

function serveStatic(req, res) {
    const pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;
    const filePath = path.join(GUI_DIR, pathname === '/' ? 'index.html' : pathname);

    if (!filePath.startsWith(GUI_DIR)) {
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
        return { ok: false, error: 'Ein Download läuft bereits.' };
    }

    if (!isConfigured()) {
        return {
            ok: false,
            error: 'Bitte zuerst LOGA3-Zugangsdaten unter „Einstellungen“ speichern.',
            needsSetup: true,
        };
    }

    const { targets, monthLabels, year } = buildTargets(request);

    if (request.allMissing && targets.length === 0) {
        return { ok: false, error: `Keine fehlenden Monate für ${year}.` };
    }

    if ((request.months?.length || request.allMissing) && targets.length === 0) {
        return { ok: false, error: 'Keine Monate ausgewählt.' };
    }

    if (request.requireTargets && targets.length === 0) {
        return { ok: false, error: 'Monatsliste konnte nicht erzeugt werden.' };
    }

    jobRunning = true;
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
        pushLog(`▶ Starting ${targets.length} month(s) for ${year}:`);
        pushLog(`   ${monthLabels.join(' → ')}`);
    } else {
        pushLog('▶ Starting download for current LOGA3 month...');
    }

    pushLog('ℹ️  If 2FA is required: confirm in the browser window.');

    jobChild = spawn(process.execPath, args, {
        cwd: PROJECT_ROOT,
        env,
    });

    const handleOutput = (chunk) => {
        chunk.toString().split('\n').forEach(pushLog);
    };

    jobChild.stdout.on('data', handleOutput);
    jobChild.stderr.on('data', handleOutput);

    jobChild.on('close', (code) => {
        jobRunning = false;
        jobChild = null;

        if (code === 0) {
            pushLog('✅ All downloads complete. Refreshing inventory...');
            broadcast('done', { ok: true, code });
        } else {
            pushLog(`❌ Error (exit code ${code})`);
            broadcast('done', { ok: false, code });
        }

        broadcast('status', { running: false });
    });

    return { ok: true, count: targets.length || 1, targets: targets.map((t) => `${String(t.month).padStart(2, '0')}/${t.year}`) };
}

function stopDownload() {
    if (!jobRunning || !jobChild) {
        return { ok: false, error: 'No job running.' };
    }
    jobChild.kill('SIGTERM');
    pushLog('🛑 Job cancelled.');
    return { ok: true };
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
                ...getPublicSettings(),
            });
            return;
        }

        if (url.pathname === '/api/settings' && req.method === 'GET') {
            sendJson(res, 200, getPublicSettings());
            return;
        }

        if (url.pathname === '/api/settings' && req.method === 'POST') {
            const body = await readBody(req);
            const saved = saveSettings({
                username: body.username,
                password: body.password,
                headless: body.headless,
            });
            pushLog(`✅ Zugangsdaten gespeichert (${saved.username}).`);
            sendJson(res, 200, { ok: true, ...getPublicSettings() });
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
            const converterUrl = process.env.LOGA3_CONVERTER_URL || DEFAULT_CONVERTER_URL;
            const ok = openPath(converterUrl);
            sendJson(res, ok ? 200 : 500, { ok, url: converterUrl });
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
