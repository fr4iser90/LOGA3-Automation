#!/usr/bin/env node
/** MutationObserver on #ZeitdatenMonthPicker during Monthpicker Mai click. */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function navToMai(workflow) {
    await workflow.openMonthPickerDropdown();
    for (let i = 0; i < 12; i++) {
        const active = await workflow.page.evaluate(() => {
            const el = document.querySelector('[data-loga3-month-popup="1"] .datePickerSelectorText .gwt-InlineLabel.active');
            return el?.textContent?.trim();
        });
        if (active === 'Mai') return;
        await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click();
        await workflow.page.waitForTimeout(300);
    }
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

        // Install observer
        await workflow.page.evaluate(() => {
            window.__loga3Mutations = [];
            const picker = document.querySelector('#ZeitdatenMonthPicker');
            const obs = new MutationObserver((muts) => {
                for (const m of muts) {
                    window.__loga3Mutations.push({
                        t: Date.now(),
                        type: m.type,
                        attr: m.attributeName,
                        selecteddate: picker.getAttribute('selecteddate'),
                        text: (picker.textContent || '').trim(),
                    });
                }
            });
            obs.observe(picker, { attributes: true, childList: true, subtree: true, characterData: true });
            window.__loga3Obs = obs;
        });

        await navToMai(workflow);
        console.log('at Mai, mutations so far', await workflow.page.evaluate(() => window.__loga3Mutations.length));

        // Also listen to all clicks in popup
        await workflow.page.evaluate(() => {
            const popup = document.querySelector('[data-loga3-month-popup="1"]');
            popup?.addEventListener('click', (e) => {
                window.__loga3Mutations.push({
                    t: Date.now(),
                    type: 'click',
                    target: e.target?.tagName,
                    text: (e.target?.textContent || '').trim().slice(0, 20),
                    cls: (e.target?.className || '').toString().slice(0, 60),
                });
            }, true);
        });

        console.log('▶ click Mai cell');
        await workflow.page.locator('[data-loga3-month-popup="1"] table.datePickerMonthPicker td').filter({ hasText: /^Mai$/ }).click();
        await workflow.page.waitForTimeout(2000);

        const muts = await workflow.page.evaluate(() => window.__loga3Mutations);
        console.log('mutations', JSON.stringify(muts, null, 2));
        console.log('final state', await workflow.getMonthPickerState());

        // Try year→2026→month Mai path
        await workflow.page.keyboard.press('Escape').catch(() => {});
        await workflow.openMonthPickerDropdown();
        console.log('\n▶ year path: click year, click 2026, click Mai');
        await workflow.page.locator('[data-loga3-month-popup="1"] .datePickerSelectorText .gwt-InlineLabel').nth(1).click();
        await workflow.page.waitForTimeout(500);
        await workflow.page.locator('[data-loga3-month-popup="1"] td').filter({ hasText: /^2026$/ }).first().click();
        await workflow.page.waitForTimeout(800);
        const afterYear = await workflow.page.evaluate(() => {
            const popup = document.querySelector('[data-loga3-month-popup="1"]');
            return {
                open: !!popup,
                head: popup ? (popup.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100) : null,
                labels: [...(popup?.querySelectorAll('.datePickerSelectorText .gwt-InlineLabel') || [])].map((el) => ({
                    text: el.textContent.trim(), active: el.classList.contains('active'),
                })),
            };
        });
        console.log('after year 2026 click', afterYear);

        // navigate to mai if needed and click
        if (afterYear.open) {
            for (let i = 0; i < 12; i++) {
                const active = await workflow.page.evaluate(() =>
                    document.querySelector('[data-loga3-month-popup="1"] .datePickerSelectorText .gwt-InlineLabel.active')?.textContent?.trim()
                );
                if (active === 'Mai') break;
                await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click().catch(() => {});
                await workflow.page.waitForTimeout(300);
            }
            await workflow.page.evaluate(() => { window.__loga3Mutations = []; });
            await workflow.page.locator('[data-loga3-month-popup="1"] table.datePickerMonthPicker td').filter({ hasText: /^Mai$/ }).click();
            await workflow.page.waitForTimeout(2500);
            console.log('muts2', await workflow.page.evaluate(() => window.__loga3Mutations));
            console.log('state2', await workflow.getMonthPickerState());
            await workflow.logContentDebug('year-path-end');
        }

        await workflow.takeScreenshot('probe-mutations.png');
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
