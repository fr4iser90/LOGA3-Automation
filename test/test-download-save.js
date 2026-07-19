#!/usr/bin/env node
/**
 * Full download-path test suite:
 * 1) getDownloadsDir resolution
 * 2) single saveAs → named file in Downloads (fixed path)
 * 3) double saveAs race (old bug) — second save must fail or lose
 * 4) workflow save naming pattern juli_2026.pdf style
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { getDownloadsDir, getLastNMonths, getNextNMonths } = require('../src/loga3-inventory');
const { periodToFilename } = require('../src/loga3-period');
const { parseTargets, parseCliOptions, parseMonthsList, applyOutDir } = require('../src/loga3-cli-args');

function startPdfServer() {
    const pdfBody = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const server = http.createServer((req, res) => {
        if (req.url === '/file.pdf') {
            res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="ece11c83-generic.pdf"',
                'Content-Length': pdfBody.length,
            });
            res.end(pdfBody);
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<a id="dl" href="/file.pdf">Herunterladen</a>');
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, pdfBody }));
    });
}

async function testDownloadsDir() {
    const dir = getDownloadsDir();
    assert.ok(dir, 'downloads dir empty');
    assert.ok(fs.existsSync(dir), `downloads dir missing: ${dir}`);
    console.log(`PASS getDownloadsDir → ${dir}`);
    return dir;
}

async function testSingleSaveAs(downloadsDir, port) {
    const filename = periodToFilename(7, 2026);
    assert.strictEqual(filename, 'juli_2026');
    const savePath = path.join(downloadsDir, `${filename}.pdf`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        acceptDownloads: true,
        downloadsPath: downloadsDir,
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.click('#dl');
    const download = await downloadPromise;

    assert.ok(download.suggestedFilename().includes('ece11c83') || download.suggestedFilename().endsWith('.pdf'));

    await download.saveAs(savePath);
    const stat = await fs.promises.stat(savePath);
    assert.ok(stat.size > 0, 'saved file empty');
    assert.strictEqual(path.basename(savePath), 'juli_2026.pdf');

    console.log(`PASS single saveAs → ${savePath} (${stat.size} bytes)`);
    await browser.close();
    await fs.promises.unlink(savePath);
}

async function testDoubleSaveAsRace(downloadsDir, port) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        acceptDownloads: true,
        downloadsPath: downloadsDir,
    });

    let handlerOk = false;
    let handlerErr = null;
    context.on('download', async (download) => {
        try {
            await download.saveAs(path.join(downloadsDir, 'race-handler.pdf'));
            handlerOk = true;
        } catch (error) {
            handlerErr = error.message;
        }
    });

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.click('#dl');
    const download = await downloadPromise;

    let pipelineOk = false;
    let pipelineErr = null;
    try {
        await download.saveAs(path.join(downloadsDir, 'juli_2026_race.pdf'));
        pipelineOk = true;
    } catch (error) {
        pipelineErr = error.message;
    }

    await new Promise((r) => setTimeout(r, 800));

    const bothSucceeded = handlerOk && pipelineOk
        && fs.existsSync(path.join(downloadsDir, 'race-handler.pdf'))
        && fs.existsSync(path.join(downloadsDir, 'juli_2026_race.pdf'));

    assert.ok(!bothSucceeded, 'both saveAs succeeded — race would not explain missing files');
    console.log(`PASS double-saveAs race (handlerOk=${handlerOk}, pipelineOk=${pipelineOk}, handlerErr=${handlerErr || '-'}, pipelineErr=${pipelineErr || '-'})`);

    for (const name of ['race-handler.pdf', 'juli_2026_race.pdf']) {
        const full = path.join(downloadsDir, name);
        if (fs.existsSync(full)) await fs.promises.unlink(full);
    }
    await browser.close();
}

async function testModulesLoad() {
    require('../src/loga3-workflow.js');
    require('../src/loga3-automation.js');
    require('../src/loga3-complete.js');
    require('../src/loga3-cli-args.js');
    require('../src/loga3-inventory.js');
    require('../src/loga3-period.js');
    require('../src/loga3-settings.js');
    console.log('PASS modules load');
}

function testLast3MonthsCli() {
    const jul = getLastNMonths(3, new Date(2026, 6, 17));
    assert.deepStrictEqual(jul, [
        { month: 5, year: 2026 },
        { month: 6, year: 2026 },
        { month: 7, year: 2026 },
    ]);

    const jan = getLastNMonths(3, new Date(2026, 0, 5));
    assert.deepStrictEqual(jan, [
        { month: 11, year: 2025 },
        { month: 12, year: 2025 },
        { month: 1, year: 2026 },
    ]);

    const cli = parseTargets(['--last', '3'], {});
    assert.strictEqual(cli.length, 3);

    const nextJul = getNextNMonths(3, new Date(2026, 6, 17));
    assert.deepStrictEqual(nextJul, [
        { month: 8, year: 2026 },
        { month: 9, year: 2026 },
        { month: 10, year: 2026 },
    ]);

    const nextNov = getNextNMonths(3, new Date(2026, 10, 5));
    assert.deepStrictEqual(nextNov, [
        { month: 12, year: 2026 },
        { month: 1, year: 2027 },
        { month: 2, year: 2027 },
    ]);

    const cliNext = parseTargets(['--next', '3'], {});
    assert.strictEqual(cliNext.length, 3);

    const months = parseMonthsList('2026-05,06/2026, 2026-7');
    assert.deepStrictEqual(months, [
        { year: 2026, month: 5 },
        { month: 6, year: 2026 },
        { year: 2026, month: 7 },
    ]);

    const fetchOpts = parseCliOptions([
        'fetch', '--months', '2026-05,2026-06', '--out', '/tmp/loga3-pdfs-test', '--open-folder',
    ], {});
    assert.deepStrictEqual(fetchOpts.targets, [
        { month: 5, year: 2026 },
        { month: 6, year: 2026 },
    ]);
    assert.ok(fetchOpts.outDir.endsWith('loga3-pdfs-test'));
    assert.strictEqual(fetchOpts.openFolder, true);

    const applied = applyOutDir(fetchOpts.outDir);
    assert.strictEqual(process.env.LOGA3_DOWNLOADS_DIR, applied);

    console.log('PASS last/next/--months/--out CLI helpers');
}

async function main() {
    const downloadsDir = await testDownloadsDir();
    const { server, port } = await startPdfServer();

    try {
        await testSingleSaveAs(downloadsDir, port);
        await testDoubleSaveAsRace(downloadsDir, port);
        await testModulesLoad();
        testLast3MonthsCli();
        console.log('\nALL DOWNLOAD TESTS PASSED');
    } finally {
        server.close();
    }
}

main().catch((error) => {
    console.error('\nTEST FAILED:', error.message);
    process.exit(1);
});
