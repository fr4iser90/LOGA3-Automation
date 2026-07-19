#!/usr/bin/env node
/**
 * Probe which UI action triggers calendarCacheService after a month header flip.
 */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');
const fs = require('fs');
const path = require('path');

async function main() {
    const login = new Loga3Automation();
    const workflow = new Loga3Workflow();
    const calCalls = [];

    try {
        await login.init();
        await login.navigateToLogin();
        const config = require('../loga3-config.js');
        await login.performLogin(
            config.username || process.env.LOGA3_USERNAME,
            config.password || process.env.LOGA3_PASSWORD
        );
        await login.handle2FA();

        workflow.browser = login.browser;
        workflow.page = login.page;
        workflow.context = login.context;
        workflow.applyPageTimeouts();

        workflow.page.on('request', async (req) => {
            const url = req.url();
            if (!/calendarCacheService|maskActionService/i.test(url)) return;
            let postData = null;
            try {
                postData = req.postData();
            } catch {
                postData = null;
            }
            calCalls.push({
                t: new Date().toISOString(),
                url: url.split('/').pop(),
                method: req.method(),
                postPreview: (postData || '').slice(0, 500),
            });
            console.log(`🌐 ${url.split('/').pop()} len=${(postData || '').length}`);
        });

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        console.log('--- after open, calCalls:', calCalls.length);
        await workflow.logContentDebug('after-open');

        // Flip header to May
        await workflow.navigateHeaderToMonth(5, 2026);
        console.log('--- after header→May, calCalls:', calCalls.length);
        await workflow.logContentDebug('after-header-may');

        const actions = [
            ['calendar-icon', async () => {
                await workflow.page.locator('[data-uin="ic-calendaralt"]').filter({ visible: true }).first().click({ timeout: 3000 });
            }],
            ['zaxisrotation', async () => {
                await workflow.page.locator('[data-uin="ic-zaxisrotation"]').filter({ visible: true }).first().click({ timeout: 3000 });
            }],
            ['person-search-focus-blur', async () => {
                const input = workflow.page.locator('[aria-label="Person suchen..."]').first();
                await input.click({ timeout: 3000 });
                await input.fill('x');
                await input.fill('');
                await workflow.page.keyboard.press('Tab');
            }],
            ['click-day-06', async () => {
                await workflow.page.getByText(/06\s+MO/).first().click({ timeout: 3000 });
            }],
            ['click-mask-center', async () => {
                const box = await workflow.page.locator('[data-uin="mask-LZWZEITD"]').boundingBox();
                if (box) await workflow.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            }],
            ['keyboard-F5-in-mask', async () => {
                await workflow.page.locator('[data-uin="mask-LZWZEITD"]').click({ timeout: 3000 });
                await workflow.page.keyboard.press('F5');
            }],
        ];

        for (const [name, fn] of actions) {
            const before = calCalls.length;
            const beforeSig = await workflow.getContentSignature();
            console.log(`\n▶ try: ${name}`);
            try {
                await fn();
                await workflow.page.waitForTimeout(4000);
                await workflow.waitForLoadingIndicatorToSettle(10);
            } catch (error) {
                console.log(`  ⚠️  ${name} failed: ${error.message}`);
            }
            const afterSig = await workflow.getContentSignature();
            console.log(`  calCalls +${calCalls.length - before}, day01 ${beforeSig.firstWeekday}→${afterSig.firstWeekday}, gridChanged=${beforeSig.gridKey !== afterSig.gridKey}`);
            if (beforeSig.gridKey !== afterSig.gridKey) {
                console.log('  ✅ GRID CHANGED via', name);
                await workflow.logContentDebug(`grid-changed-via-${name}`);
                break;
            }
        }

        const out = path.join(__dirname, '..', 'logs', 'calendar-cache-probe.json');
        fs.writeFileSync(out, JSON.stringify(calCalls, null, 2));
        console.log('\n🧾 Wrote', out, 'entries=', calCalls.length);
        await workflow.takeScreenshot('probe-calendar-cache.png');
        await workflow.logContentDebug('probe-end');
    } catch (error) {
        console.error('❌', error.message);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}

main();
