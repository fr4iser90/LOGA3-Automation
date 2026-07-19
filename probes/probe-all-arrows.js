#!/usr/bin/env node
/**
 * Click every visible ic-previous / month-arrow candidate and see which
 * triggers calendarCacheService + day01 change.
 */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function main() {
    const login = new Loga3Automation();
    const workflow = new Loga3Workflow();
    let calHits = 0;

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

        workflow.page.on('request', (req) => {
            if (/calendarCacheService/i.test(req.url())) {
                calHits += 1;
                console.log('🌐 calendarCacheService #' + calHits);
            }
        });

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        await workflow.page.waitForTimeout(2000);
        calHits = 0;

        const arrows = await workflow.page.evaluate(() => {
            const nodes = [
                ...document.querySelectorAll('[data-uin="ic-previous"]'),
                ...document.querySelectorAll('[aria-label="Vorheriger Monat"]'),
                ...document.querySelectorAll('[title="Vorheriger Monat"]'),
            ];
            const uniq = [...new Set(nodes)];
            return uniq.map((el, index) => {
                const r = el.getBoundingClientRect();
                const picker = document.querySelector('#ZeitdatenMonthPicker');
                const pr = picker ? picker.getBoundingClientRect() : null;
                el.setAttribute('data-loga3-arrow-probe', String(index));
                return {
                    index,
                    uin: el.getAttribute('data-uin'),
                    aria: el.getAttribute('aria-label'),
                    title: el.getAttribute('title'),
                    className: (el.className || '').toString().slice(0, 80),
                    x: Math.round(r.x),
                    y: Math.round(r.y),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                    visible: el.offsetParent !== null && r.width > 0 && r.height > 0,
                    parentUin: el.parentElement?.getAttribute?.('data-uin'),
                    parentClass: (el.parentElement?.className || '').toString().slice(0, 60),
                    distToPicker: pr
                        ? Math.round(Math.hypot(r.x - pr.x, r.y - pr.y))
                        : null,
                    pickerSelected: picker?.getAttribute('selecteddate') || null,
                };
            });
        });

        console.log('🔎 Arrow candidates:', JSON.stringify(arrows, null, 2));

        for (const arrow of arrows.filter((a) => a.visible)) {
            // Reset to July if needed by going forward until 07
            for (let i = 0; i < 6; i++) {
                const st = await workflow.getMonthPickerState();
                if (st?.month === '07') break;
                const dir = Number(st?.month) < 7 ? 'forward' : 'back';
                // use geometry near picker carefully — for reset only
                await workflow.clickMonthPickerArrow(dir);
                await workflow.page.waitForTimeout(800);
            }

            const before = await workflow.getContentSignature();
            const beforePicker = await workflow.getMonthPickerState();
            const beforeCal = calHits;
            console.log(`\n▶ click arrow probe #${arrow.index} at (${arrow.x},${arrow.y}) dist=${arrow.distToPicker}`);

            try {
                await workflow.page.locator(`[data-loga3-arrow-probe="${arrow.index}"]`).click({
                    timeout: 3000,
                    force: true,
                });
            } catch (error) {
                console.log('  click failed:', error.message);
                continue;
            }

            await workflow.page.waitForTimeout(4000);
            const after = await workflow.getContentSignature();
            const afterPicker = await workflow.getMonthPickerState();
            console.log({
                picker: `${beforePicker?.month}→${afterPicker?.month}`,
                day01: `${before.firstWeekday}→${after.firstWeekday}`,
                lastDay: `${before.lastDay}→${after.lastDay}`,
                gridChanged: before.gridKey !== after.gridKey,
                calDelta: calHits - beforeCal,
            });

            if (before.gridKey !== after.gridKey || calHits > beforeCal) {
                console.log('✅ Interesting arrow:', arrow.index);
                await workflow.takeScreenshot(`probe-arrow-${arrow.index}.png`);
            }
        }

        await workflow.takeScreenshot('probe-all-arrows.png');
    } catch (error) {
        console.error('❌', error.message);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}

main();
