#!/usr/bin/env node
/** Force selecteddate during Mai click + watch calendarCache / day01. */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

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
            if (/calendarCacheService/i.test(r.url())) {
                cal += 1;
                console.log('🌐 calendarCache', cal);
            }
        });

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        await workflow.page.waitForTimeout(1500);
        cal = 0;

        await workflow.openMonthPickerDropdown();
        for (let i = 0; i < 12; i++) {
            const active = await workflow.page.evaluate(() =>
                document.querySelector('[data-loga3-month-popup="1"] .datePickerSelectorText .gwt-InlineLabel.active')?.textContent?.trim()
            );
            if (active === 'Mai') break;
            await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click();
            await workflow.page.waitForTimeout(300);
        }

        // Override setAttribute to force May when LOGA3 writes selecteddate
        await workflow.page.evaluate(() => {
            const picker = document.querySelector('#ZeitdatenMonthPicker');
            const orig = picker.setAttribute.bind(picker);
            picker.setAttribute = (name, value) => {
                if (name === 'selecteddate') {
                    console.log('setAttribute selecteddate', value, '→ forcing 05/01/2026');
                    value = '05/01/2026';
                }
                return orig(name, value);
            };
            // Also force text
            const origText = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
        });

        console.log('▶ click Mai with setAttribute hook');
        await workflow.page.locator('[data-loga3-month-popup="1"] table.datePickerMonthPicker td').filter({ hasText: /^Mai$/ }).click();
        await workflow.page.waitForTimeout(3000);

        // Also manually set and dispatch
        await workflow.page.evaluate(() => {
            const picker = document.querySelector('#ZeitdatenMonthPicker');
            picker.setAttribute('selecteddate', '05/01/2026');
            picker.textContent = 'Mai 2026';
            picker.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await workflow.page.waitForTimeout(2000);

        console.log('state', await workflow.getMonthPickerState());
        console.log('sig', await workflow.getContentSignature());
        console.log('cal', cal);

        // Try zaxisrotation AFTER forcing May on picker
        console.log('▶ zaxisrotation after forced May');
        const calBefore = cal;
        await workflow.page.locator('[data-uin="ic-zaxisrotation"]').first().click({ force: true }).catch(() => {});
        await workflow.page.waitForTimeout(5000);
        console.log('state2', await workflow.getMonthPickerState());
        console.log('sig2', await workflow.getContentSignature());
        console.log('calDelta', cal - calBefore);
        await workflow.logContentDebug('forced-may');
        await workflow.takeScreenshot('probe-force-may.png');
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
