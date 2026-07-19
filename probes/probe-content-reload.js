#!/usr/bin/env node
/**
 * Probe: what actually reloads the day grid?
 * Logs network on month arrows, finds BERECHNEN, tries slow/manual-like clicks.
 */
const Loga3Automation = require('../src/loga3-automation.js');
const Loga3Workflow = require('../src/loga3-workflow.js');

async function main() {
    const login = new Loga3Automation();
    const workflow = new Loga3Workflow();
    const net = [];

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
            const url = req.url();
            if (/zeit|month|buchung|abrechnung|lzw|rpc|gwt/i.test(url)) {
                net.push({ t: Date.now(), type: 'req', method: req.method(), url: url.slice(0, 180) });
            }
        });
        workflow.page.on('response', (res) => {
            const url = res.url();
            if (/zeit|month|buchung|abrechnung|lzw|rpc|gwt/i.test(url)) {
                net.push({ t: Date.now(), type: 'res', status: res.status(), url: url.slice(0, 180) });
            }
        });

        await workflow.waitForFullNavigation();
        await workflow.clickOpenButton();
        await workflow.logContentDebug('probe-start');

        const berechn = await workflow.page.evaluate(() => {
            const out = [];
            const walk = (node) => {
                if (node.nodeType === Node.TEXT_NODE && /BERECHN/i.test(node.textContent || '')) {
                    const p = node.parentElement;
                    if (!p) return;
                    const r = p.getBoundingClientRect();
                    out.push({
                        text: (node.textContent || '').trim().slice(0, 40),
                        tag: p.tagName,
                        className: (p.className || '').toString().slice(0, 80),
                        uin: p.getAttribute('data-uin'),
                        x: Math.round(r.x),
                        y: Math.round(r.y),
                        w: Math.round(r.width),
                        h: Math.round(r.height),
                        visible: p.offsetParent !== null,
                    });
                }
                for (const child of node.childNodes) walk(child);
            };
            walk(document.body);
            return out;
        });
        console.log('🔎 BERECHN* nodes:', JSON.stringify(berechn, null, 2));

        const beforeNet = net.length;
        const before = await workflow.getContentSignature();
        console.log('📆 Clicking BACK once (slow)...');
        await workflow.page.waitForTimeout(2000);
        await workflow.clickMonthPickerArrow('back');
        await workflow.page.waitForTimeout(5000);
        const after = await workflow.getContentSignature();
        console.log('🔎 After slow back:', {
            picker: (await workflow.getMonthPickerState())?.label,
            beforeDay: before.firstWeekday,
            afterDay: after.firstWeekday,
            gridChanged: before.gridKey !== after.gridKey,
            netDelta: net.slice(beforeNet),
        });

        if (berechn.length) {
            const hit = berechn.find((b) => b.visible && b.w > 10) || berechn[0];
            console.log('🖱️  Clicking BERECHN at', hit.x + hit.w / 2, hit.y + hit.h / 2);
            await workflow.page.mouse.click(hit.x + hit.w / 2, hit.y + hit.h / 2);
            await workflow.page.waitForTimeout(5000);
            const afterCalc = await workflow.getContentSignature();
            console.log('🔎 After BERECHN click:', {
                day01: afterCalc.firstWeekday,
                lastDay: afterCalc.lastDay,
                gridChanged: after.gridKey !== afterCalc.gridKey,
            });
        } else {
            console.log('🖱️  Fallback click bottom-right for BERECHNEN');
            await workflow.page.mouse.click(1180, 680);
            await workflow.page.waitForTimeout(3000);
            await workflow.page.mouse.click(1100, 650);
            await workflow.page.waitForTimeout(5000);
            console.log('🔎 After coord click:', await workflow.getContentSignature());
        }

        // Try double-click picker then arrow
        console.log('📆 Double-click picker + back...');
        await workflow.page.locator('#ZeitdatenMonthPicker').dblclick();
        await workflow.page.waitForTimeout(1000);
        await workflow.clickMonthPickerArrow('back');
        await workflow.page.waitForTimeout(5000);
        console.log('🔎 After dblclick path:', await workflow.logContentDebug('probe-dblclick'));

        await workflow.takeScreenshot('probe-content-reload.png');
        console.log('🧾 Recent net events:', JSON.stringify(net.slice(-20), null, 2));
    } catch (error) {
        console.error('❌ Probe failed:', error.message);
        process.exitCode = 1;
    } finally {
        await login.cleanup().catch(() => {});
    }
}

main();
