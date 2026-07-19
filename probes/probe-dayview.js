#!/usr/bin/env node
/** Can we enter day-view from Monthpicker? */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function dump(page) {
    return page.evaluate(() => {
        const popup = document.querySelector('[data-loga3-month-popup="1"]');
        if (!popup) return { open: false };
        const days = [...popup.querySelectorAll('td')]
            .map((td) => ({ t: (td.textContent || '').trim(), c: (td.className || '').trim() }))
            .filter((x) => /^\d{1,2}$/.test(x.t));
        return {
            open: true,
            head: (popup.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100),
            dayCount: days.length,
            days: days.slice(0, 15),
            hasMonthPicker: !!popup.querySelector('.datePickerMonthPicker'),
            hasDays: !!popup.querySelector('.datePickerDays, .datePickerDay'),
        };
    });
}

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
        await workflow.openMonthPickerDropdown();
        console.log('initial', await dump(workflow.page));

        // Click Juli (today)
        console.log('\n▶ click Juli');
        await workflow.page.locator('[data-loga3-month-popup="1"] td').filter({ hasText: /^Juli$/ }).first().click();
        await workflow.page.waitForTimeout(1500);
        console.log('after Juli', await dump(workflow.page), await workflow.getMonthPickerState());

        // Reopen, navigate to May, click Mai with delay
        if (!(await dump(workflow.page)).open) await workflow.openMonthPickerDropdown();
        for (let i = 0; i < 2; i++) {
            await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click();
            await workflow.page.waitForTimeout(400);
        }
        console.log('on Mai view', await dump(workflow.page));

        // Use Playwright click with no force, short delay, on table.datePickerMonthPicker td
        console.log('\n▶ click Mai in datePickerMonthPicker');
        const mai = workflow.page.locator('[data-loga3-month-popup="1"] table.datePickerMonthPicker td').filter({ hasText: /^Mai$/ });
        await mai.click({ delay: 100 });
        await workflow.page.waitForTimeout(2000);
        console.log('after Mai', await dump(workflow.page), await workflow.getMonthPickerState());

        // If days visible, click 1
        const d = await dump(workflow.page);
        if (d.dayCount > 0) {
            console.log('▶ click day 1');
            await workflow.page.locator('[data-loga3-month-popup="1"] td').filter({ hasText: /^1$/ }).first().click();
            await workflow.page.waitForTimeout(3000);
            console.log('after day1', await workflow.getMonthPickerState());
            await workflow.logContentDebug('day1-done');
        }

        // Try: after reopen, double-click Mai quickly
        if (!(await dump(workflow.page)).open) await workflow.openMonthPickerDropdown();
        for (let i = 0; i < 2; i++) {
            await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click();
            await workflow.page.waitForTimeout(300);
        }
        console.log('\n▶ dblclick Mai');
        await workflow.page.locator('table.datePickerMonthPicker td').filter({ hasText: /^Mai$/ }).dblclick({ delay: 50 });
        await workflow.page.waitForTimeout(2000);
        console.log('after dbl', await dump(workflow.page), await workflow.getMonthPickerState());

        await workflow.takeScreenshot('probe-dayview.png');
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
