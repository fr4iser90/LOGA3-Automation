#!/usr/bin/env node
/** Find how to get day-view / commit month from LOGA3 DatePicker. */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function dump(page) {
    return page.evaluate(() => {
        const popup = document.querySelector('[data-loga3-month-popup="1"]');
        if (!popup) return { open: false };
        const days = [...popup.querySelectorAll('td')]
            .map((td) => (td.textContent || '').trim())
            .filter((t) => /^\d{1,2}$/.test(t));
        const monthEl = popup.querySelector('.datePickerMonth');
        return {
            open: true,
            head: (popup.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
            dayCount: days.length,
            monthLabelText: monthEl ? monthEl.textContent.trim() : null,
            monthLabelHtml: monthEl ? monthEl.outerHTML.slice(0, 200) : null,
            hasMonthPicker: !!popup.querySelector('.datePickerMonthPicker'),
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
        console.log('start', await dump(workflow.page));

        // Click .datePickerMonth (the JULI / 2026 label)
        console.log('\n▶ click .datePickerMonth');
        await workflow.page.locator('[data-loga3-month-popup="1"] .datePickerMonth').click({ force: true }).catch(async () => {
            await workflow.page.evaluate(() => {
                document.querySelector('[data-loga3-month-popup="1"] .datePickerMonth')?.click();
            });
        });
        await workflow.page.waitForTimeout(1000);
        console.log('after monthlabel', await dump(workflow.page));

        // Click each nav button type and dump
        for (const sel of [
            '[aria-label="Vorjahr"]',
            '[aria-label="Vorheriger Monat"]',
            '[aria-label="Nächstes Jahr"]',
            '[aria-label="Nächster Monat"]',
            '[aria-label="Folgejahr"]',
            '[data-uin="ic-nextmedia"]',
            '[data-uin="ic-next"]',
        ]) {
            const loc = workflow.page.locator(`[data-loga3-month-popup="1"] ${sel}`);
            if (!(await loc.count())) continue;
            if (!(await loc.first().isVisible().catch(() => false))) continue;
            console.log('\n▶ nav', sel);
            await loc.first().click();
            await workflow.page.waitForTimeout(600);
            console.log(await dump(workflow.page));
            console.log('header', (await workflow.getMonthPickerState())?.selecteddate);
        }

        // From month view at May: try clicking Mai with native HTMLElement.click in loop + MutationObserver
        if (!(await dump(workflow.page)).open) await workflow.openMonthPickerDropdown();
        // reset: open fresh
        await workflow.page.keyboard.press('Escape').catch(() => {});
        await workflow.openMonthPickerDropdown();

        // Use Vorjahr? then months? 
        // Instead: keep clicking Vorheriger Monat and after EACH click check if days appeared
        console.log('\n▶ step back watching for day grid');
        for (let i = 0; i < 6; i++) {
            await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click();
            await workflow.page.waitForTimeout(500);
            const d = await dump(workflow.page);
            console.log(i + 1, d.head?.slice(0, 40), 'days', d.dayCount, 'monthPicker', d.hasMonthPicker);
            if (d.dayCount > 0) break;
        }

        // Full selector HTML
        const html = await workflow.page.evaluate(() => document.querySelector('[data-loga3-month-popup="1"]')?.innerHTML?.slice(0, 2500));
        console.log('\nHTML snippet:\n', html);

        await workflow.takeScreenshot('probe-monthlabel.png');
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
