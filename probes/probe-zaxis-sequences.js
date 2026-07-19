#!/usr/bin/env node
/** Reproduce: Aktualisieren → May arrows → Aktualisieren → day01 FR */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function clickAktualisieren(page, label) {
    const sels = [
        '[data-uin="ic-zaxisrotation"]',
        '[aria-label="Aktualisieren"]',
        '[title="Aktualisieren"]',
    ];
    for (const sel of sels) {
        const loc = page.locator(sel);
        const n = await loc.count();
        for (let i = 0; i < n; i++) {
            const el = loc.nth(i);
            const box = await el.boundingBox().catch(() => null);
            const meta = await el.evaluate((node) => ({
                uin: node.getAttribute('data-uin'),
                aria: node.getAttribute('aria-label'),
                cls: (node.className || '').toString().slice(0, 60),
            })).catch(() => ({}));
            console.log(`  candidate ${sel}#${i}`, meta, box);
            try {
                await el.click({ force: true, timeout: 3000 });
                console.log(`  ✅ clicked ${label} via ${sel}#${i}`);
                return true;
            } catch (e) {
                console.log(`  skip ${sel}#${i}`, e.message.slice(0, 60));
            }
        }
    }
    return false;
}

async function dump(workflow, tag) {
    const sig = await workflow.getContentSignature();
    const picker = await workflow.getMonthPickerState();
    console.log(tag, {
        picker: picker?.selecteddate,
        label: picker?.label,
        day01: sig.firstWeekday,
        last: sig.lastDay,
        bookings: sig.bookingsLabel,
    });
    return { sig, picker };
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
                console.log('🌐 cal', cal);
            }
        });

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        await workflow.page.waitForTimeout(2000);
        await dump(workflow, 'open');

        // List all refresh-like nodes
        const refreshNodes = await workflow.page.evaluate(() =>
            [...document.querySelectorAll('[data-uin="ic-zaxisrotation"], [aria-label="Aktualisieren"], [title="Aktualisieren"], [class*="refresh" i], [class*="sync" i]')]
                .map((el, i) => {
                    const r = el.getBoundingClientRect();
                    return {
                        i,
                        uin: el.getAttribute('data-uin'),
                        aria: el.getAttribute('aria-label'),
                        cls: (el.className || '').toString().slice(0, 80),
                        x: Math.round(r.x),
                        y: Math.round(r.y),
                        w: Math.round(r.width),
                        h: Math.round(r.height),
                        visible: el.offsetParent !== null,
                    };
                })
        );
        console.log('refresh nodes', JSON.stringify(refreshNodes, null, 2));

        console.log('\n=== SEQ A: May arrows → Aktualisieren ===');
        await workflow.syncHeaderWithMonthpickerChromeArrows(5, 2026);
        await dump(workflow, 'A-may-header');
        await clickAktualisieren(workflow.page, 'A-refresh');
        await workflow.page.waitForTimeout(5000);
        await workflow.waitForLoadingIndicatorToSettle(20);
        const a = await dump(workflow, 'A-after-refresh');
        if (a.sig.firstWeekday === 'FR' && a.picker?.month === '05') {
            console.log('PASS SEQ A');
            await workflow.takeScreenshot('PASS-seq-A.png');
            return;
        }

        console.log('\n=== SEQ B: Aktualisieren → May arrows → Aktualisieren ===');
        // reset: go to July if needed
        await workflow.syncHeaderWithMonthpickerChromeArrows(7, 2026).catch(() => {});
        await dump(workflow, 'B-july');
        await clickAktualisieren(workflow.page, 'B-refresh1');
        await workflow.page.waitForTimeout(4000);
        await dump(workflow, 'B-after-refresh1');
        await workflow.syncHeaderWithMonthpickerChromeArrows(5, 2026);
        await dump(workflow, 'B-may-header');
        await clickAktualisieren(workflow.page, 'B-refresh2');
        await workflow.page.waitForTimeout(5000);
        await workflow.waitForLoadingIndicatorToSettle(20);
        const b = await dump(workflow, 'B-after-refresh2');
        if (b.sig.firstWeekday === 'FR' && b.picker?.month === '05') {
            console.log('PASS SEQ B');
            await workflow.takeScreenshot('PASS-seq-B.png');
            await workflow.logContentDebug('PASS-B');
            return;
        }

        console.log('\n=== SEQ C: May arrows → click each refresh node by index ===');
        await workflow.syncHeaderWithMonthpickerChromeArrows(5, 2026);
        for (const node of refreshNodes) {
            console.log('try node', node);
            await workflow.syncHeaderWithMonthpickerChromeArrows(5, 2026);
            await workflow.page.evaluate((idx) => {
                const list = [...document.querySelectorAll('[data-uin="ic-zaxisrotation"], [aria-label="Aktualisieren"], [title="Aktualisieren"]')];
                // prefer matching uin+aria from serialized - click by position
                const el = list[idx] || document.querySelector('[data-uin="ic-zaxisrotation"]');
                el?.scrollIntoView({ block: 'center', inline: 'center' });
                el?.click();
            }, node.i);
            // better: click at coordinates
            if (node.w > 0) {
                await workflow.page.mouse.click(node.x + node.w / 2, node.y + node.h / 2);
            }
            await workflow.page.waitForTimeout(4500);
            const c = await dump(workflow, `C-node-${node.i}`);
            if (c.sig.firstWeekday === 'FR' && c.picker?.month === '05') {
                console.log('PASS SEQ C node', node);
                await workflow.takeScreenshot(`PASS-seq-C-${node.i}.png`);
                return;
            }
        }

        console.log('FAIL all sequences');
        await workflow.takeScreenshot('FAIL-zaxis-sequences.png');
        process.exitCode = 1;
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}
main();
