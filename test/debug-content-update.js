#!/usr/bin/env node
/**
 * Debug content update only — login, open, navigate months, verify grid.
 * Does NOT open Export / Zeitprotokoll / download.
 *
 * Usage:
 *   node debug-content-update.js --last 3
 *   node debug-content-update.js --next 3
 *   node debug-content-update.js --period 2026-05
 */
const path = require('path');
const fs = require('fs');
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');
const { parseTargets } = require('../src/loga3-cli-args.js');
const { MONTH_LABELS, getLogsDir } = require('../src/loga3-inventory');

async function main() {
    const targets = parseTargets(process.argv);
    if (!targets.length) {
        console.error('Usage: node debug-content-update.js --last N | --next N | --period YYYY-MM');
        process.exit(2);
    }

    const logPath = path.join(getLogsDir(), 'content-debug.jsonl');
    try {
        fs.writeFileSync(logPath, '');
    } catch {
        // ignore
    }

    console.log('🧪 Content-update debug (no export)');
    console.log(`📋 Targets: ${targets.map((t) => `${String(t.month).padStart(2, '0')}/${t.year}`).join(' → ')}`);
    console.log(`🧾 Log: ${logPath}`);

    const login = new Loga3Automation();
    const workflow = new Loga3Workflow();
    const results = [];

    try {
        await login.init();
        if (!(await login.navigateToLogin())) {
            throw new Error('Login page failed');
        }

        const config = require('./loga3-config.js');
        const username = config.username || process.env.LOGA3_USERNAME;
        const password = config.password || process.env.LOGA3_PASSWORD;
        if (!username || !password) {
            throw new Error('Missing credentials');
        }

        if (!(await login.performLogin(username, password))) {
            throw new Error('Login failed');
        }
        await login.handle2FA();

        workflow.browser = login.browser;
        workflow.page = login.page;
        workflow.context = login.context;
        workflow.downloadsDir = login.downloadsDir || workflow.downloadsDir;
        workflow.applyPageTimeouts();

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        await workflow.logHeaderMonth('After open');
        await workflow.logContentDebug('debug-start');

        for (const target of targets) {
            const label = `${String(target.month).padStart(2, '0')}/${target.year}`;
            const monthName = `${MONTH_LABELS[target.month - 1]} ${target.year}`;
            console.log(`\n═══ Navigating to ${label} (${monthName}) ═══`);

            const selected = await workflow.selectMonthViaPicker(target.month, target.year);
            let valid = false;
            if (selected) {
                valid = await workflow.verifyCalendarShowsMonth(target.month, target.year);
                if (!valid) {
                    console.log('⚠️  select returned true but verify failed — nudging...');
                    await workflow.nudgeMonthContentReload(target.month, target.year);
                    valid = await workflow.verifyCalendarShowsMonth(target.month, target.year);
                }
            }

            await workflow.takeScreenshot(`content-debug-${label.replace('/', '-')}.png`);
            const sig = await workflow.getContentSignature();
            const row = {
                target: label,
                selected: Boolean(selected),
                valid,
                bookingsLabel: sig.bookingsLabel,
                firstWeekday: sig.firstWeekday,
                lastDay: sig.lastDay,
                key: sig.key,
            };
            results.push(row);
            console.log(`${valid ? '✅' : '❌'} ${label}: ${JSON.stringify(row)}`);
        }

        const failed = results.filter((r) => !r.valid);
        console.log('\n═══ SUMMARY ═══');
        for (const row of results) {
            console.log(
                `${row.valid ? 'PASS' : 'FAIL'} ${row.target} `
                + `bookings=${row.bookingsLabel || '?'} day01=${row.firstWeekday || '?'} last=${row.lastDay || '?'}`
            );
        }

        if (failed.length) {
            console.error(`\n❌ Content update failed for ${failed.length}/${results.length} month(s)`);
            process.exitCode = 1;
        } else {
            console.log(`\n✅ Content update OK for all ${results.length} month(s)`);
        }
    } catch (error) {
        console.error('❌ Debug failed:', error.message);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { main };