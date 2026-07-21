#!/usr/bin/env node
/**
 * Assemble portable desktop packages (must run on the target OS):
 *   node scripts/build-desktop.js --target linux   # → AppImage + tar.gz
 *   node scripts/build-desktop.js --target win32   # → zip with Loga3.exe
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { createWriteStream } = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE_VERSION = process.env.LOGA3_NODE_VERSION || '20.18.1';
const DIST = path.join(ROOT, 'dist');

const APP_FILES = [
    'package.json',
    'package-lock.json',
    '.env.example',
    'gui',
    'converter',
];

/** All src/loga3-*.js modules are packaged (avoids forgetting new files like i18n/log). */
function listSrcFiles() {
    return fs.readdirSync(path.join(ROOT, 'src'))
        .filter((name) => /^loga3-.*\.js$/.test(name))
        .sort();
}

function parseArgs(argv) {
    let target = process.platform === 'win32' ? 'win32' : 'linux';
    let stageOnly = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--target' && argv[i + 1]) target = argv[++i];
        if (argv[i] === '--stage-only') stageOnly = true;
    }
    if (!stageOnly && !['linux', 'win32'].includes(target)) {
        throw new Error(`Unsupported --target ${target} (use linux|win32)`);
    }
    return { target, stageOnly };
}

function rmrf(p) {
    fs.rmSync(p, { recursive: true, force: true });
}

function mkdirp(p) {
    fs.mkdirSync(p, { recursive: true });
}

function copyRecursive(src, dest) {
    const st = fs.statSync(src);
    if (st.isDirectory()) {
        mkdirp(dest);
        for (const name of fs.readdirSync(src)) {
            copyRecursive(path.join(src, name), path.join(dest, name));
        }
        return;
    }
    mkdirp(path.dirname(dest));
    fs.copyFileSync(src, dest);
}

function download(url, dest) {
    return new Promise((resolve, reject) => {
        mkdirp(path.dirname(dest));
        const file = createWriteStream(dest);
        const getter = url.startsWith('https') ? https : http;
        const req = getter.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlinkSync(dest);
                download(res.headers.location, dest).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`Download failed ${res.statusCode}: ${url}`));
                return;
            }
            res.pipe(file);
            file.on('finish', () => file.close(() => resolve(dest)));
        });
        req.on('error', reject);
    });
}

function run(cmd, args, opts = {}) {
    console.log(`$ ${cmd} ${args.join(' ')}`);
    const result = spawnSync(cmd, args, {
        stdio: 'inherit',
        encoding: 'utf8',
        shell: opts.shell ?? (process.platform === 'win32'),
        ...opts,
    });
    if (result.status !== 0) {
        throw new Error(`Command failed (${result.status}): ${cmd} ${args.join(' ')}`);
    }
}

function writeDesktopReadme(dir, kind) {
    fs.writeFileSync(path.join(dir, 'README-DESKTOP.txt'), `LOGA3 portable (${kind})
=======================

1. Starten:
   - Windows: Loga3.exe doppelklicken
   - Linux: chmod +x Loga3-*.AppImage && ./Loga3-*.AppImage
2. Im Browser öffnet sich die Oberfläche (sonst http://127.0.0.1:3847)
3. Beim ersten Start: Benutzername + Passwort eingeben → Speichern
4. Monate auswählen → „Ausgewählte laden“

PDFs:
   - Windows: Ordner downloads/ neben Loga3.exe
   - AppImage: Ordner loga3-data/ neben der AppImage-Datei

Kein .env nötig — Zugang in der GUI speichern (Einstellungen).
Optional für Profis: .env neben der App (LOGA3_USERNAME / LOGA3_PASSWORD).
`);
}

