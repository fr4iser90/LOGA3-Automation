#!/usr/bin/env node
/** Probe: Monthpicker internal nav + coordinate click on Mai. */
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
        await workflow.openMonthPickerDropdown();

        // Inspect Mai node deeper
        const maiInfo = await workflow.page.evaluate(() => {
            const popup = document.querySelector('[data-loga3-month-popup="1"]');
            const td = [...popup.querySelectorAll('td')].find((el) => (el.textContent || '').trim() === 'Mai');
            if (!td) return null;
            const r = td.getBoundingClientRect();
            return {
                html: td.outerHTML,
                parentHtml: td.parentElement?.outerHTML?.slice(0, 300),
                x: r.x + r.width / 2,
                y: r.y + r.height / 2,
                childCount: td.children.length,
            };
        });
        console.log('Mai info', maiInfo);

        // Strategy A: mouse click at center
        console.log('\n▶ coordinate click Mai');
        await workflow.page.mouse.click(maiInfo.x, maiInfo.y);
        await workflow.page.waitForTimeout(2500);
        console.log('after coord', await workflow.getMonthPickerState());

        // Reopen
        let open = await workflow.page.locator('[data-loga3-month-popup="1"]').isVisible().catch(() => false);
        if (!open) await workflow.openMonthPickerDropdown();

        // Strategy B: click dropdown "Vorheriger Monat" until Juli highlight moves / header changes
        console.log('\n▶ dropdown-internal Vorheriger Monat x2 then click highlighted/Mai');
        for (let i = 0; i < 2; i++) {
            await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click();
            await workflow.page.waitForTimeout(800);
            const state = await workflow.page.evaluate(() => {
                const popup = document.querySelector('[data-loga3-month-popup="1"]');
                const valued = [...popup.querySelectorAll('td')].filter((td) => /datePickerDayIsValue/.test(td.className || ''));
                return {
                    header: (document.querySelector('#ZeitdatenMonthPicker')?.getAttribute('selecteddate')),
                    valued: valued.map((td) => (td.textContent || '').trim()),
                    text: (popup.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
                };
            });
            console.log('after dropdown back', i + 1, state);
        }

        // Click whatever is valued, or Mai
        await workflow.page.evaluate(() => {
            const popup = document.querySelector('[data-loga3-month-popup="1"]');
            const valued = [...popup.querySelectorAll('td')].find((td) => /datePickerDayIsValue/.test(td.className || ''));
            const mai = [...popup.querySelectorAll('td')].find((td) => (td.textContent || '').trim() === 'Mai');
            (valued || mai)?.click();
        });
        await workflow.page.waitForTimeout(3000);
        console.log('after valued/mai click', await workflow.getMonthPickerState());
        await workflow.logContentDebug('after-dropdown-nav');

        // Strategy C: click year label / month label in selector to switch modes
        open = await workflow.page.locator('[data-loga3-month-popup="1"]').isVisible().catch(() => false);
        if (!open) await workflow.openMonthPickerDropdown();
        console.log('\n▶ click center year/month label in selector');
        await workflow.page.evaluate(() => {
            const popup = document.querySelector('[data-loga3-month-popup="1"]');
            const label = popup.querySelector('.datePickerMonth') || popup.querySelector('.datePickerSelector div');
            label?.click();
        });
        await workflow.page.waitForTimeout(1000);
        const afterLabel = await workflow.page.evaluate(() => {
            const popup = document.querySelector('[data-loga3-month-popup="1"]');
            return popup ? (popup.innerText || '').slice(0, 400) : null;
        });
        console.log('after label click text', afterLabel);

        await workflow.takeScreenshot('probe-monthpicker-nav.png');
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
