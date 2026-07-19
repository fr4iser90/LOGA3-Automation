#!/usr/bin/env node
/** Minimal verify: May header → ic-zaxisrotation → day01 FR */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function main() {
    const login = new Loga3Automation();
    const workflow = new Loga3Workflow();
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

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        await workflow.page.waitForTimeout(2000);

        console.log('1 open', await workflow.getContentSignature().then((s) => s.firstWeekday), await workflow.getMonthPickerState());

        await workflow.syncHeaderWithMonthpickerChromeArrows(5, 2026);
        console.log('2 header May', await workflow.getMonthPickerState(), 'day01', (await workflow.getContentSignature()).firstWeekday);

        // Click Aktualisieren / zaxisrotation
        const selectors = [
            '[data-uin="ic-zaxisrotation"]',
            '[aria-label="Aktualisieren"]',
            '[title="Aktualisieren"]',
        ];
        let clicked = false;
        for (const sel of selectors) {
            const loc = workflow.page.locator(sel).filter({ visible: true }).first();
            if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
                console.log('clicking', sel);
                await loc.click({ timeout: 5000 });
                clicked = true;
                break;
            }
        }
        if (!clicked) {
            // force first zaxis even if "outside viewport"
            await workflow.page.locator('[data-uin="ic-zaxisrotation"]').first().click({ force: true });
        }

        await workflow.page.waitForTimeout(5000);
        await workflow.waitForLoadingIndicatorToSettle(20);

        const sig = await workflow.getContentSignature();
        const picker = await workflow.getMonthPickerState();
        const valid = await workflow.verifyCalendarShowsMonth(5, 2026);
        console.log('3 after refresh', { picker, day01: sig.firstWeekday, last: sig.lastDay, bookings: sig.bookingsLabel, valid });
        await workflow.takeScreenshot('verify-may-zaxis.png');
        await workflow.logContentDebug('verify-may-zaxis');

        if (sig.firstWeekday !== 'FR' || picker?.month !== '05') {
            console.error('FAIL');
            process.exitCode = 1;
        } else {
            console.log('PASS May grid reloaded');
        }
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
