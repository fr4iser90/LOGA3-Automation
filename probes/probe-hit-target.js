#!/usr/bin/env node
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

        // Go to May in popup
        for (let i = 0; i < 2; i++) {
            await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click();
            await workflow.page.waitForTimeout(400);
        }

        const hit = await workflow.page.evaluate(() => {
            const popup = document.querySelector('[data-loga3-month-popup="1"]');
            const mai = [...popup.querySelectorAll('td')].find((td) => (td.textContent || '').trim() === 'Mai' && !(td.textContent || '').includes('November'));
            // prefer exact Mai only
            const exact = [...popup.querySelectorAll('td')].find((td) => (td.textContent || '').trim() === 'Mai');
            const el = exact;
            const r = el.getBoundingClientRect();
            const x = r.x + r.width / 2;
            const y = r.y + r.height / 2;
            const top = document.elementFromPoint(x, y);
            const stack = [];
            let n = top;
            for (let i = 0; i < 8 && n; i++) {
                stack.push({
                    tag: n.tagName,
                    cls: (n.className || '').toString().slice(0, 80),
                    uin: n.getAttribute?.('data-uin'),
                    text: (n.textContent || '').trim().slice(0, 30),
                });
                n = n.parentElement;
            }
            // Also list all listeners-ish via onclick
            return {
                x, y,
                maiHtml: el.outerHTML,
                maiClass: el.className,
                top: stack[0],
                stack,
                popupHasGlass: !!document.querySelector('.gwt-PopupPanelGlass'),
            };
        });
        console.log(JSON.stringify(hit, null, 2));

        // Try clicking whatever elementFromPoint returns
        console.log('▶ click elementFromPoint target via evaluate');
        const before = await workflow.getMonthPickerState();
        await workflow.page.evaluate(() => {
            const popup = document.querySelector('[data-loga3-month-popup="1"]');
            const el = [...popup.querySelectorAll('td')].find((td) => (td.textContent || '').trim() === 'Mai');
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            const evInit = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                top.dispatchEvent(new MouseEvent(type, evInit));
            }
        });
        await workflow.page.waitForTimeout(3000);
        console.log('after', await workflow.getMonthPickerState(), 'before', before);

        // Try: use popup Vorheriger Monat until title MAI, then click OUTSIDE on mask grid
        await workflow.page.keyboard.press('Escape').catch(() => {});
        await workflow.openMonthPickerDropdown();
        for (let i = 0; i < 20; i++) {
            const t = await workflow.page.evaluate(() => (document.querySelector('[data-loga3-month-popup="1"]')?.innerText || '').slice(0, 30));
            if (/^[\s]*MAI/i.test(t.replace(/\t/g, '').trim()) || t.includes('MAI 2026')) break;
            await workflow.page.locator('[data-loga3-month-popup="1"] [aria-label="Vorheriger Monat"]').click();
            await workflow.page.waitForTimeout(300);
        }
        console.log('▶ click outside on day grid while popup on MAI');
        await workflow.page.mouse.click(700, 400);
        await workflow.page.waitForTimeout(3000);
        console.log('after outside', await workflow.getMonthPickerState());
        await workflow.logContentDebug('end');
        await workflow.takeScreenshot('probe-elementfrompoint.png');
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
