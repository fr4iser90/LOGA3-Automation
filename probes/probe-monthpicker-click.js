#!/usr/bin/env node
/** Probe Monthpicker click: dump popup DOM, try click variants, watch header + calendarCache. */
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
                console.log('🌐 calendarCache #' + cal);
            }
        });

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        console.log('before', await workflow.getMonthPickerState());

        await workflow.openMonthPickerDropdown();
        const dump = await workflow.page.evaluate(() => {
            const popup = document.querySelector('[data-loga3-month-popup="1"]');
            if (!popup) return null;
            const tds = [...popup.querySelectorAll('td')].map((td) => ({
                text: (td.textContent || '').trim(),
                cls: (td.className || '').toString(),
                w: Math.round(td.getBoundingClientRect().width),
                h: Math.round(td.getBoundingClientRect().height),
            }));
            return {
                text: (popup.innerText || '').slice(0, 500),
                selectorHtml: (popup.querySelector('.datePickerSelector') || {}).innerHTML?.slice?.(0, 800),
                mai: tds.filter((t) => t.text === 'Mai'),
                tds: tds.filter((t) => t.text && t.w > 0).slice(0, 40),
            };
        });
        console.log('DUMP', JSON.stringify(dump, null, 2));

        // Try clicking Mai with different strategies
        const strategies = [
            ['locator-filter', async () => {
                await workflow.page.locator('[data-loga3-month-popup="1"] td').filter({ hasText: /^Mai$/ }).first().click();
            }],
            ['evaluate-click', async () => {
                await workflow.page.evaluate(() => {
                    const popup = document.querySelector('[data-loga3-month-popup="1"]');
                    const td = [...popup.querySelectorAll('td')].find((el) => (el.textContent || '').trim() === 'Mai');
                    td?.click();
                });
            }],
            ['dblclick', async () => {
                await workflow.page.locator('[data-loga3-month-popup="1"] td').filter({ hasText: /^Mai$/ }).first().dblclick();
            }],
            ['mousedown-mouseup', async () => {
                const loc = workflow.page.locator('[data-loga3-month-popup="1"] td').filter({ hasText: /^Mai$/ }).first();
                await loc.dispatchEvent('mousedown');
                await loc.dispatchEvent('mouseup');
                await loc.dispatchEvent('click');
            }],
        ];

        for (const [name, fn] of strategies) {
            // reopen if closed
            const open = await workflow.page.locator('[data-loga3-month-popup="1"]').isVisible().catch(() => false);
            if (!open) {
                await workflow.openMonthPickerDropdown().catch(() => {});
            }
            const before = await workflow.getMonthPickerState();
            const calBefore = cal;
            console.log(`\n▶ ${name}`);
            try {
                await fn();
            } catch (e) {
                console.log('fail', e.message);
                continue;
            }
            await workflow.page.waitForTimeout(3000);
            const after = await workflow.getMonthPickerState();
            console.log({
                before: before?.selecteddate,
                after: after?.selecteddate,
                label: after?.label,
                calDelta: cal - calBefore,
            });
            if (after?.month === '05') {
                console.log('✅ HEADER UPDATED via', name);
                await workflow.logContentDebug('mai-header-ok');
                break;
            }
        }

        await workflow.takeScreenshot('probe-monthpicker-click.png');
        await workflow.logContentDebug('probe-end');
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
