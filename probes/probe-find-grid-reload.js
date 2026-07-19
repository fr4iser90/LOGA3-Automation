#!/usr/bin/env node
/**
 * Find ANY action that changes day01 after header is on May.
 * Success = firstWeekday becomes FR (May 1 2026).
 */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function main() {
    const login = new Loga3Automation();
    const workflow = new Loga3Workflow();
    const hits = [];
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
        await workflow.page.waitForTimeout(2000);

        // Header → May via chrome arrows
        console.log('▶ sync header to May');
        await workflow.syncHeaderWithMonthpickerChromeArrows(5, 2026);
        let sig = await workflow.getContentSignature();
        console.log('after header sync', {
            picker: await workflow.getMonthPickerState(),
            day01: sig.firstWeekday,
            bookings: sig.bookingsLabel,
        });

        const expectWd = 'FR';
        const tryAction = async (name, fn) => {
            const before = await workflow.getContentSignature();
            const calBefore = cal;
            // ensure still on May header
            const st = await workflow.getMonthPickerState();
            if (st?.month !== '05') {
                await workflow.syncHeaderWithMonthpickerChromeArrows(5, 2026);
            }
            console.log(`\n▶ ${name}`);
            try {
                await fn();
            } catch (e) {
                console.log('  err', e.message.slice(0, 120));
                return false;
            }
            await workflow.page.waitForTimeout(2500);
            await workflow.waitForLoadingIndicatorToSettle(12);
            const after = await workflow.getContentSignature();
            const picker = await workflow.getMonthPickerState();
            const row = {
                name,
                day01: `${before.firstWeekday}→${after.firstWeekday}`,
                last: `${before.lastDay}→${after.lastDay}`,
                picker: picker?.selecteddate,
                bookings: after.bookingsLabel,
                gridChanged: before.gridKey !== after.gridKey,
                calDelta: cal - calBefore,
            };
            console.log('  ', row);
            if (after.firstWeekday === expectWd) {
                console.log('✅✅✅ GRID RELOADED via', name);
                hits.push(row);
                await workflow.takeScreenshot(`FOUND-grid-reload-${name.replace(/\W+/g, '_')}.png`);
                await workflow.logContentDebug('FOUND-' + name);
                return true;
            }
            return false;
        };

        // 1) Close with May header, reopen (does open load May?)
        if (await tryAction('close-reopen-with-may-header', async () => {
            await workflow.closeZeitdatenMask();
            await workflow.page.waitForTimeout(1000);
            await workflow.clickOpenButton();
            await workflow.page.waitForTimeout(3000);
        })) return;

        // Re-sync May if reopen reset
        await workflow.syncHeaderWithMonthpickerChromeArrows(5, 2026);

        // 2) Dump every visible button/icon and click promising ones
        const candidates = await workflow.page.evaluate(() => {
            const out = [];
            const nodes = document.querySelectorAll(
                '[data-uin], [aria-label], [role="button"], .LG-Button, .LG-Icon, button'
            );
            let i = 0;
            for (const el of nodes) {
                if (!el || el.offsetParent === null) continue;
                const r = el.getBoundingClientRect();
                if (r.width < 4 || r.height < 4) continue;
                if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
                const uin = el.getAttribute('data-uin') || '';
                const aria = el.getAttribute('aria-label') || '';
                const text = (el.textContent || '').trim().slice(0, 40);
                const id = `loga3-probe-${i++}`;
                el.setAttribute('data-loga3-probe', id);
                out.push({ id, uin, aria, text, x: Math.round(r.x), y: Math.round(r.y) });
            }
            return out;
        });
        console.log('visible controls', candidates.length);

        const interesting = candidates.filter((c) => {
            const blob = `${c.uin} ${c.aria} ${c.text}`.toLowerCase();
            return /berechn|refresh|reload|aktual|neu\s*laden|calendar|kalender|zaxis|rotate|sync|speichern|team|person|öffnen|mask|zeit/i.test(blob);
        });
        console.log('interesting', interesting);

        for (const c of interesting) {
            const ok = await tryAction(`click-${c.uin || c.aria || c.text || c.id}`, async () => {
                await workflow.page.locator(`[data-loga3-probe="${c.id}"]`).click({ force: true, timeout: 3000 });
            });
            if (ok) return;
        }

        // 3) Coordinate click BERECHNEN area (bottom-right of mask)
        if (await tryAction('coord-berechnen-mask', async () => {
            const box = await workflow.page.locator('[data-uin="mask-LZWZEITD"]').boundingBox();
            if (!box) throw new Error('no mask');
            await workflow.page.mouse.click(box.x + box.width - 40, box.y + box.height - 30);
            await workflow.page.waitForTimeout(500);
            await workflow.page.mouse.click(box.x + box.width - 80, box.y + box.height - 25);
        })) return;

        // 4) Full-page scan for BERECHN text nodes including hidden
        if (await tryAction('scan-click-BERECHN', async () => {
            const found = await workflow.page.evaluate(() => {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let n;
                while ((n = walker.nextNode())) {
                    if (/BERECHN/i.test(n.textContent || '')) {
                        const p = n.parentElement;
                        p?.scrollIntoView({ block: 'center' });
                        p?.click();
                        return (n.textContent || '').trim().slice(0, 40);
                    }
                }
                return null;
            });
            if (!found) throw new Error('BERECHN text not in DOM');
            console.log('  clicked text', found);
        })) return;

        // 5) Person suchen: type something and clear / select first result
        if (await tryAction('person-search-cycle', async () => {
            const input = workflow.page.locator('[aria-label="Person suchen..."], input[placeholder*="Person"]').first();
            await input.click({ timeout: 3000 });
            await input.fill('Böhme');
            await workflow.page.waitForTimeout(1500);
            await workflow.page.keyboard.press('ArrowDown');
            await workflow.page.keyboard.press('Enter');
            await workflow.page.waitForTimeout(2000);
        })) return;

        // 6) Click day row 01 after May header
        if (await tryAction('click-day-01-row', async () => {
            await workflow.page.evaluate(() => {
                const mask = document.querySelector('[data-uin="mask-LZWZEITD"]');
                const text = mask?.innerText || '';
                // find element containing "01 MI" or "01 "
                const all = mask?.querySelectorAll('*') || [];
                for (const el of all) {
                    const t = (el.childNodes[0]?.textContent || el.textContent || '').trim();
                    if (/^01\s*(MO|DI|MI|DO|FR|SA|SO)?$/.test(t) && el.getBoundingClientRect().height > 8) {
                        el.click();
                        return;
                    }
                }
                throw new Error('day01 el not found');
            });
        })) return;

        // 7) Keyboard on picker: focus picker, Home/End, type date?
        if (await tryAction('picker-keyboard-date', async () => {
            await workflow.page.locator('#ZeitdatenMonthPicker').click();
            await workflow.page.keyboard.type('05/01/2026');
            await workflow.page.keyboard.press('Enter');
            await workflow.page.waitForTimeout(1000);
            await workflow.page.keyboard.press('Escape');
        })) return;

        // 8) Double-click picker, select Mai, then chrome sync, then ic-zaxisrotation WHILE keeping may via hook
        if (await tryAction('may-header-then-zaxis-with-hook', async () => {
            await workflow.syncHeaderWithMonthpickerChromeArrows(5, 2026);
            await workflow.page.evaluate(() => {
                const picker = document.querySelector('#ZeitdatenMonthPicker');
                const orig = picker.setAttribute.bind(picker);
                picker.setAttribute = (name, value) => {
                    if (name === 'selecteddate' && value && value.startsWith('07/')) {
                        value = '05/01/2026';
                    }
                    return orig(name, value);
                };
            });
            await workflow.page.locator('[data-uin="ic-zaxisrotation"]').first().click({ force: true });
            await workflow.page.waitForTimeout(4000);
        })) return;

        // 9) Left nav calendar icon by coordinates (was outside viewport)
        if (await tryAction('sidebar-calendar-icon-coord', async () => {
            const el = workflow.page.locator('[data-uin="ic-calendaralt"]').first();
            const box = await el.boundingBox();
            if (!box) throw new Error('no calendar icon box');
            // scroll container left
            await workflow.page.evaluate(() => {
                const icon = document.querySelector('[data-uin="ic-calendaralt"]');
                icon?.scrollIntoView({ block: 'center', inline: 'center' });
            });
            await workflow.page.waitForTimeout(500);
            await el.click({ force: true, timeout: 5000 });
            await workflow.page.waitForTimeout(2000);
            // may need öffnen again
            const hasPicker = await workflow.page.locator('#ZeitdatenMonthPicker').isVisible().catch(() => false);
            if (!hasPicker) await workflow.clickOpenButton();
            await workflow.syncHeaderWithMonthpickerChromeArrows(5, 2026);
        })) return;

        // 10) Open monthpicker, nav to Mai, click Mai, immediately chrome-sync, wait longer
        if (await tryAction('monthpicker-mai-then-long-wait', async () => {
            await workflow.selectMonthViaMonthpickerOnly(5, 2026);
            await workflow.page.waitForTimeout(8000);
        })) return;

        console.log('\n❌ No action changed day01 to FR');
        console.log('hits', hits);
        await workflow.takeScreenshot('probe-no-grid-reload.png');
        await workflow.logContentDebug('no-grid-reload');
        process.exitCode = 1;
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}

main();
