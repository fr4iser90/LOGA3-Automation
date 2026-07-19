#!/usr/bin/env node
/** Commit via .datePickerSelectorText active month / year labels. */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function dump(page) {
    return page.evaluate(() => {
        const popup = document.querySelector('[data-loga3-month-popup="1"]');
        if (!popup) return { open: false };
        const labels = [...popup.querySelectorAll('.datePickerSelectorText .gwt-InlineLabel')]
            .map((el) => ({ text: el.textContent.trim(), active: el.classList.contains('active'), cls: el.className }));
        const days = [...popup.querySelectorAll('td')]
            .map((td) => (td.textContent || '').trim())
            .filter((t) => /^\d{1,2}$/.test(t));
        return {
            open: true,
            labels,
            dayCount: days.length,
            days: days.slice(0, 10),
            head: (popup.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        };
    });
}

async function navTo(workflow, monthName, year) {
    await workflow.openMonthPickerDropdown();
    for (let i = 0; i < 36; i++) {
        const d = await dump(workflow.page);
        const active = d.labels?.find((l) => l.active)?.text;
        const y = d.labels?.find((l) => /^\d{4}$/.test(l.text))?.text;
        console.log(`  nav ${i}: active=${active} year=${y}`);
        if (active === monthName && y === String(year)) return true;
        // decide direction by period
        const cur = (Number(y) || 2026) * 12 + ({
            Januar:1,Februar:2,'März':3,April:4,Mai:5,Juni:6,Juli:7,August:8,September:9,Oktober:10,November:11,Dezember:12
        }[active] || 7);
        const tgt = Number(year) * 12 + ({
            Januar:1,Februar:2,'März':3,April:4,Mai:5,Juni:6,Juli:7,August:8,September:9,Oktober:10,November:11,Dezember:12
        }[monthName]);
        const sel = cur > tgt
            ? '[aria-label="Vorheriger Monat"]'
            : '[aria-label="Nächster Monat"]';
        await workflow.page.locator(`[data-loga3-month-popup="1"] ${sel}`).click();
        await workflow.page.waitForTimeout(350);
    }
    return false;
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
                console.log('🌐 calendarCache', cal);
            }
        });

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        await workflow.page.waitForTimeout(1500);
        cal = 0;

        console.log('▶ navigate Monthpicker to Mai 2026');
        await navTo(workflow, 'Mai', 2026);
        console.log('at target', await dump(workflow.page));

        // Try click active month label
        console.log('\n▶ click active month label');
        let calBefore = cal;
        await workflow.page.locator('[data-loga3-month-popup="1"] .datePickerSelectorText .gwt-InlineLabel.active').click();
        await workflow.page.waitForTimeout(2000);
        console.log('after active click', await dump(workflow.page), await workflow.getMonthPickerState(), 'cal', cal - calBefore);

        // If day view, click 1
        let d = await dump(workflow.page);
        if (d.dayCount > 0) {
            calBefore = cal;
            await workflow.page.locator('[data-loga3-month-popup="1"] td').filter({ hasText: /^1$/ }).first().click();
            await workflow.page.waitForTimeout(4000);
            console.log('after day1', await workflow.getMonthPickerState(), await workflow.getContentSignature(), 'cal', cal - calBefore);
            await workflow.logContentDebug('success-day1');
            await workflow.takeScreenshot('probe-selector-success.png');
            return;
        }

        // Try click year label
        if (!(await dump(workflow.page)).open) {
            await navTo(workflow, 'Mai', 2026);
        }
        console.log('\n▶ click year label');
        await workflow.page.locator('[data-loga3-month-popup="1"] .datePickerSelectorText .gwt-InlineLabel').nth(1).click();
        await workflow.page.waitForTimeout(1500);
        console.log('after year', await dump(workflow.page));

        // Try click Mai cell AFTER being on Mai active
        if (!(await dump(workflow.page)).open) await navTo(workflow, 'Mai', 2026);
        console.log('\n▶ click Mai grid cell while active=Mai');
        calBefore = cal;
        await workflow.page.locator('[data-loga3-month-popup="1"] table.datePickerMonthPicker td').filter({ hasText: /^Mai$/ }).click();
        await workflow.page.waitForTimeout(2000);
        d = await dump(workflow.page);
        console.log('after mai cell', d, await workflow.getMonthPickerState(), 'cal', cal - calBefore);
        if (d.dayCount > 0) {
            await workflow.page.locator('[data-loga3-month-popup="1"] td').filter({ hasText: /^1$/ }).first().click();
            await workflow.page.waitForTimeout(4000);
            console.log('after day1', await workflow.getMonthPickerState());
            await workflow.logContentDebug('after-day1');
        }

        await workflow.takeScreenshot('probe-selector-text.png');
        await workflow.logContentDebug('end');
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
