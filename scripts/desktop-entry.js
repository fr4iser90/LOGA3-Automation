#!/usr/bin/env node
/**
 * Portable desktop entry (Windows .exe via pkg, or direct node).
 * Spawns the bundled Node runtime against loga3-gui-server.js.
 *
 * Env:
 *   LOGA3_BUNDLE_ROOT  — where node/ + app/ + ms-playwright/ live (AppImage)
 *   LOGA3_PORTABLE_ROOT — writable data root (.env, downloads, logs)
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function bundleRoot() {
    if (process.env.LOGA3_BUNDLE_ROOT) {
        return path.resolve(process.env.LOGA3_BUNDLE_ROOT);
    }
    if (typeof process.pkg !== 'undefined') {
        return path.dirname(process.execPath);
    }
    if (process.env.LOGA3_PORTABLE_ROOT) {
        const candidate = path.resolve(process.env.LOGA3_PORTABLE_ROOT);
        if (fs.existsSync(path.join(candidate, 'app', 'loga3-gui-server.js'))) {
            return candidate;
        }
    }
    return path.resolve(__dirname, '..');
}

function dataRoot(bundle) {
    if (process.env.LOGA3_PORTABLE_ROOT) {
        return path.resolve(process.env.LOGA3_PORTABLE_ROOT);
    }
    return bundle;
}

function main() {
    const bundle = bundleRoot();
    const data = dataRoot(bundle);
    const appDir = path.join(bundle, 'app');
    const isWin = process.platform === 'win32';
    const nodeBin = isWin
        ? path.join(bundle, 'node', 'node.exe')
        : path.join(bundle, 'node', 'bin', 'node');

    if (!fs.existsSync(nodeBin)) {
        console.error(`Bundled Node not found: ${nodeBin}`);
        process.exit(1);
    }
    if (!fs.existsSync(path.join(appDir, 'loga3-gui-server.js'))) {
        console.error(`App not found under: ${appDir}`);
        process.exit(1);
    }

    for (const dir of ['downloads', 'logs']) {
        const p = path.join(data, dir);
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }

    process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH
        || path.join(bundle, 'ms-playwright');
    process.env.LOGA3_DOWNLOADS_DIR = process.env.LOGA3_DOWNLOADS_DIR
        || path.join(data, 'downloads');
    process.env.LOGA3_LOGS_DIR = process.env.LOGA3_LOGS_DIR
        || path.join(data, 'logs');
    process.env.LOGA3_GUI_HOST = process.env.LOGA3_GUI_HOST || '127.0.0.1';
    if (process.env.LOGA3_HEADLESS === undefined) {
        process.env.LOGA3_HEADLESS = '0';
    }
    process.env.LOGA3_BUNDLE_ROOT = bundle;
    process.env.LOGA3_PORTABLE_ROOT = data;
    if (process.env.LOGA3_OPEN_BROWSER === undefined) {
        process.env.LOGA3_OPEN_BROWSER = '1';
    }

    const dotenvPath = path.join(data, '.env');
    const dotenvBeside = path.join(path.dirname(data), '.env');
    if (!fs.existsSync(dotenvPath) && !fs.existsSync(dotenvBeside) && !process.env.LOGA3_USERNAME) {
        console.warn('No .env found. Copy .env.example → .env (next to the AppImage or inside the zip folder).');
    }

    console.log(`LOGA3 bundle: ${bundle}`);
    console.log(`LOGA3 data:   ${data}`);
    console.log(`Starting GUI via ${nodeBin}`);

    const child = spawn(nodeBin, [path.join(appDir, 'loga3-gui-server.js')], {
        cwd: appDir,
        stdio: 'inherit',
        env: process.env,
        windowsHide: false,
    });

    const stop = (signal) => {
        if (!child.killed) child.kill(signal);
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));

    child.on('exit', (code, signal) => {
        if (signal) process.exit(1);
        process.exit(code || 0);
    });
}

main();
