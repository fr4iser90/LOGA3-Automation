#!/usr/bin/env node
/**
 * Thin CLI entry for the Loga3 engine (ShiftPlanConverter handoff).
 *
 *   loga3 fetch --months 2026-05,2026-06 --out ./pdfs
 *   loga3 fetch --last 3 --out ./pdfs --open-folder --open-converter
 */
const path = require('path');

require('dotenv').config({
    path: process.env.LOGA3_PORTABLE_ROOT
        ? path.join(process.env.LOGA3_PORTABLE_ROOT, '.env')
        : path.join(__dirname, '..', '.env'),
});

const Loga3Complete = require('../src/loga3-complete.js');
const {
    parseCliOptions,
    applyOutDir,
    openPath,
    printFetchHelp,
} = require('../src/loga3-cli-args.js');
const { applySettingsToEnv } = require('../src/loga3-settings');
const { getDownloadsDir } = require('../src/loga3-inventory');

applySettingsToEnv(process.env);

async function main() {
    const options = parseCliOptions(process.argv.slice(2));

    if (options.help || options.command === 'help') {
        printFetchHelp();
        process.exit(0);
    }

    const isFetch = options.command === 'fetch'
        || process.argv.includes('fetch')
        || options.outDir
        || options.targets.length
        || options.openFolder
        || options.openConverter;

    if (!isFetch && !options.command) {
        printFetchHelp();
        process.exit(0);
    }

    const outDir = applyOutDir(options.outDir) || getDownloadsDir();
    console.log(`📁 Output: ${outDir}`);

    if (!options.targets.length) {
        console.error('❌ No months selected. Use --months, --last, --next, or --period.');
        printFetchHelp();
        process.exit(2);
    }

    const complete = new Loga3Complete({
        exitAfter: true,
        targets: options.targets,
    });

    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...');
        await complete.cleanup();
        process.exit(0);
    });

    const result = await complete.run();
    const saved = result?.savedFiles || [];

    console.log('\n—— ShiftPlanConverter handoff ——');
    console.log(`PDFs (${saved.length}): ${outDir}`);
    for (const file of saved) {
        console.log(`  • ${path.basename(file)}`);
    }
    console.log(`Converter: ${options.converterUrl}`);
    console.log('Drop the PDFs into the converter (or use --open-converter).');

    if (options.openFolder) {
        if (openPath(outDir)) console.log(`📂 Opened folder: ${outDir}`);
    }
    if (options.openConverter) {
        if (openPath(options.converterUrl)) console.log(`🌐 Opened: ${options.converterUrl}`);
    }
}

main().catch((error) => {
    console.error('❌', error.message || error);
    process.exit(1);
});
