#!/usr/bin/env node
/** Probe: Monthpicker day-view commit — click Mai then day 1. */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function dumpPopup(page, label) {
    const info = await page.evaluate(() => {
        const popup = document.querySelector('[data-loga3-month-popup="1"]')
            || document.querySelector('.gwt-DatePicker')?.closest('.popupContent, .gwt-PopupPanel, [class*="Popup"]');
        if (!popup) return { open: false };
        return {
            open: true,
            text: (popup.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
            valued: [...popup.querySelectorAll('td')]
                .filter((td) => /IsValue|IsToday|IsHighlighted/i.test(td.className || ''))
                .map((td) => `${(td.textContent || '').trim()}[${td.className}]`),
            days: [...popup.querySelectorAll('td')]
                .map((td) => (td.textContent || '').trim())
                .filter((t) => /^\d{1,2}$/.test(t))
                .slice(0, 40),
        };
    });
    console.log(label, JSON.stringify(info));
    return info;
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
            if (/calendarCacheService/i.test(r.url())) {
                cal += 1;
                console.log('🌐 calendarCache #' + cal);
            }
        });

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        await workflow.openMonthPickerDropdown();

        // Navigate dropdown to May via internal arrows
        for (let i = 0; i < 2; i++) {
            await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click();
            await workflow.page.waitForTimeout(600);
        }
        await dumpPopup(workflow.page, 'after-nav-to-mai');

        // Click Mai cell
        await workflow.page.locator('[data-loga3-month-popup="1"] td').filter({ hasText: /^Mai$/ }).first().click({ force: true });
        await workflow.page.waitForTimeout(1500);
        await dumpPopup(workflow.page, 'after-click-mai');
        console.log('header', await workflow.getMonthPickerState());

        // If day grid appeared, click 1
        const days = await workflow.page.locator('[data-loga3-month-popup="1"] td').filter({ hasText: /^1$/ });
        const dayCount = await days.count();
        console.log('day-1 count', dayCount);
        if (dayCount > 0) {
            const calBefore = cal;
            await days.first().click({ force: true });
            await workflow.page.waitForTimeout(4000);
            console.log('after day1', await workflow.getMonthPickerState(), 'calDelta', cal - calBefore);
            await workflow.logContentDebug('after-day1');
        } else {
            // Try clicking valued month with Enter
            await workflow.page.keyboard.press('Enter');
            await workflow.page.waitForTimeout(2000);
            await dumpPopup(workflow.page, 'after-enter');
            console.log('header after enter', await workflow.getMonthPickerState());
        }

        // Alternative: click "MAI" / "2026" title area then day
        let open = await workflow.page.locator('[data-loga3-month-popup="1"]').isVisible().catch(() => false);
        if (!open) {
            await workflow.openMonthPickerDropdown();
            for (let i = 0; i < 2; i++) {
                await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click();
                await workflow.page.waitForTimeout(500);
            }
        }

        // Click the month/year title to drill into days?
        console.log('\n▶ click datePickerMonth title');
        await workflow.page.evaluate(() => {
            const popup = document.querySelector('[data-loga3-month-popup="1"]');
            const title = popup.querySelector('.datePickerMonth');
            console.log('title', title?.textContent);
            title?.click();
        });
        await workflow.page.waitForTimeout(1000);
        await dumpPopup(workflow.page, 'after-title-click');

        // Try pressing Space on Mai
        await workflow.page.locator('[data-loga3-month-popup="1"] td').filter({ hasText: /^Mai$/ }).first().focus().catch(() => {});
        await workflow.page.keyboard.press('Enter');
        await workflow.page.waitForTimeout(1500);
        await dumpPopup(workflow.page, 'after-mai-enter');
        console.log('final header', await workflow.getMonthPickerState());
        await workflow.takeScreenshot('probe-day-commit.png');
        await workflow.logContentDebug('final');
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