async function fetchNode(target, cacheDir) {
    mkdirp(cacheDir);
    if (target === 'win32') {
        const name = `node-v${NODE_VERSION}-win-x64`;
        const zip = path.join(cacheDir, `${name}.zip`);
        const url = `https://nodejs.org/dist/v${NODE_VERSION}/${name}.zip`;
        if (!fs.existsSync(zip)) {
            console.log(`Downloading ${url}`);
            await download(url, zip);
        }
        const extractTo = path.join(cacheDir, name);
        if (!fs.existsSync(path.join(extractTo, 'node.exe'))) {
            rmrf(extractTo);
            run('powershell', [
                '-NoProfile', '-Command',
                `Expand-Archive -Path '${zip.replace(/'/g, "''")}' -DestinationPath '${cacheDir.replace(/'/g, "''")}' -Force`,
            ], { shell: false });
        }
        return extractTo;
    }

    const name = `node-v${NODE_VERSION}-linux-x64`;
    const tar = path.join(cacheDir, `${name}.tar.xz`);
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/${name}.tar.xz`;
    if (!fs.existsSync(tar)) {
        console.log(`Downloading ${url}`);
        await download(url, tar);
    }
    const extractTo = path.join(cacheDir, name);
    if (!fs.existsSync(path.join(extractTo, 'bin', 'node'))) {
        rmrf(extractTo);
        run('tar', ['-xJf', tar, '-C', cacheDir], { shell: false });
    }
    return extractTo;
}

function stageApp(appDir) {
    const srcFiles = listSrcFiles();
    if (!srcFiles.includes('loga3-gui-server.js')) {
        throw new Error('src/loga3-gui-server.js missing — cannot build desktop package');
    }

    rmrf(appDir);
    mkdirp(appDir);
    for (const rel of APP_FILES) {
        const src = path.join(ROOT, rel);
        if (!fs.existsSync(src)) throw new Error(`Missing required file: ${rel}`);
        copyRecursive(src, path.join(appDir, rel));
    }
    for (const rel of srcFiles) {
        const src = path.join(ROOT, 'src', rel);
        if (!fs.existsSync(src)) throw new Error(`Missing required file: src/${rel}`);
        // Flatten into app/ so portable layout stays simple (gui-server next to node_modules)
        copyRecursive(src, path.join(appDir, rel));
    }
    copyRecursive(
        path.join(ROOT, 'scripts', 'desktop-entry.js'),
        path.join(appDir, 'desktop-entry.js')
    );
    // Patch package.json scripts for flattened layout
    const pkgPath = path.join(appDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.main = 'loga3-automation.js';
    pkg.scripts = {
        ...pkg.scripts,
        gui: 'node loga3-gui-server.js',
        download: 'node loga3-complete.js --once',
    };
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    run('npm', ['ci', '--omit=dev'], { cwd: appDir });
    validateStagedApp(appDir, srcFiles);
}

/**
 * Fail the package build if the flattened app/ tree is incomplete or unloadable.
 * Catches missing modules (e.g. new require('./loga3-i18n')) before tagging a release.
 */
function validateStagedApp(appDir, srcFiles = listSrcFiles()) {
    const required = [...srcFiles, 'desktop-entry.js', 'package.json', 'gui/index.html', 'gui/app.js', 'gui/convert-tab.js', 'converter/src/index.js'];
    for (const rel of required) {
        const full = path.join(appDir, rel);
        if (!fs.existsSync(full)) {
            throw new Error(`Desktop stage incomplete — missing ${rel}`);
        }
    }

    const jsFiles = fs.readdirSync(appDir).filter((name) => name.endsWith('.js'));
    for (const file of jsFiles) {
        const text = fs.readFileSync(path.join(appDir, file), 'utf8');
        for (const match of text.matchAll(/require\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)) {
            let rel = match[1];
            if (rel.startsWith('./gui/') || rel.startsWith('./node_modules/')) continue;
            if (!rel.endsWith('.js')) rel += '.js';
            const target = path.normalize(path.join(appDir, rel));
            if (!target.startsWith(appDir)) continue;
            if (!fs.existsSync(target)) {
                throw new Error(`Desktop stage broken: ${file} requires ${match[1]} (not packaged)`);
            }
        }
    }

    // Load core modules without starting the HTTP server / browser.
    const smoke = [
        "const fs=require('fs');const path=require('path');",
        "const gui=path.join(process.cwd(),'gui','index.html');",
        "if(!fs.existsSync(gui)) throw new Error('gui/index.html missing next to staged server');",
        "require('./loga3-i18n');",
        "require('./loga3-log');",
        "require('./loga3-settings');",
        "require('./loga3-inventory');",
        "require('./loga3-period');",
        "require('./loga3-cli-args');",
        "require('./loga3-complete');",
        "require('./desktop-entry.js');",
        "console.log('DESKTOP_STAGE_OK');",
    ].join('');

    const result = spawnSync(process.execPath, ['-e', smoke], {
        cwd: appDir,
        encoding: 'utf8',
        env: { ...process.env },
    });
    if (result.status !== 0 || !String(result.stdout || '').includes('DESKTOP_STAGE_OK')) {
        throw new Error(
            `Desktop stage smoke load failed:\n${result.stderr || result.stdout || result.error}`
        );
    }
    console.log(`✅ Desktop stage validated (${srcFiles.length} src modules)`);
}

async function runStageValidation() {
    const appDir = path.join(DIST, 'stage-validate', 'app');
    mkdirp(DIST);
    console.log('Staging desktop app/ for validation (no AppImage / Playwright)...');
    stageApp(appDir);
    console.log(`Validated stage at ${appDir}`);
    return appDir;
}

function installBrowsers(portableRoot, appDir) {
    const browsers = path.join(portableRoot, 'ms-playwright');
    rmrf(browsers);
    mkdirp(browsers);
    run('npx', ['playwright', 'install', 'chromium'], {
        cwd: appDir,
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers },
    });
}

async function buildWin32() {
    if (process.platform !== 'win32') {
        throw new Error('Windows packages must be built on Windows (Playwright Chromium is OS-specific)');
    }

    const outName = 'loga3-win-x64';
    const outDir = path.join(DIST, outName);
    rmrf(outDir);
    mkdirp(outDir);

    const nodeDir = await fetchNode('win32', path.join(DIST, 'cache'));
    copyRecursive(nodeDir, path.join(outDir, 'node'));

    const appDir = path.join(outDir, 'app');
    stageApp(appDir);
    installBrowsers(outDir, appDir);

    copyRecursive(path.join(ROOT, '.env.example'), path.join(outDir, '.env.example'));
    writeDesktopReadme(outDir, 'Windows');
    mkdirp(path.join(outDir, 'downloads'));
    mkdirp(path.join(outDir, 'logs'));

    const entry = path.join(ROOT, 'scripts', 'desktop-entry.js');
    const exeOut = path.join(outDir, 'Loga3.exe');
    run('npx', [
        '--yes', '@yao-pkg/pkg@5.16.1',
        entry,
        '--targets', 'node20-win-x64',
        '--output', exeOut,
    ]);

    fs.writeFileSync(path.join(outDir, 'Loga3.cmd'), [
        '@echo off',
        'cd /d "%~dp0"',
        'set LOGA3_PORTABLE_ROOT=%~dp0',
        '"%~dp0node\\node.exe" "%~dp0app\\desktop-entry.js"',
        '',
    ].join('\r\n'));

    const zipPath = path.join(DIST, `${outName}.zip`);
    rmrf(zipPath);
    run('powershell', [
        '-NoProfile', '-Command',
        `Compress-Archive -Path '${outDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ], { shell: false });

    console.log(`\nWindows package: ${zipPath}`);
    return zipPath;
}

