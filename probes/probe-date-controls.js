#!/usr/bin/env node
/** Dump date-like controls and try JS selecteddate + person path. */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function main() {
    const login = new Loga3Automation();
    const workflow = new Loga3Workflow();
    let calHits = 0;

    try {
        await login.init();
        await login.navigateToLogin();
        const config = require('../loga3-config.js');
        await login.performLogin(
            config.username || process.env.LOGA3_USERNAME,
            config.password || process.env.LOGA3_PASSWORD
        );
        await login.handle2FA();
        workflow.browser = login.browser;
        workflow.page = login.page;
        workflow.context = login.context;
        workflow.applyPageTimeouts();
        workflow.page.on('request', (req) => {
            if (/calendarCacheService/i.test(req.url())) {
                calHits += 1;
                console.log('🌐 calendarCache #' + calHits);
            }
        });

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        await workflow.page.waitForTimeout(1500);
        calHits = 0;

        const controls = await workflow.page.evaluate(() => {
            const out = [];
            for (const el of document.querySelectorAll('input, [selecteddate], [data-uin*="date" i], [data-uin*="month" i], [data-uin*="zeit" i], [class*="Date" i], [class*="Month" i]')) {
                const r = el.getBoundingClientRect();
                out.push({
                    tag: el.tagName,
                    id: el.id,
                    uin: el.getAttribute('data-uin'),
                    name: el.getAttribute('name'),
                    type: el.getAttribute('type'),
                    selecteddate: el.getAttribute('selecteddate'),
                    value: el.value || '',
                    text: (el.textContent || '').trim().slice(0, 40),
                    className: (el.className || '').toString().slice(0, 60),
                    x: Math.round(r.x),
                    y: Math.round(r.y),
                    visible: el.offsetParent !== null && r.width > 0,
                });
            }
            return out.slice(0, 80);
        });
        console.log('🔎 date-ish controls', JSON.stringify(controls, null, 2));

        // Try setting selecteddate + native/input events, then zaxisrotation refresh
        console.log('\n▶ set selecteddate to May then zaxisrotation');
        const before = await workflow.getContentSignature();
        await workflow.page.evaluate(() => {
            const picker = document.querySelector('#ZeitdatenMonthPicker');
            if (!picker) return;
            picker.setAttribute('selecteddate', '05/01/2026');
            picker.textContent = 'Mai 2026';
            for (const type of ['input', 'change', 'blur', 'click']) {
                picker.dispatchEvent(new Event(type, { bubbles: true }));
            }
        });
        await workflow.page.waitForTimeout(1000);
        try {
            await workflow.page.locator('[data-uin="ic-zaxisrotation"]').first().click({ force: true, timeout: 3000 });
        } catch (e) {
            console.log('zaxis click', e.message);
        }
        await workflow.page.waitForTimeout(5000);
        const after = await workflow.getContentSignature();
        const picker = await workflow.getMonthPickerState();
        console.log({
            picker,
            day01: `${before.firstWeekday}→${after.firstWeekday}`,
            gridChanged: before.gridKey !== after.gridKey,
            calHits,
        });

        // Year navigation in dropdown?
        console.log('\n▶ dropdown year nav');
        calHits = 0;
        try {
            await workflow.openMonthPickerDropdown();
            const popupInfo = await workflow.page.evaluate(() => {
                const popup = document.querySelector('[data-loga3-month-popup="1"]')
                    || document.querySelector('.popupContent')
                    || document.querySelector('.datePicker');
                if (!popup) return null;
                return {
                    text: (popup.innerText || '').slice(0, 400),
                    html: (popup.innerHTML || '').slice(0, 400),
                };
            });
            console.log('popup', popupInfo);
            await workflow.page.keyboard.press('Escape');
        } catch (e) {
            console.log('dropdown', e.message);
        }

        await workflow.takeScreenshot('probe-date-controls.png');
    } catch (error) {
        console.error('❌', error.message);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}

main();
