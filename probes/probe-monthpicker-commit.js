#!/usr/bin/env node
/** Probe commit after Monthpicker shows MAI 2026. */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function navToMai(workflow) {
    await workflow.openMonthPickerDropdown();
    for (let i = 0; i < 2; i++) {
        await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click();
        await workflow.page.waitForTimeout(500);
    }
    const title = await workflow.page.evaluate(() => {
        const p = document.querySelector('[data-loga3-month-popup="1"]');
        return (p?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    });
    console.log('popup title area', title);
}

async function main() {
    const login = new Loga3Automation();
    const workflow = new Loga3Workflow();
    let cal = 0;
    try {
        await login.init();
        await login.navigateToLogin();
        const config = require('../loga3-config.js');
        await login.performLogin(config.username, config.password);
        await login.handle2FA();
        workflow.browser = login.browser;
        workflow.page = login.page;
        workflow.context = login.context;
        workflow.applyPageTimeouts();
        workflow.page.on('request', (r) => {
            if (/calendarCacheService|maskActionService/i.test(r.url())) {
                cal += 1;
                console.log('🌐', r.url().split('/').pop(), '#' + cal);
            }
        });

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        await workflow.page.waitForTimeout(2000);
        cal = 0;

        const commits = [
            ['Escape', async () => { await workflow.page.keyboard.press('Escape'); }],
            ['Enter', async () => { await workflow.page.keyboard.press('Enter'); }],
            ['click-IsValue', async () => {
                await workflow.page.locator('[data-loga3-month-popup="1"] td.datePickerDayIsValue').click({ force: true });
            }],
            ['click-IsValue-no-force', async () => {
                await workflow.page.locator('td.datePickerDayIsValue').filter({ hasText: /^Mai$/ }).click();
            }],
            ['Tab-Enter', async () => {
                await workflow.page.keyboard.press('Tab');
                await workflow.page.keyboard.press('Enter');
            }],
            ['click-picker-while-open', async () => {
                await workflow.page.locator('#ZeitdatenMonthPicker').click();
            }],
            ['real-mouse-IsValue', async () => {
                const box = await workflow.page.locator('td.datePickerDayIsValue').filter({ hasText: /^Mai$/ }).boundingBox();
                console.log('box', box);
                await workflow.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await workflow.page.mouse.down();
                await workflow.page.waitForTimeout(100);
                await workflow.page.mouse.up();
            }],
        ];

        for (const [name, fn] of commits) {
            await navToMai(workflow);
            const before = await workflow.getMonthPickerState();
            const calBefore = cal;
            console.log(`\n▶ commit via ${name}`);
            try {
                await fn();
            } catch (e) {
                console.log('err', e.message);
            }
            await workflow.page.waitForTimeout(2500);
            const after = await workflow.getMonthPickerState();
            const grid = await workflow.getContentSignature();
            console.log({
                before: before?.selecteddate,
                after: after?.selecteddate,
                label: after?.label,
                day01: grid.firstWeekday,
                calDelta: cal - calBefore,
            });
            if (after?.month === '05') {
                console.log('✅ SUCCESS', name);
                await workflow.takeScreenshot(`probe-commit-ok-${name}.png`);
                await workflow.logContentDebug('success-' + name);
                break;
            }
            // ensure closed for next
            await workflow.page.keyboard.press('Escape').catch(() => {});
            await workflow.page.waitForTimeout(400);
        }
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