async function buildLinux() {
    if (process.platform !== 'linux') {
        throw new Error('Linux AppImage must be built on Linux (Playwright Chromium is OS-specific)');
    }

    const outName = 'loga3-linux-x64';
    const stage = path.join(DIST, outName);
    rmrf(stage);
    mkdirp(stage);

    const nodeDir = await fetchNode('linux', path.join(DIST, 'cache'));
    copyRecursive(nodeDir, path.join(stage, 'node'));

    const appDir = path.join(stage, 'app');
    stageApp(appDir);
    installBrowsers(stage, appDir);
    copyRecursive(path.join(ROOT, '.env.example'), path.join(stage, '.env.example'));
    writeDesktopReadme(stage, 'Linux');
    mkdirp(path.join(stage, 'downloads'));
    mkdirp(path.join(stage, 'logs'));

    const appImageDir = path.join(DIST, 'Loga3.AppDir');
    rmrf(appImageDir);
    mkdirp(path.join(appImageDir, 'usr', 'share', 'applications'));
    mkdirp(path.join(appImageDir, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps'));

    const payload = path.join(appImageDir, 'usr', 'lib', 'loga3');
    copyRecursive(stage, payload);

    const appRun = `#!/bin/bash
set -e
HERE="$(dirname "$(readlink -f "$0")")"
export LOGA3_BUNDLE_ROOT="$HERE/usr/lib/loga3"
export PLAYWRIGHT_BROWSERS_PATH="$LOGA3_BUNDLE_ROOT/ms-playwright"
export LOGA3_GUI_HOST="\${LOGA3_GUI_HOST:-127.0.0.1}"
export LOGA3_HEADLESS="\${LOGA3_HEADLESS:-0}"

# AppImage payload is read-only — keep secrets/data next to the .AppImage file
if [[ -n "\${APPIMAGE:-}" ]]; then
  DATA_ROOT="$(dirname "$APPIMAGE")/loga3-data"
  ENV_FILE="$(dirname "$APPIMAGE")/.env"
else
  DATA_ROOT="$LOGA3_BUNDLE_ROOT"
  ENV_FILE="$LOGA3_BUNDLE_ROOT/.env"
fi

mkdir -p "$DATA_ROOT/downloads" "$DATA_ROOT/logs"
export LOGA3_PORTABLE_ROOT="$DATA_ROOT"
export LOGA3_DOWNLOADS_DIR="\${LOGA3_DOWNLOADS_DIR:-$DATA_ROOT/downloads}"
export LOGA3_LOGS_DIR="\${LOGA3_LOGS_DIR:-$DATA_ROOT/logs}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

cd "$LOGA3_BUNDLE_ROOT"
exec "$LOGA3_BUNDLE_ROOT/node/bin/node" "$LOGA3_BUNDLE_ROOT/app/desktop-entry.js"
`;
    fs.writeFileSync(path.join(appImageDir, 'AppRun'), appRun, { mode: 0o755 });

    const desktop = `[Desktop Entry]
Name=LOGA3
Exec=AppRun
Icon=loga3
Type=Application
Categories=Office;Utility;
Comment=LOGA3 Zeitprotokoll downloader
Terminal=true
`;
    fs.writeFileSync(path.join(appImageDir, 'loga3.desktop'), desktop);
    fs.writeFileSync(path.join(appImageDir, 'usr', 'share', 'applications', 'loga3.desktop'), desktop);

    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
    );
    fs.writeFileSync(path.join(appImageDir, 'loga3.png'), png);
    fs.copyFileSync(
        path.join(appImageDir, 'loga3.png'),
        path.join(appImageDir, 'usr', 'share', 'icons', 'hicolor', '256x256', 'apps', 'loga3.png')
    );

    const toolPath = path.join(DIST, 'cache', 'appimagetool-x86_64.AppImage');
    if (!fs.existsSync(toolPath)) {
        const url = 'https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage';
        console.log(`Downloading ${url}`);
        await download(url, toolPath);
        fs.chmodSync(toolPath, 0o755);
    }

    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const appImageOut = path.join(DIST, `Loga3-${version}-x86_64.AppImage`);
    rmrf(appImageOut);

    run(toolPath, [appImageDir, appImageOut], {
        shell: false,
        env: {
            ...process.env,
            ARCH: 'x86_64',
            APPIMAGE_EXTRACT_AND_RUN: '1',
        },
    });
    fs.chmodSync(appImageOut, 0o755);

    const tarPath = path.join(DIST, `${outName}.tar.gz`);
    rmrf(tarPath);
    run('tar', ['-czf', tarPath, outName], { cwd: DIST, shell: false });

    console.log(`\nAppImage: ${appImageOut}`);
    console.log(`tarball:  ${tarPath}`);
    return appImageOut;
}

async function main() {
    const { target, stageOnly } = parseArgs(process.argv.slice(2));
    mkdirp(DIST);
    if (stageOnly) {
        await runStageValidation();
        return;
    }
    console.log(`Building desktop package for ${target} (Node ${NODE_VERSION})...`);
    if (target === 'win32') await buildWin32();
    else await buildLinux();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
