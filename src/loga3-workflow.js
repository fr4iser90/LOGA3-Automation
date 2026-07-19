#!/usr/bin/env node

const { chromium, firefox } = require('playwright');
const path = require('path');
const fs = require('fs');
const { parseAbrechnungsmonat, periodToFilename } = require('./loga3-period');
const { MONTH_LABELS, getDownloadsDir, getLogsDir, resolveHeadless } = require('./loga3-inventory');
const { applySettingsToEnv } = require('./loga3-settings');

const WEEKDAY_CODES = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];

function expectedFirstWeekdayCode(month, year) {
    const date = new Date(Number(year), Number(month) - 1, 1);
    return WEEKDAY_CODES[date.getDay()];
}

const { debugLog, debugError, isDebug } = require('./loga3-log');

require('dotenv').config({
    path: process.env.LOGA3_PORTABLE_ROOT
        ? path.join(process.env.LOGA3_PORTABLE_ROOT, '.env')
        : path.join(__dirname, '..', '.env'),
    quiet: true,
});
applySettingsToEnv(process.env);

let config = {};
try {
    config = require(path.join(__dirname, '..', 'loga3-config.js'));
} catch (error) {
    debugLog('ℹ️  No loga3-config.js — using GUI settings / .env / environment variables');
}

/**
 * LOGA3 Workflow Automation Script
 * Handles the specific workflow after login
 */
class Loga3Workflow {
    constructor() {
        this.browser = null;
        this.page = null;
        this.browserConfig = config.browser || {};
        this.screenshotConfig = config.screenshots || {};
        this.downloadsDir = getDownloadsDir();
        this.lastSavedDownloadPath = null;
        this.elementTimeout = this.browserConfig.timeout || 60000;
        this.pageLoadTimeout = this.browserConfig.pageLoadTimeout || 90000;
        this.stepDelay = this.browserConfig.sleepBetweenSteps || 4000;
        this.uiDelay = Math.min(this.stepDelay, 1200);
        this._calendarReloadArmed = false;
    }

    async getMainContentSnapshot() {
        if (!this.page) return { sample: '', length: 0 };

        return this.page.evaluate(() => {
            const removeIds = ['ZeitdatenMonthPicker'];
            const roots = [
                document.querySelector('.BewerberMaskLayout'),
                document.querySelector('[class*="MaskLayout"]'),
                document.querySelector('.LG-MainContent'),
                document.body,
            ].filter(Boolean);

            const root = roots[0] || document.body;
            const clone = root.cloneNode(true);

            removeIds.forEach((id) => {
                clone.querySelectorAll(`#${id}`).forEach((element) => element.remove());
            });
            clone.querySelectorAll('[data-uin="ic-previous"], [data-uin="ic-next"], [aria-label="Vorheriger Monat"], [aria-label="Nächster Monat"]').forEach((element) => {
                element.remove();
            });

            const text = (clone.innerText || '').replace(/\s+/g, ' ').trim();
            return {
                sample: text.slice(0, 1200),
                length: text.length,
            };
        }).catch(() => ({ sample: '', length: 0 }));
    }

    async waitForMainContentRefresh(beforeSnapshot, targetMonth, targetYear, timeout = 35000) {
        const mm = targetMonth ? String(targetMonth).padStart(2, '0') : null;
        const year = targetYear ? String(targetYear) : null;
        const monthLabel = targetMonth ? MONTH_LABELS[targetMonth - 1] : null;
        const before = beforeSnapshot || { sample: '', length: 0 };

        debugLog('⏳ Waiting for main content area to update...');

        await this.waitForLoadingIndicatorToSettle(20);

        try {
            await this.page.waitForFunction((prev, target) => {
                const roots = [
                    document.querySelector('.BewerberMaskLayout'),
                    document.querySelector('[class*="MaskLayout"]'),
                    document.querySelector('.LG-MainContent'),
                    document.body,
                ].filter(Boolean);
                const root = roots[0] || document.body;
                const clone = root.cloneNode(true);
                clone.querySelectorAll('#ZeitdatenMonthPicker, [data-uin="ic-previous"], [data-uin="ic-next"]').forEach((element) => element.remove());
                const text = (clone.innerText || '').replace(/\s+/g, ' ').trim();
                const sample = text.slice(0, 1200);

                const changed = Boolean(prev.sample) && sample !== prev.sample;
                const hasTarget = target.mm && (
                    text.includes(`${target.mm}/${target.year}`) ||
                    text.includes(`${target.mm}.${target.year}`) ||
                    (target.monthLabel && text.includes(`${target.monthLabel} ${target.year}`)) ||
                    (target.monthLabel && text.includes(target.monthLabel))
                );

                if (changed && (!target.mm || hasTarget)) return true;
                if (changed && sample.length > 80) return true;
                return false;
            }, before, { mm, year, monthLabel }, { timeout });

            await this.waitForLoadingIndicatorToSettle(10);
            await this.page.waitForTimeout(this.uiDelay);
            debugLog('✅ Main content area updated');
            return true;
        } catch {
            debugLog('⚠️  Main content area did not change in time');
            return false;
        }
    }

    async waitForMonthNavigationSettled(beforeHeader, beforeContent, targetMonth = null, targetYear = null) {
        await this.waitForMonthPickerChange(beforeHeader, 8000);
        const timeout = targetMonth ? 35000 : 18000;
        return this.waitForMainContentRefresh(beforeContent, targetMonth, targetYear, timeout);
    }

    async getCalendarContentState() {
        return this.page.evaluate(() => {
            // Prefer Zeitdaten mask — picker/header lives outside and misleads content reads.
            const roots = [
                document.querySelector('[data-uin="mask-LZWZEITD"]'),
                document.querySelector('.BewerberMaskLayout'),
                document.querySelector('[class*="MaskLayout"]'),
                document.querySelector('.LG-MainContent'),
                document.body,
            ].filter(Boolean);

            const isVisible = (el) => {
                if (!el || !(el instanceof Element)) return false;
                if (el.offsetParent === null && el !== document.body) return false;
                const style = window.getComputedStyle(el);
                if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
                    return false;
                }
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };

            const visibleTextFrom = (root) => {
                // innerText on mask is more reliable than a custom walk for GWT widgets.
                if (root && typeof root.innerText === 'string' && root.innerText.trim()) {
                    return root.innerText.replace(/\s+/g, ' ').trim();
                }
                const parts = [];
                const walk = (node) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const parent = node.parentElement;
                        if (parent && isVisible(parent)) {
                            const value = (node.textContent || '').trim();
                            if (value) parts.push(value);
                        }
                        return;
                    }
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    if (!isVisible(node)) return;
                    for (const child of node.childNodes) walk(child);
                };
                walk(root);
                return parts.join(' ').replace(/\s+/g, ' ').trim();
            };

            const root = roots[0] || document.body;
            const text = visibleTextFrom(root);

            const dayMatches = [];
            for (const match of text.matchAll(/\b([0-3]\d)\s*(MO|DI|MI|DO|FR|SA|SO)\b/g)) {
                dayMatches.push({ day: match[1], wd: match[2] });
            }

            const first = dayMatches.find((entry) => entry.day === '01') || null;
            const last = dayMatches.length ? dayMatches[dayMatches.length - 1] : null;
            const bookings = text.match(/Buchungen für\s+([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/i);
            const picker = document.querySelector('#ZeitdatenMonthPicker');

            return {
                firstWeekday: first ? first.wd : null,
                firstDay: first ? first.day : null,
                lastDay: last ? last.day : null,
                dayCount: dayMatches.length,
                daySample: dayMatches.slice(0, 10),
                bookingsLabel: bookings ? `${bookings[1]} ${bookings[2]}` : null,
                bookingsMonth: bookings ? bookings[1] : null,
                bookingsYear: bookings ? bookings[2] : null,
                pickerLabel: picker ? (picker.textContent || '').trim() : '',
                pickerDate: picker ? (picker.getAttribute('selecteddate') || '') : '',
                rootUin: root.getAttribute?.('data-uin') || root.className || 'body',
                sample: text.slice(0, 500),
            };
        }).catch(() => null);
    }

    /**
     * Content signature without hour-axis noise (0:00..23:00).
     * Uses booking ranges / KO*|GE* times + Buchungen-für + day01.
     */
    async getContentSignature() {
        return this.page.evaluate(() => {
            const mask = document.querySelector('[data-uin="mask-LZWZEITD"]')
                || document.querySelector('.BewerberMaskLayout')
                || document.body;
            const text = (mask?.innerText || document.body?.innerText || '').replace(/\s+/g, ' ').trim();
            const bookings = text.match(/Buchungen für\s+([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/i);
            const days = [...text.matchAll(/\b([0-3]\d)\s*(MO|DI|MI|DO|FR|SA|SO)\b/g)];
            const first = days.find((entry) => entry[1] === '01') || null;
            const last = days.length ? days[days.length - 1] : null;
            const ranges = [...text.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)]
                .map((m) => `${m[1]}-${m[2]}`);
            const geKo = [...text.matchAll(/(?:KO\*|GE\*)\s*(\d{1,2}:\d{2})/g)].map((m) => m[1]);
            const schichtfrei = (text.match(/SCHICHTFREI/g) || []).length;
            const bookingsLabel = bookings ? `${bookings[1]} ${bookings[2]}` : null;
            const firstWeekday = first ? first[2] : null;
            const lastDay = last ? last[1] : null;
            const key = [
                bookingsLabel || 'no-bookings',
                firstWeekday ? `01${firstWeekday}` : 'no01',
                lastDay ? `L${lastDay}` : 'noL',
                `sf${schichtfrei}`,
                `r${ranges.slice(0, 15).join(',')}`,
                `g${geKo.slice(0, 15).join(',')}`,
            ].join('|');
            // Grid key ignores Buchungen-für title (same widget as picker — flips without reload).
            const gridKey = [
                firstWeekday ? `01${firstWeekday}` : 'no01',
                lastDay ? `L${lastDay}` : 'noL',
                `sf${schichtfrei}`,
                `r${ranges.slice(0, 15).join(',')}`,
                `g${geKo.slice(0, 15).join(',')}`,
            ].join('|');

            return {
                key,
                gridKey,
                bookingsLabel,
                firstWeekday,
                lastDay,
                dayCount: days.length,
                schichtfrei,
                ranges: ranges.slice(0, 20),
                geKo: geKo.slice(0, 20),
                sample: text.slice(0, 280),
            };
        }).catch(() => ({
            key: 'sig-unavailable',
            gridKey: 'sig-unavailable',
            bookingsLabel: null,
            firstWeekday: null,
            lastDay: null,
            dayCount: 0,
            schichtfrei: 0,
            ranges: [],
            geKo: [],
            sample: '',
        }));
    }

    async logContentDebug(event, extra = {}) {
        const sig = await this.getContentSignature();
        const picker = await this.getMonthPickerState();
        const entry = {
            ts: new Date().toISOString(),
            event,
            picker: picker ? `${picker.month}/${picker.year}` : null,
            selecteddate: picker?.selecteddate || null,
            bookingsLabel: sig.bookingsLabel,
            firstWeekday: sig.firstWeekday,
            lastDay: sig.lastDay,
            dayCount: sig.dayCount,
            key: sig.key,
            ...extra,
        };

        try {
            const dir = getLogsDir();
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(path.join(dir, 'content-debug.jsonl'), `${JSON.stringify(entry)}\n`);
        } catch {
            // ignore log write failures
        }

        debugLog(
            `🧪 CONTENT[${event}] picker=${entry.picker || '?'} `
            + `bookings=${entry.bookingsLabel || '?'} day01=${entry.firstWeekday || '?'} `
            + `last=${entry.lastDay || '?'} days=${entry.dayCount || 0}`
        );
        return { sig, picker, entry };
    }

    async waitForContentSignatureChange(beforeSigOrKey, timeoutMs = 18000) {
        const before = typeof beforeSigOrKey === 'string'
            ? { key: beforeSigOrKey, gridKey: beforeSigOrKey }
            : (beforeSigOrKey || {});
        const beforeGridKey = before.gridKey || before.key;
        if (!beforeGridKey) return this.getContentSignature();

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const sig = await this.getContentSignature();
            // Ignore Buchungen-für title flips — only day01 / lastDay / booking ranges count.
            if (sig.gridKey && sig.gridKey !== beforeGridKey) {
                debugLog(
                    `✅ Day-grid changed: ${beforeGridKey.slice(0, 40)} → ${sig.gridKey.slice(0, 40)}`
                );
                return sig;
            }
            await this.waitForLoadingIndicatorToSettle(2);
            await this.page.waitForTimeout(400);
        }
        debugLog('⚠️  Day-grid did not change in time (title-only flips ignored)');
        return null;
    }

    async verifyCalendarShowsMonth(targetMonth, targetYear, options = {}) {
        const quiet = Boolean(options.quiet);
        const mm = String(targetMonth).padStart(2, '0');
        const year = String(targetYear);
        const monthLabel = MONTH_LABELS[targetMonth - 1];
        const expectedWd = expectedFirstWeekdayCode(targetMonth, targetYear);
        const expectedLastDay = String(new Date(Number(year), Number(targetMonth), 0).getDate());
        const { sig, picker } = quiet
            ? { sig: await this.getContentSignature(), picker: await this.getMonthPickerState() }
            : await this.logContentDebug('verify', {
                target: `${mm}/${year}`,
                expectedWd,
                expectedLastDay,
            });

        const headerOk = Boolean(picker?.month === mm && picker?.year === year);
        // NOTE: "Buchungen für <Month>" lives in the SAME header widget as the picker —
        // it flips with selecteddate even when the day grid stays on the old month.
        // Real content signals: day01 weekday + last day of month.
        const weekdayOk = sig.firstWeekday === expectedWd;
        const lastDayOk = sig.lastDay === expectedLastDay;
        const titleFlipOnly = Boolean(
            sig.bookingsLabel
            && sig.bookingsLabel.toLowerCase() === `${monthLabel} ${year}`.toLowerCase()
        );

        if (!quiet) {
            debugLog(
                `🔎 CONTENT CHECK target=${monthLabel} ${year} expectedDay01=${expectedWd} last=${expectedLastDay} | `
                + `picker=${picker?.label || picker?.selecteddate || '?'} `
                + `titleFlip=${titleFlipOnly} day01=${sig.firstWeekday || '?'} `
                + `lastDay=${sig.lastDay || '?'} days=${sig.dayCount || 0} `
                + `| headerOk=${headerOk} weekdayOk=${weekdayOk} lastDayOk=${lastDayOk}`
            );
        }

        if (!headerOk) {
            if (!quiet) debugLog('❌ CONTENT INVALID: selecteddate/header does not match target');
            return false;
        }

        if (!sig.firstWeekday) {
            if (!quiet) debugLog('❌ CONTENT INVALID: could not read day01 weekday from grid');
            return false;
        }

        if (!weekdayOk) {
            if (!quiet) {
                debugLog(
                    `❌ CONTENT INVALID: grid day01=${sig.firstWeekday} expected=${expectedWd} `
                    + `(header/title may have flipped without reloading the day grid)`
                );
            }
            return false;
        }

        // June etc.: last day must shrink (catches sticky 31-day July grid).
        if (sig.lastDay && !lastDayOk) {
            if (!quiet) {
                debugLog(
                    `❌ CONTENT INVALID: grid lastDay=${sig.lastDay} expected=${expectedLastDay}`
                );
            }
            return false;
        }

        if (!quiet) {
            debugLog('✅ CONTENT VALID (header + day01 weekday' + (sig.lastDay ? ' + lastDay' : '') + ')');
        }
        return true;
    }

    async pageMentionsTargetMonth(targetMonth, targetYear) {
        // Content mention = grid weekday/lastDay match, not the header title flip.
        return this.verifyCalendarShowsMonth(targetMonth, targetYear);
    }

    async getBookingFingerprint() {
        const sig = await this.getContentSignature();
        return sig.key;
    }

    async returnToHeaderMonth(targetMonth, targetYear) {
        return this.selectMonthViaMonthpickerOnly(targetMonth, targetYear);
    }

    /**
     * Force day-grid reload: re-arm Aktualisieren, then navigate to target again.
     */
    async forceGridReload(targetMonth, targetYear) {
        const mm = String(targetMonth).padStart(2, '0');
        const year = String(targetYear);
        await this.logContentDebug('force-reload-start', { target: `${mm}/${year}` });

        this._calendarReloadArmed = false;
        await this.armCalendarMonthReload();

        // Step away then back so armed arrows reload content.
        const awayMonth = targetMonth === 12 ? 1 : targetMonth + 1;
        const awayYear = targetMonth === 12 ? targetYear + 1 : targetYear;
        await this.syncHeaderWithMonthpickerChromeArrows(awayMonth, awayYear);
        await this.syncHeaderWithMonthpickerChromeArrows(targetMonth, targetYear);

        await this.logContentDebug('force-reload-end', { target: `${mm}/${year}` });
        return this.verifyCalendarShowsMonth(targetMonth, targetYear);
    }

    async closeZeitdatenMask() {
        const selectors = [
            '[data-uin="mask-LZWZEITD"] [aria-label="Schließen"]',
            '[data-uin="mask-LZWZEITD"] [data-uin="ic-delete"]',
            '[data-uin="mask-LZWZEITD"] [title="Schließen"]',
            '.BewerberMaskLayout [aria-label="Schließen"]',
            '[data-uin="ic-delete"][aria-label="Schließen"]',
        ];
        for (const selector of selectors) {
            try {
                const locator = this.page.locator(selector).filter({ visible: true }).first();
                if (await locator.isVisible({ timeout: 1500 })) {
                    await locator.click({ timeout: 3000 });
                    debugLog(`✅ Closed Zeitdaten mask (${selector})`);
                    await this.waitForLoadingIndicatorToSettle(10);
                    return true;
                }
            } catch {
                continue;
            }
        }
        debugLog('⚠️  Could not find Zeitdaten mask close control');
        return false;
    }

    /** Move header to target via Monthpicker only (no arrows). */
    async navigateHeaderToMonth(targetMonth, targetYear) {
        return this.selectMonthViaMonthpickerOnly(targetMonth, targetYear);
    }

    async nudgeMonthContentReload(targetMonth, targetYear) {
        debugLog('🔄 Nudge = Monthpicker re-select (arrows disabled)');
        return this.forceGridReload(targetMonth, targetYear);
    }

    async assertContentReadyBeforeExport(targetMonth, targetYear) {
        const label = `${String(targetMonth).padStart(2, '0')}/${targetYear}`;
        debugLog(`🔒 Pre-export content gate for ${label} — will NOT export until day-grid is valid`);

        for (let attempt = 1; attempt <= 8; attempt++) {
            await this.logContentDebug('gate-attempt', { attempt, target: label });
            if (await this.verifyCalendarShowsMonth(targetMonth, targetYear)) {
                await this.clickBerechnenIfPresent();
                if (await this.verifyCalendarShowsMonth(targetMonth, targetYear)) {
                    debugLog(`✅ Pre-export gate passed for ${label}`);
                    await this.logContentDebug('gate-passed', { target: label });
                    return true;
                }
            }

            debugLog(`⏳ Content not ready for export (${attempt}/8) — forcing grid reload`);
            await this.nudgeMonthContentReload(targetMonth, targetYear);
            await this.page.waitForTimeout(1000);
        }

        await this.takeScreenshot(`content-invalid-before-export-${targetMonth}-${targetYear}.png`);
        await this.logContentDebug('gate-failed', { target: label });
        throw new Error(
            `Refusing export: calendar day-grid not validated for ${label} `
            + `(header/Buchungen-für title alone is not enough)`
        );
    }

    /**
     * True when the visible month has real schedule content (shifts / times / SCHICHTFREI).
     * Empty future months with only the hour axis / holidays are rejected.
     */
    async hasSchedulePlan() {
        const sig = await this.getContentSignature();
        const ranges = sig.ranges?.length || 0;
        const punches = sig.geKo?.length || 0;
        const free = sig.schichtfrei || 0;
        const hasPlan = ranges > 0 || punches > 0 || free > 0;
        debugLog(
            `📋 Schedule check: ranges=${ranges} punches=${punches} schichtfrei=${free} → ${hasPlan ? 'plan' : 'empty'}`
        );
        return hasPlan;
    }

    async assertMonthHasPlan(targetMonth, targetYear) {
        if (await this.hasSchedulePlan()) return true;
        await this.takeScreenshot(`no-plan-${targetMonth}-${targetYear}.png`).catch(() => {});
        const err = new Error(`NO_PLAN:${String(targetMonth).padStart(2, '0')}/${targetYear}`);
        err.code = 'NO_PLAN';
        err.targetMonth = targetMonth;
        err.targetYear = targetYear;
        throw err;
    }

    async writeNoPlanMarker(targetMonth, targetYear) {
        if (!targetMonth || !targetYear) return;
        const filename = periodToFilename(targetMonth, targetYear);
        if (!filename) return;
        if (!fs.existsSync(this.downloadsDir)) {
            fs.mkdirSync(this.downloadsDir, { recursive: true });
        }
        const markerPath = path.join(this.downloadsDir, `${filename}.noplan`);
        await fs.promises.writeFile(
            markerPath,
            `${JSON.stringify({
                month: targetMonth,
                year: targetYear,
                reason: 'no-schedule',
                checkedAt: new Date().toISOString(),
            }, null, 2)}\n`,
            'utf8'
        );
        debugLog(`📝 No-plan marker: ${markerPath}`);
    }

    async clearNoPlanMarker(filename) {
        if (!filename) return;
        const markerPath = path.join(this.downloadsDir, `${filename}.noplan`);
        await fs.promises.unlink(markerPath).catch(() => {});
    }

    async waitUntilCalendarShowsMonth(targetMonth, targetYear, timeoutMs = 45000) {
        const deadline = Date.now() + timeoutMs;
        let lastLog = 0;
        while (Date.now() < deadline) {
            const ok = await this.verifyCalendarShowsMonth(targetMonth, targetYear, { quiet: true });
            if (ok) {
                await this.verifyCalendarShowsMonth(targetMonth, targetYear);
                debugLog('✅ Calendar grid matches target month');
                return true;
            }
            // verify already logs; throttle extra noise by short sleeps
            await this.waitForLoadingIndicatorToSettle(3);
            const now = Date.now();
            if (now - lastLog > 4000) {
                lastLog = now;
                debugLog('⏳ Still waiting for day-grid reload...');
            }
            await this.page.waitForTimeout(800);
        }
        debugLog('❌ Calendar grid still does not match target month');
        return false;
    }

    async getDialogAbrechnungsmonat() {
        return this.page.evaluate(() => {
            const dialogs = [
                ...document.querySelectorAll('.gwt-DialogBox'),
                ...document.querySelectorAll('[class*="Dialog"]'),
                ...document.querySelectorAll('.popupContent'),
            ];
            const texts = dialogs
                .filter((el) => el && el.offsetParent !== null)
                .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim());

            // Prefer visible dialog text; fall back to body snippet around Herunterladen.
            let blob = texts.join(' \n ');
            if (!blob.includes('Herunterladen')) {
                blob = (document.body?.innerText || '').replace(/\s+/g, ' ');
            }

            const labeled = blob.match(/Abrechnungsmonat\s*[:\-]?\s*(\d{1,2})\s*[\/.\-]\s*(\d{4})/i)
                || blob.match(/Abrechnungsmonat\s*[:\-]?\s*([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/i);
            if (labeled) {
                return { raw: labeled[0], monthToken: labeled[1], year: labeled[2], source: 'dialog-label' };
            }

            const generic = blob.match(/\b(0?[1-9]|1[0-2])\s*[\/.\-]\s*(20\d{2})\b/);
            if (generic) {
                return { raw: generic[0], monthToken: generic[1], year: generic[2], source: 'dialog-generic' };
            }

            return { raw: blob.slice(0, 300), monthToken: null, year: null, source: 'dialog-missing' };
        }).catch(() => null);
    }

    async getMonthPickerSnapshot() {
        if (!this.page) return null;
        return this.page.evaluate(() => {
            const picker = document.querySelector('#ZeitdatenMonthPicker');
            if (!picker) return null;
            return {
                selecteddate: picker.getAttribute('selecteddate') || '',
                label: (picker.textContent || '').trim(),
            };
        }).catch(() => null);
    }

    async waitForLoadingIndicatorToSettle(maxSeconds = 15) {
        for (let check = 0; check < maxSeconds; check++) {
            const busy = await this.page.evaluate(() => {
                if (document.querySelector('[aria-busy="true"]')) return true;
                const selectors = [
                    '[class*="loading" i]',
                    '[class*="spinner" i]',
                    '[class*="wait" i]',
                    '.gwt-PopupPanelGlass',
                ];
                return selectors.some((selector) => {
                    const elements = document.querySelectorAll(selector);
                    return Array.from(elements).some((element) => element.offsetParent !== null);
                });
            }).catch(() => false);

            if (!busy) return;
            await this.page.waitForTimeout(500);
        }
    }

    async waitForUiReady(label = '') {
        if (label) debugLog(`⏳ UI ready: ${label}`);
        await this.waitForLoadingIndicatorToSettle(12);
        await this.page.waitForTimeout(this.uiDelay);
        if (label) debugLog(`✅ UI ready: ${label}`);
    }

    async waitForFullNavigation() {
        debugLog('⏳ Waiting for initial navigation...');
        try {
            await this.page.waitForLoadState('domcontentloaded', { timeout: this.pageLoadTimeout });
        } catch {
            debugLog('ℹ️  domcontentloaded timeout, continuing...');
        }
        await this.waitForUiReady('Navigation');
    }

    async waitForPageLoad() {
        await this.waitForUiReady('Legacy page load');
    }

    async waitForSelectorReady(selector, label = selector) {
        await this.page.waitForSelector(selector, {
            timeout: this.elementTimeout,
            state: 'visible',
        });
        await this.page.waitForFunction((sel) => {
            const element = document.querySelector(sel);
            return element && element.offsetParent !== null;
        }, selector, { timeout: this.elementTimeout });
        await this.waitForLoadingIndicatorToSettle(8);
        debugLog(`✅ Element ready: ${label}`);
    }

    async waitForMonthPickerReady() {
        await this.waitForSelectorReady('#ZeitdatenMonthPicker', 'ZeitdatenMonthPicker');
    }

    async waitForMonthPickerChange(beforeState, timeout = 15000) {
        const before = beforeState || { selecteddate: '', label: '' };

        try {
            await this.page.waitForFunction((prev) => {
                const picker = document.querySelector('#ZeitdatenMonthPicker');
                if (!picker) return false;
                const selecteddate = picker.getAttribute('selecteddate') || '';
                const label = (picker.textContent || '').trim();
                if (prev.selecteddate && selecteddate !== prev.selecteddate) return true;
                if (prev.label && label !== prev.label) return true;
                return false;
            }, before, { timeout });
            return true;
        } catch {
            return false;
        }
    }

    async clickMonthPickerArrow(direction) {
        // Prefer arrows near #ZeitdatenMonthPicker — unscoped ic-previous/next can hit the wrong widget.
        const uin = direction === 'back' ? 'ic-previous' : 'ic-next';
        const aria = direction === 'back' ? 'Vorheriger Monat' : 'Nächster Monat';

        const nearPicker = await this.page.evaluate(({ uinName, ariaName }) => {
            const picker = document.querySelector('#ZeitdatenMonthPicker');
            if (!picker) return null;
            let root = picker.parentElement;
            for (let depth = 0; depth < 5 && root; depth += 1) {
                const candidates = [
                    ...root.querySelectorAll(`[data-uin="${uinName}"]`),
                    ...root.querySelectorAll(`[aria-label="${ariaName}"]`),
                ];
                const visible = candidates.find((el) => el && el.offsetParent !== null);
                if (visible) {
                    visible.setAttribute('data-loga3-arrow-target', '1');
                    return { depth, uin: visible.getAttribute('data-uin') };
                }
                root = root.parentElement;
            }
            return null;
        }, { uinName: uin, ariaName: aria });

        if (nearPicker) {
            try {
                const beforeSig = await this.getContentSignature();
                const locator = this.page.locator('[data-loga3-arrow-target="1"]').first();
                await locator.click({ delay: 450 });
                await this.page.evaluate(() => {
                    document.querySelectorAll('[data-loga3-arrow-target]').forEach((el) => {
                        el.removeAttribute('data-loga3-arrow-target');
                    });
                }).catch(() => {});
                await this.page.waitForTimeout(Math.max(this.uiDelay, 2500));
                await this.waitForLoadingIndicatorToSettle(12);
                const changed = await this.waitForContentSignatureChange(beforeSig, 2500);
                debugLog(
                    `✅ Month arrow clicked (near picker depth=${nearPicker.depth}) `
                    + `gridChanged=${Boolean(changed)}`
                );
                return true;
            } catch (error) {
                debugLog(`⚠️  Near-picker arrow click failed: ${error.message}`);
            }
        }

        const selectors = direction === 'back'
            ? [
                '#ZeitdatenMonthPicker >> xpath=.. >> [data-uin="ic-previous"]',
                '#ZeitdatenMonthPicker >> xpath=../.. >> [data-uin="ic-previous"]',
                '[aria-label="Vorheriger Monat"]',
                '[title="Vorheriger Monat"]',
            ]
            : [
                '#ZeitdatenMonthPicker >> xpath=.. >> [data-uin="ic-next"]',
                '#ZeitdatenMonthPicker >> xpath=../.. >> [data-uin="ic-next"]',
                '[aria-label="Nächster Monat"]',
                '[title="Nächster Monat"]',
            ];

        for (const selector of selectors) {
            try {
                const locator = this.page.locator(selector).filter({ visible: true }).first();
                if (await locator.isVisible({ timeout: 2000 })) {
                    const beforeSig = await this.getContentSignature();
                    await locator.click({ delay: 450 });
                    await this.page.waitForTimeout(Math.max(this.uiDelay, 2500));
                    await this.waitForLoadingIndicatorToSettle(12);
                    const changed = await this.waitForContentSignatureChange(beforeSig, 2500);
                    debugLog(
                        `✅ Month arrow clicked (${selector}) gridChanged=${Boolean(changed)} `
                        + `day01=${beforeSig.firstWeekday}→${(await this.getContentSignature()).firstWeekday}`
                    );
                    return true;
                }
            } catch {
                continue;
            }
        }

        // Geometric fallback near picker (no extra selector clicks before this).
        const beforeSig = await this.getContentSignature();
        const stepped = await this.page.evaluate((stepDirection) => {
            const picker = document.querySelector('#ZeitdatenMonthPicker');
            if (!picker) return false;
            const pickerRect = picker.getBoundingClientRect();
            const isVisible = (element) => element && element.offsetParent !== null;
            const roots = [picker.parentElement, picker.parentElement?.parentElement].filter(Boolean);
            const candidates = [];
            for (const root of roots) {
                candidates.push(...root.querySelectorAll('.LG-Button, .LG-Icon, .Clickable, [aria-label], button'));
            }
            const unique = [...new Set(candidates)].filter(isVisible);
            const sorted = unique.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
            if (stepDirection === 'back') {
                const previous = sorted.filter((el) => el.getBoundingClientRect().right <= pickerRect.left + 8);
                if (previous.length) {
                    previous[previous.length - 1].click();
                    return true;
                }
            } else {
                const next = sorted.filter((el) => el.getBoundingClientRect().left >= pickerRect.right - 8);
                if (next.length) {
                    next[0].click();
                    return true;
                }
            }
            return false;
        }, direction);

        if (stepped) {
            await this.page.waitForTimeout(Math.max(this.uiDelay, 2500));
            await this.waitForLoadingIndicatorToSettle(12);
            await this.waitForContentSignatureChange(beforeSig, 8000);
            debugLog('✅ Month arrow clicked (geometry fallback)');
            return true;
        }

        return false;
    }

    async waitForExportPanel() {
        const selectors = [
            'div.MenuItem[data-uin="smartthing-cat-exports"]',
            'div.MenuItem:has-text("Export")',
        ];
        for (const selector of selectors) {
            try {
                await this.page.waitForSelector(selector, {
                    timeout: this.elementTimeout,
                    state: 'visible',
                });
                debugLog('✅ Export section visible');
                return true;
            } catch {
                continue;
            }
        }
        return false;
    }

    async waitForZeitprotokollButton() {
        await this.waitForSelectorReady(
            'div.LGSmartThingContentItem[data-uin="smartthing-LAGSDZPG"]',
            'Zeitprotokoll generieren'
        );
    }

    applyPageTimeouts() {
        if (!this.page) return;
        this.page.setDefaultTimeout(this.elementTimeout);
        this.page.setDefaultNavigationTimeout(this.pageLoadTimeout);
    }

    async init() {
        debugLog('🚀 Starting LOGA3 workflow automation...');
        
        // Launch browser based on config
        const browserType = this.browserConfig.type || 'chromium';
        const browserEngine = browserType === 'firefox' ? firefox : chromium;
        
        // Browser launch options
        const launchOptions = {
            headless: resolveHeadless(this.browserConfig),
            slowMo: this.browserConfig.slowMo || 1000
        };
        
        // If Firefox, use persistent context with user's profile
        if (browserType === 'firefox') {
            const userDataDir = '/home/fr4iser/.mozilla/firefox/349h3f5a.default';
            this.context = await browserEngine.launchPersistentContext(userDataDir, {
                ...launchOptions,
                viewport: { width: 1280, height: 720 },
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
                acceptDownloads: true,
                downloadsPath: this.downloadsDir
            });
            this.page = await this.context.newPage();
            this.applyPageTimeouts();
            return; // Skip the normal context creation
        }
        
        this.browser = await browserEngine.launch(launchOptions);

        // Final saveAs happens once in runDownloadPipeline — no competing download handlers.
        this.downloadsDir = getDownloadsDir();
        if (!fs.existsSync(this.downloadsDir)) {
            fs.mkdirSync(this.downloadsDir, { recursive: true });
        }
        debugLog(`📁 Downloads folder: ${this.downloadsDir}`);

        const context = await this.browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: browserType === 'firefox' 
                ? 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'
                : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            acceptDownloads: true,
            downloadsPath: this.downloadsDir
        });

        this.context = context;
        await context.setDefaultNavigationTimeout(this.pageLoadTimeout);

        this.page = await context.newPage();
        this.applyPageTimeouts();
    }

    async clickOpenButton() {
        debugLog('🔍 Looking for "öffnen" button...');

        try {
            // Multiple "öffnen" buttons exist; only click a visible one.
            const openButton = this.page
                .locator('div.LG-Button[aria-label="öffnen"]')
                .filter({ visible: true })
                .first();

            await openButton.waitFor({ state: 'visible', timeout: this.elementTimeout });
            await openButton.scrollIntoViewIfNeeded().catch(() => {});
            await openButton.click({ timeout: this.elementTimeout });
            debugLog('✅ "öffnen" button clicked');

            // New mask session — must re-arm Aktualisieren before month nav reloads grid.
            this._calendarReloadArmed = false;
            await this.waitForMonthPickerReady();
            return true;
        } catch (error) {
            debugLog('❌ "öffnen" button not found or click failed:', error.message);
            throw new Error(`open ("öffnen") button click failed: ${error.message}`);
        }
    }

    async clickSmartEdinGeborderIcon() {
        const selector = 'span.LG-Icon.ic-smartedingeborder[data-uin="ic-smartedingeborder"]';
        const maxAttempts = 4;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            debugLog(`🔍 Looking for smartedingeborder icon (${attempt}/${maxAttempts})...`);

            try {
                await this.waitForSelectorReady(selector, 'smartedingeborder');

                await this.page.click(selector);
                debugLog('✅ Smartedingeborder icon clicked');

                await this.waitForExportPanel();
                return true;
            } catch (error) {
                if (attempt === maxAttempts) {
                    debugLog('❌ Smartedingeborder icon not found or click failed:', error.message);
                    throw new Error(`Smartedingeborder icon click failed: ${error.message}`);
                }

                debugLog(`⏳ Icon not ready yet, retrying in ${this.stepDelay}ms...`);
                await this.page.waitForTimeout(this.stepDelay);
            }
        }

        return false;
    }

    async clickZeitprotokollGenerieren(targetMonth = null, targetYear = null) {
        debugLog('🔍 Looking for "Zeitprotokoll generieren" button...');
        
        try {
            await this.waitForZeitprotokollButton();

            await this.page.click('div.LGSmartThingContentItem[data-uin="smartthing-LAGSDZPG"]');
            debugLog('✅ First click on "Zeitprotokoll generieren"');
            
            // Wait a moment
            await this.page.waitForTimeout(1000);
            
            // Then click and hold for 1 second
            await this.page.click('div.LGSmartThingContentItem[data-uin="smartthing-LAGSDZPG"]', { 
                delay: 1000 
            });
            debugLog('✅ Click and hold (1 sec) on "Zeitprotokoll generieren"');

            const ready = await this.waitForZeitprotokollReady(targetMonth, targetYear);
            if (!ready) {
                throw new Error('Zeitprotokoll dialog did not become ready with expected month');
            }
            return true;
        } catch (error) {
            debugLog('❌ "Zeitprotokoll generieren" button not found or click failed:', error.message);
            throw new Error(`Zeitprotokoll generieren click failed: ${error.message}`);
        }
    }

    async clickExportButton() {
        debugLog('🔍 Looking for "Export" button...');
        
        try {
            // Wait for the export button to be visible (try multiple possible selectors)
            const exportSelectors = [
                'div.MenuItem[data-uin="smartthing-cat-exports"]',
                'div.MenuItem.selected[data-uin="smartthing-cat-exports"]',
                'div.MenuItem:has-text("Export")',
                'div.gwt-Label:has-text("Export")',
                'button:has-text("Export")',
                'div.Label:has-text("Export")',
                'span:has-text("Export")',
                'input[value*="Export"]',
                'button[title*="Export"]',
                'div.LG-Button:has-text("Export")'
            ];
            
            let exportButton = null;
            for (const selector of exportSelectors) {
                try {
                    await this.page.waitForSelector(selector, { timeout: Math.min(this.elementTimeout, 15000) });
                    exportButton = await this.page.$(selector);
                    if (exportButton) {
                        debugLog(`✅ Found export button with selector: ${selector}`);
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }
            
            if (!exportButton) {
                throw new Error('Export button not found with any selector');
            }
            
            // Additional wait to ensure button is fully loaded
            await this.page.waitForTimeout(this.stepDelay);
            
            // Wait for button to be enabled and clickable
            await this.page.waitForFunction(() => {
                const selectors = [
                    'div.MenuItem[data-uin="smartthing-cat-exports"]',
                    'div.MenuItem:has-text("Export")',
                    'div.gwt-Label:has-text("Export")',
                    'button:has-text("Export")',
                    'div.Label:has-text("Export")',
                    'span:has-text("Export")',
                    'input[value*="Export"]',
                    'button[title*="Export"]',
                    'div.LG-Button:has-text("Export")'
                ];
                
                for (const selector of selectors) {
                    const btn = document.querySelector(selector);
                    if (btn && btn.offsetParent !== null) {
                        return true;
                    }
                }
                return false;
            }, { timeout: this.elementTimeout });
            
            // Click the export button - it's already selected, just click it
            await this.page.click('div.MenuItem[data-uin="smartthing-cat-exports"]');
            debugLog('✅ Export button clicked');

            await this.waitForZeitprotokollButton();
            return true;
        } catch (error) {
            debugLog('❌ Export button not found or click failed:', error.message);
            throw new Error(`Export button click failed: ${error.message}`);
        }
    }

    async getMonthPickerState() {
        try {
            await this.page.waitForSelector('#ZeitdatenMonthPicker', {
                timeout: 5000,
                state: 'attached',
            });
        } catch {
            return null;
        }

        return this.page.evaluate(() => {
            const picker = document.querySelector('#ZeitdatenMonthPicker');
            if (!picker) return null;

            const selecteddate = picker.getAttribute('selecteddate') || '';
            const label = (picker.textContent || '').trim();
            const parts = selecteddate.split('/');

            if (parts.length === 3) {
                const month = parts[0].padStart(2, '0');
                const year = parts[2];
                return { month, year, label, selecteddate, source: 'month-picker' };
            }

            return { month: null, year: null, label, selecteddate, source: 'month-picker' };
        });
    }

    async logHeaderMonth(contextLabel) {
        const state = await this.getMonthPickerState();
        if (state?.month && state?.year) {
            debugLog(`📆 ${contextLabel}: ${state.label} (selecteddate=${state.selecteddate})`);
            return state;
        }

        if (state?.label) {
            debugLog(`📆 ${contextLabel}: ${state.label} (without selecteddate)`);
            return state;
        }

        debugLog(`ℹ️  ${contextLabel}: ZeitdatenMonthPicker not visible`);
        return null;
    }

    async clickMonthPickerStep(direction) {
        const selectors = direction === 'back'
            ? [
                '[data-uin="ic-previous"]',
                '[aria-label="Vorheriger Monat"]',
                '[title="Vorheriger Monat"]',
                '.ic-previous',
            ]
            : [
                '[data-uin="ic-next"]',
                '[aria-label="Nächster Monat"]',
                '[title="Nächster Monat"]',
                '.ic-next',
            ];

        for (const selector of selectors) {
            try {
                const locator = this.page.locator(selector).first();
                if (await locator.isVisible({ timeout: 3000 })) {
                    await locator.click();
                    await this.page.waitForTimeout(this.uiDelay);
                    debugLog(`✅ Month arrow clicked (${selector})`);
                    return true;
                }
            } catch {
                continue;
            }
        }

        return this.page.evaluate((stepDirection) => {
            const picker = document.querySelector('#ZeitdatenMonthPicker');
            if (!picker) return false;

            const pickerRect = picker.getBoundingClientRect();
            const isVisible = (element) => element && element.offsetParent !== null;
            const isClickable = (element) => {
                if (!isVisible(element) || element === picker) return false;
                const style = window.getComputedStyle(element);
                return style.pointerEvents !== 'none' && style.visibility !== 'hidden';
            };

            const roots = [picker.parentElement, picker.parentElement?.parentElement].filter(Boolean);
            const candidates = [];

            for (const root of roots) {
                candidates.push(...root.querySelectorAll(
                    '.LG-Button, .LG-Icon, .Clickable, [aria-label], [class*="arrow" i], button'
                ));
            }

            const unique = [...new Set(candidates)].filter(isClickable);
            const sorted = unique.sort((left, right) => {
                return left.getBoundingClientRect().left - right.getBoundingClientRect().left;
            });

            if (stepDirection === 'back') {
                const previous = sorted.filter((element) => element.getBoundingClientRect().right <= pickerRect.left + 8);
                if (previous.length) {
                    previous[previous.length - 1].click();
                    return true;
                }
            } else {
                const next = sorted.filter((element) => element.getBoundingClientRect().left >= pickerRect.right - 8);
                if (next.length) {
                    next[0].click();
                    return true;
                }
            }

            return false;
        }, direction);
    }

    getMonthLabelsForPicker() {
        return MONTH_LABELS;
    }

    async waitForMonthPickerPopup(timeout = 12000) {
        const monthLabels = this.getMonthLabelsForPicker();

        await this.page.waitForFunction((months) => {
            document.querySelectorAll('[data-loga3-month-popup]').forEach((element) => {
                element.removeAttribute('data-loga3-month-popup');
            });

            const roots = [
                ...document.querySelectorAll('.gwt-PopupPanel'),
                ...document.querySelectorAll('[class*="PopupPanel"]'),
                ...document.querySelectorAll('.LG-Popup'),
                ...document.querySelectorAll('table'),
            ];

            for (const root of roots) {
                if (!root || root.offsetParent === null) continue;

                const cells = [...root.querySelectorAll('td')].map((td) => (td.textContent || '').trim());
                const monthHits = months.filter((month) => cells.includes(month)).length;

                if (monthHits >= 4) {
                    root.setAttribute('data-loga3-month-popup', '1');
                    return true;
                }
            }

            return false;
        }, monthLabels, { timeout });
    }

    async openMonthPickerDropdown() {
        await this.page.click('#ZeitdatenMonthPicker');
        await this.page.waitForTimeout(400);
        await this.waitForMonthPickerPopup();
        debugLog('✅ Monthpicker dropdown opened');
    }

    async getDropdownDisplayedYear() {
        return this.page.evaluate(() => {
            const popup = document.querySelector('[data-loga3-month-popup="1"]');
            if (!popup) return null;
            const text = (popup.innerText || '').replace(/\s+/g, ' ');
            const match = text.match(/\b(20\d{2})\b/);
            return match ? match[1] : null;
        }).catch(() => null);
    }

    /**
     * Click sidebar "Aktualisieren" (ic-zaxisrotation). After this, month chrome
     * arrows trigger calendarCacheService and reload the day-grid for the target month.
     * Without arming, arrows only flip the header.
     */
    async armCalendarMonthReload() {
        if (this._calendarReloadArmed) {
            debugLog('ℹ️  Calendar month-reload already armed');
            return true;
        }

        debugLog('🔄 Arming calendar month-reload (Aktualisieren / ic-zaxisrotation)...');
        const before = await this.getContentSignature();

        const selectors = [
            '[data-uin="ic-zaxisrotation"]',
            '.RefreshWrapper[aria-label="Aktualisieren"]',
            '[aria-label="Aktualisieren"]',
            '.RefreshIcon',
        ];

        for (const selector of selectors) {
            try {
                const locator = this.page.locator(selector).first();
                if (!(await locator.count())) continue;
                await locator.scrollIntoViewIfNeeded().catch(() => {});
                await locator.click({ force: true, timeout: 5000 });
                debugLog(`✅ Aktualisieren clicked (${selector})`);
                await this.waitForLoadingIndicatorToSettle(25);
                await this.page.waitForTimeout(Math.max(this.uiDelay, 1500));
                await this.waitForContentSignatureChange(before, 8000);
                this._calendarReloadArmed = true;
                await this.logContentDebug('calendar-reload-armed');
                return true;
            } catch (error) {
                debugLog(`⚠️  Aktualisieren via ${selector}: ${error.message}`);
            }
        }

        debugLog('❌ Could not click Aktualisieren — month arrows may not reload grid');
        return false;
    }

    /**
     * Navigate year/month inside the open Monthpicker via its own controls
     * (.datePickerSelectorText + Vorjahr / Vorheriger Monat), then click the month cell.
     */
    async selectMonthInDropdown(monthLabel, targetYear) {
        const popup = this.page.locator('[data-loga3-month-popup="1"]');
        await popup.waitFor({ state: 'visible', timeout: 8000 });

        const year = String(targetYear);
        const monthIndex = MONTH_LABELS.indexOf(monthLabel) + 1;
        if (monthIndex < 1) {
            debugLog(`⚠️  Unknown month label: ${monthLabel}`);
            return false;
        }

        const readSelector = async () => this.page.evaluate(() => {
            const root = document.querySelector('[data-loga3-month-popup="1"]');
            if (!root) return null;
            const labels = [...root.querySelectorAll('.datePickerSelectorText .gwt-InlineLabel')];
            const active = labels.find((el) => el.classList.contains('active'));
            const yearEl = labels.find((el) => /^\d{4}$/.test((el.textContent || '').trim()));
            return {
                active: (active?.textContent || '').trim() || null,
                year: (yearEl?.textContent || '').trim() || null,
            };
        });

        let sel = await readSelector();
        if (sel?.active && /^\d{4}$/.test(sel.active)) {
            await popup.locator('.datePickerSelectorText .gwt-InlineLabel').first().click();
            await this.page.waitForTimeout(400);
            sel = await readSelector();
        }

        for (let attempt = 0; attempt < 36; attempt++) {
            sel = await readSelector();
            debugLog(`📆 Monthpicker selector active=${sel?.active || '?'} year=${sel?.year || '?'} → ${monthLabel} ${year}`);
            if (sel?.active === monthLabel && sel?.year === year) break;

            const shownYear = Number(sel?.year) || Number(year);
            const shownMonth = MONTH_LABELS.indexOf(sel?.active) + 1 || 7;
            const shownNum = shownYear * 12 + shownMonth;
            const targetNum = Number(year) * 12 + monthIndex;

            if (shownYear !== Number(year)) {
                const yearDir = shownYear > Number(year) ? 'Vorjahr' : 'Nächstes Jahr';
                const yearBtn = popup.locator(`[aria-label="${yearDir}"]`);
                if (await yearBtn.isVisible({ timeout: 800 }).catch(() => false)) {
                    await yearBtn.click();
                    await this.page.waitForTimeout(350);
                    continue;
                }
            }

            const monthDir = shownNum > targetNum ? 'Vorheriger Monat' : 'Nächster Monat';
            await popup.locator(`[aria-label="${monthDir}"]`).click();
            await this.page.waitForTimeout(350);
        }

        sel = await readSelector();
        if (!(sel?.active === monthLabel && sel?.year === year)) {
            debugLog(`⚠️  Monthpicker could not reach ${monthLabel} ${year} (at ${sel?.active} ${sel?.year})`);
            return false;
        }

        const cell = popup.locator('table.datePickerMonthPicker td').filter({ hasText: new RegExp(`^${monthLabel}$`) });
        if (await cell.count() === 0) {
            debugLog(`⚠️  Month cell "${monthLabel}" missing`);
            return false;
        }
        await cell.first().click({ delay: 80 });
        await this.page.waitForTimeout(800);
        debugLog(`✅ Monthpicker clicked month cell: ${monthLabel} ${year}`);
        return true;
    }

    async clickMonthInDropdown(monthLabel) {
        return this.selectMonthInDropdown(monthLabel, new Date().getFullYear());
    }

    async waitForCalendarCacheAfterAction(actionFn, timeoutMs = 12000) {
        let sawCache = false;
        const onReq = (req) => {
            if (/calendarCacheService/i.test(req.url())) sawCache = true;
        };
        this.page.on('request', onReq);
        try {
            await actionFn();
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline && !sawCache) {
                await this.page.waitForTimeout(200);
            }
            await this.waitForLoadingIndicatorToSettle(15);
            return sawCache;
        } finally {
            this.page.off('request', onReq);
        }
    }

    /**
     * Move header + reload day-grid via Monthpicker chrome arrows.
     * REQUIRES armCalendarMonthReload() first — otherwise only the header flips.
     */
    async syncHeaderWithMonthpickerChromeArrows(targetMonth, targetYear) {
        const mm = String(targetMonth).padStart(2, '0');
        const year = String(targetYear);
        const targetNum = this.periodToNumber(mm, year);
        debugLog('📆 Navigating via Monthpicker chrome arrows to', `${mm}/${year}`);

        for (let step = 0; step < 24; step++) {
            const state = await this.getMonthPickerState();
            if (state?.month === mm && state?.year === year) {
                await this.waitForLoadingIndicatorToSettle(15);
                return true;
            }
            if (!state?.month || !state?.year) break;
            const dir = this.periodToNumber(state.month, state.year) > targetNum ? 'back' : 'forward';
            const before = await this.getMonthPickerSnapshot();
            const beforeSig = await this.getContentSignature();

            const clicked = await this.page.evaluate((stepDirection) => {
                const picker = document.querySelector('#ZeitdatenMonthPicker');
                if (!picker) return false;
                const uin = stepDirection === 'back' ? 'ic-previous' : 'ic-next';
                let root = picker.parentElement;
                for (let depth = 0; depth < 4 && root; depth += 1) {
                    const arrow = [...root.querySelectorAll(`[data-uin="${uin}"]`)]
                        .find((el) => el && el.offsetParent !== null && !el.closest('.gwt-DatePicker'));
                    if (arrow) {
                        arrow.click();
                        return true;
                    }
                    root = root.parentElement;
                }
                return false;
            }, dir);

            if (!clicked) {
                debugLog('⚠️  Monthpicker chrome arrow not found');
                return false;
            }
            await this.waitForMonthPickerChange(before, 8000);
            await this.waitForLoadingIndicatorToSettle(12);
            // When armed, each arrow should reload grid content.
            if (this._calendarReloadArmed) {
                await this.waitForContentSignatureChange(beforeSig, 6000);
            }
        }

        const finalState = await this.getMonthPickerState();
        return finalState?.month === mm && finalState?.year === year;
    }

    async selectMonthViaMonthpickerOnly(targetMonth, targetYear) {
        const mm = String(targetMonth).padStart(2, '0');
        const year = String(targetYear);
        const monthLabel = MONTH_LABELS[targetMonth - 1];
        const beforeHeader = await this.getMonthPickerSnapshot();

        try {
            await this.openMonthPickerDropdown();
            const ok = await this.selectMonthInDropdown(monthLabel, year);
            if (!ok) {
                await this.page.keyboard.press('Escape').catch(() => {});
                throw new Error(`Monthpicker could not select ${monthLabel} ${year}`);
            }
            await this.waitForMonthPickerChange(beforeHeader, 5000).catch(() => false);

            let current = await this.getMonthPickerState();
            if (current?.month === mm && current?.year === year) {
                await this.logContentDebug('monthpicker-header-ok', { target: `${mm}/${year}` });
                return true;
            }

            // LOGA3 often ignores past-month cell commit — use chrome arrows (works after arm).
            debugLog(
                `⚠️  Monthpicker cell did not commit (header=${current?.month}/${current?.year}) — using chrome arrows`
            );
            await this.page.keyboard.press('Escape').catch(() => {});
            return this.syncHeaderWithMonthpickerChromeArrows(targetMonth, targetYear);
        } catch (error) {
            await this.page.keyboard.press('Escape').catch(() => {});
            debugLog(`⚠️  Monthpicker selection failed: ${error.message}`);
            return this.syncHeaderWithMonthpickerChromeArrows(targetMonth, targetYear);
        }
    }

    async selectMonthViaPicker(targetMonth, targetYear) {
        const mm = String(targetMonth).padStart(2, '0');
        const year = String(targetYear);
        const monthLabel = MONTH_LABELS[targetMonth - 1];

        try {
            await this.waitForMonthPickerReady();
        } catch (error) {
            debugLog(`⚠️  ZeitdatenMonthPicker not found: ${error.message}`);
            return false;
        }

        // CRITICAL: arm reload so month navigation loads day-grid (not just header).
        await this.armCalendarMonthReload();

        let current = await this.getMonthPickerState();
        if (current) {
            debugLog(
                `📆 Current: ${current.month}/${current.year} (${current.label}) `
                + `→ Target: ${mm}/${year} (${monthLabel} ${year})`
            );
        }

        const finishIfGridReady = async (contextLabel) => {
            current = await this.getMonthPickerState();
            if (current?.month !== mm || current?.year !== year) {
                debugLog(
                    `⚠️  ${contextLabel}: header=${current?.month}/${current?.year}, expected ${mm}/${year}`
                );
                return false;
            }
            debugLog(`📆 ${contextLabel}: header=${current.label}, verifying day-grid...`);
            await this.logContentDebug('header-reached', { context: contextLabel, target: `${mm}/${year}` });

            if (await this.waitUntilCalendarShowsMonth(targetMonth, targetYear, 20000)) {
                return true;
            }

            // Re-arm and navigate again if grid still stale.
            debugLog('⚠️  Grid still stale — re-arm Aktualisieren and re-navigate');
            this._calendarReloadArmed = false;
            await this.armCalendarMonthReload();
            await this.syncHeaderWithMonthpickerChromeArrows(targetMonth, targetYear);
            if (await this.waitUntilCalendarShowsMonth(targetMonth, targetYear, 15000)) {
                return true;
            }

            await this.takeScreenshot(`month-grid-mismatch-${mm}-${year}.png`);
            const state = await this.getCalendarContentState();
            debugLog(
                `❌ Grid mismatch: header=${mm}/${year} day01=${state?.firstWeekday} last=${state?.lastDay}`
            );
            await this.logContentDebug('grid-mismatch', { target: `${mm}/${year}`, state });
            return false;
        };

        if (current?.month === mm && current?.year === year) {
            // Already on header — if grid invalid, re-navigate away and back after arm.
            if (await this.verifyCalendarShowsMonth(targetMonth, targetYear, { quiet: true })) {
                return finishIfGridReady('Already on month with valid grid');
            }
            debugLog('📆 Header matches but grid stale — step away/back after arm');
            await this.syncHeaderWithMonthpickerChromeArrows(
                targetMonth === 12 ? 1 : targetMonth + 1,
                targetMonth === 12 ? targetYear + 1 : targetYear
            );
            await this.syncHeaderWithMonthpickerChromeArrows(targetMonth, targetYear);
            return finishIfGridReady('Re-approached target after arm');
        }

        debugLog('📆 Navigate to target (armed chrome arrows / Monthpicker)');
        const picked = await this.selectMonthViaMonthpickerOnly(targetMonth, targetYear);
        if (!picked) {
            await this.takeScreenshot(`month-picker-failed-${mm}-${year}.png`);
            return false;
        }

        return finishIfGridReady('Reached target month');
    }

    async getPageText() {
        let text = '';

        try {
            text += await this.page.evaluate(() => document.body?.innerText || '');
        } catch {
            text += '';
        }

        for (const frame of this.page.frames()) {
            try {
                text += `\n${await frame.evaluate(() => document.body?.innerText || '')}`;
            } catch {
                continue;
            }
        }

        try {
            text += `\n${await this.page.content()}`;
        } catch {
            // ignore
        }

        return text;
    }

    async getCurrentAbrechnungsmonat(preferred = null) {
        const pickerState = await this.getMonthPickerState();
        if (pickerState?.month && pickerState?.year) {
            return {
                month: pickerState.month,
                year: pickerState.year,
                source: 'month-picker',
                label: pickerState.label,
            };
        }

        const text = await this.getPageText();
        const parsed = parseAbrechnungsmonat(text, preferred);
        if (!parsed) return null;
        return { month: parsed.month, year: parsed.year, source: 'page-text' };
    }

    periodToNumber(month, year) {
        return parseInt(year, 10) * 12 + parseInt(month, 10);
    }

    async clickMonthNavigation(direction) {
        const labels = direction === 'back'
            ? ['zurück', 'Zurück', 'vorheriger', 'Vorheriger', 'ic-arrowleft', 'ic-back']
            : ['vor', 'Vor', 'weiter', 'Weiter', 'nächster', 'Nächster', 'ic-arrowright', 'ic-forward'];

        for (const label of labels) {
            const selectors = [
                `[aria-label="${label}"]`,
                `div.LG-Button[aria-label="${label}"]`,
                `span.LG-Icon[class*="${label}"]`,
                `span.LG-Icon.${label}`,
            ];

            for (const selector of selectors) {
                try {
                    const element = await this.page.$(selector);
                    if (element) {
                        await element.click();
                        await this.page.waitForTimeout(1500);
                        return true;
                    }
                } catch {
                    continue;
                }
            }
        }

        return false;
    }

    async selectAbrechnungsmonat(month, year) {
        return this.selectMonthViaPicker(month, year);
    }

    async waitForZeitprotokollReady(targetMonth, targetYear) {
        const preferred = targetMonth && targetYear
            ? { month: targetMonth, year: targetYear }
            : null;
        const mm = preferred ? String(preferred.month).padStart(2, '0') : null;
        const year = preferred ? String(preferred.year) : null;
        const monthLabel = preferred ? MONTH_LABELS[preferred.month - 1] : null;

        debugLog('⏳ Waiting for Zeitprotokoll dialog...');

        for (let attempt = 1; attempt <= 16; attempt++) {
            const dialogVisible = await this.isZeitprotokollDialogVisible();
            if (!dialogVisible) {
                debugLog(`⏳ Zeitprotokoll dialog not visible (${attempt}/16)...`);
                await this.page.waitForTimeout(2000);
                continue;
            }

            if (!preferred) {
                debugLog('✅ Zeitprotokoll dialog visible');
                return true;
            }

            const dialogPeriod = await this.getDialogAbrechnungsmonat();
            debugLog(`🧾 Dialog Abrechnungsmonat: ${JSON.stringify(dialogPeriod)}`);

            if (dialogPeriod?.monthToken && dialogPeriod?.year) {
                const parsed = parseAbrechnungsmonat(
                    `Abrechnungsmonat ${dialogPeriod.monthToken}/${dialogPeriod.year}`,
                    preferred
                ) || parseAbrechnungsmonat(
                    `Abrechnungsmonat ${dialogPeriod.monthToken} ${dialogPeriod.year}`,
                    preferred
                );

                if (parsed && parsed.month === mm && parsed.year === year) {
                    debugLog(`✅ Zeitprotokoll dialog matches target ${mm}/${year}`);
                    return true;
                }

                debugLog(
                    `⚠️  Dialog period ${parsed?.month}/${parsed?.year} != target ${mm}/${year} (${attempt}/16)`
                );
            } else {
                // Dialog often has no Abrechnungsmonat label — rely on pre-export content gate.
                // Do NOT treat calendar "Buchungen für …" as dialog confirmation.
                debugLog(
                    `✅ Zeitprotokoll dialog visible without Abrechnungsmonat label `
                    + `(${attempt}/16) — relying on pre-export content gate`
                );
                return true;
            }

            await this.page.waitForTimeout(2500);
        }

        return false;
    }

    async runDownloadPipeline(targetMonth, targetYear) {
        await this.logHeaderMonth('Month before export');

        if (targetMonth && targetYear) {
            const selected = await this.selectAbrechnungsmonat(targetMonth, targetYear);
            if (!selected) {
                throw new Error(
                    `Could not select month ${String(targetMonth).padStart(2, '0')}/${targetYear} in header`
                );
            }

            const headerMonth = await this.getMonthPickerState();
            const mm = String(targetMonth).padStart(2, '0');
            if (headerMonth?.month && headerMonth.month !== mm) {
                throw new Error(
                    `Header month (${headerMonth.month}/${headerMonth.year}) differs from target (${mm}/${targetYear})`
                );
            }

            // HARD GATE: never open Export / generate / download on stale content.
            await this.assertContentReadyBeforeExport(targetMonth, targetYear);
            // Reject months with no shifts / times yet (empty future plans).
            await this.assertMonthHasPlan(targetMonth, targetYear);
        } else if (!(await this.hasSchedulePlan())) {
            const picker = await this.getMonthPickerState();
            const err = new Error(
                `NO_PLAN:${picker?.month || '??'}/${picker?.year || '????'}`
            );
            err.code = 'NO_PLAN';
            err.targetMonth = picker?.month ? Number(picker.month) : null;
            err.targetYear = picker?.year ? Number(picker.year) : null;
            throw err;
        }

        await this.clickSmartEdinGeborderIcon();
        await this.logHeaderMonth('After SmartEdin');

        if (targetMonth && targetYear) {
            if (!(await this.verifyCalendarShowsMonth(targetMonth, targetYear))) {
                throw new Error(
                    `Refusing export after SmartEdin: content no longer valid for `
                    + `${String(targetMonth).padStart(2, '0')}/${targetYear}`
                );
            }
        }

        await this.takeScreenshot(`before-export-${targetMonth || 'cur'}-${targetYear || ''}.png`);

        await this.clickExportButton();
        await this.clickZeitprotokollGenerieren(targetMonth, targetYear);

        const dialogReady = await this.waitForZeitprotokollReady(targetMonth, targetYear);
        if (!dialogReady) {
            throw new Error('Refusing download: Zeitprotokoll dialog does not confirm target month');
        }

        let filename;
        if (targetMonth && targetYear) {
            filename = periodToFilename(targetMonth, targetYear);
            debugLog(`📄 Filename after pre-export validation: ${filename}`);
        } else {
            filename = await this.extractAbrechnungsmonat(targetMonth, targetYear);
        }
        if (!filename) {
            throw new Error('Abrechnungsmonat not found on page');
        }

        if (!fs.existsSync(this.downloadsDir)) {
            fs.mkdirSync(this.downloadsDir, { recursive: true });
        }

        const downloadPromise = this.page.waitForEvent('download', { timeout: 120000 });

        const downloaded = await this.clickDownloadButton();
        if (!downloaded) {
            throw new Error('Could not click download button');
        }

        let downloadEvent;
        try {
            downloadEvent = await downloadPromise;
        } catch (error) {
            throw new Error(`No Playwright download event: ${error.message}`);
        }

        const targetName = `${filename}.pdf`;
        const savePath = path.join(this.downloadsDir, targetName);
        await downloadEvent.saveAs(savePath);
        this.lastSavedDownloadPath = savePath;

        const stat = await fs.promises.stat(savePath);
        if (!stat.isFile() || stat.size < 1) {
            throw new Error(`Download empty or invalid: ${savePath}`);
        }

        debugLog(`📥 Saved: ${savePath} (${stat.size} bytes)`);

        // Safety net only — primary protection is assertContentReadyBeforeExport.
        if (targetMonth && targetYear) {
            const ok = await this.validateDownloadedPdf(savePath, targetMonth, targetYear);
            if (!ok) {
                await fs.promises.unlink(savePath).catch(() => {});
                throw new Error(
                    `Post-download safety check failed for ${filename} — file deleted; fix content gate`
                );
            }
        }

        await this.clearNoPlanMarker(filename);

        if (isDebug()) {
            await fs.promises.writeFile(`${savePath}.meta.json`, JSON.stringify({
                filename,
                targetMonth,
                targetYear,
                savedAt: new Date().toISOString(),
                bytes: stat.size,
                md5: require('crypto').createHash('md5').update(await fs.promises.readFile(savePath)).digest('hex'),
                fingerprint: await this.getBookingFingerprint(),
                picker: await this.getMonthPickerState(),
                calendar: await this.getCalendarContentState(),
            }, null, 2));
        }

        await this.handleDownload(filename);
        return filename;
    }

    async clickBerechnenIfPresent() {
        debugLog('🔍 Looking for BERECHNEN button...');
        const selectors = [
            'div.LG-Button:has-text("BERECHNEN")',
            'span.LG-Button:has-text("BERECHNEN")',
            'button:has-text("BERECHNEN")',
            '[role="button"]:has-text("BERECHNEN")',
            'div.PrimaryButton:has-text("BERECHNEN")',
            'text=/BERECHNEN/i',
            'text=/BERECHN/i',
        ];

        for (const selector of selectors) {
            try {
                const locator = this.page.locator(selector).filter({ visible: true }).first();
                if (await locator.isVisible({ timeout: 2000 })) {
                    await locator.scrollIntoViewIfNeeded().catch(() => {});
                    await locator.click({ timeout: this.elementTimeout });
                    debugLog(`✅ BERECHNEN clicked (${selector})`);
                    await this.waitForLoadingIndicatorToSettle(20);
                    await this.page.waitForTimeout(this.stepDelay);
                    return true;
                }
            } catch {
                continue;
            }
        }

        // Coordinate fallback: bottom-right primary action often clipped in viewport.
        try {
            const found = await this.page.evaluate(() => {
                const nodes = [...document.querySelectorAll('div, span, button, a')];
                const match = nodes.find((el) => {
                    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    if (!/^BERECHNEN$/i.test(text) && !/^BERECHN/i.test(text)) return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 20 && rect.height > 10;
                });
                if (!match) return false;
                match.scrollIntoView({ block: 'center', inline: 'center' });
                match.click();
                return true;
            });
            if (found) {
                debugLog('✅ BERECHNEN clicked (DOM text scan)');
                await this.waitForLoadingIndicatorToSettle(20);
                await this.page.waitForTimeout(this.stepDelay);
                return true;
            }
        } catch {
            // ignore
        }

        debugLog('ℹ️  BERECHNEN not visible — continuing');
        return false;
    }

    extractAbrechnungsmonatFromPdf(filePath) {
        const zlib = require('zlib');
        const buf = fs.readFileSync(filePath);
        const latin = buf.toString('latin1');
        let text = '';
        for (const match of latin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
            try {
                text += zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
            } catch {
                // ignore undecodable streams
            }
        }

        const period = text.match(/Abrechnungsmonat\)\s*Tj[\s\S]{0,120}\((\d{2}\/\d{4})\)\s*Tj/)
            || text.match(/\((\d{2}\/\d{4})\)\s*Tj/);
        const periode = text.match(/Periode\s*\\\((\d{1,2}\.\d{1,2}\.\d{4})\\\)/);
        const plainSlash = text.match(/Abrechnungsmonat[\s\S]{0,80}?(\d{2}\/\d{4})/);

        return {
            abrechnungsmonat: period?.[1] || plainSlash?.[1] || null,
            periode: periode?.[1] || null,
            hasJuli: /07\/2026|31\.7\.2026|Juli/.test(text),
            textSample: text.replace(/\s+/g, ' ').slice(0, 400),
        };
    }

    async validateDownloadedPdf(filePath, targetMonth, targetYear) {
        const mm = String(targetMonth).padStart(2, '0');
        const year = String(targetYear);
        const expected = `${mm}/${year}`;
        const info = this.extractAbrechnungsmonatFromPdf(filePath);
        debugLog(`🔎 PDF period check ${path.basename(filePath)}: ${JSON.stringify(info)}`);

        if (!info.abrechnungsmonat) {
            debugLog('⚠️  Could not read Abrechnungsmonat from PDF text');
            return false;
        }

        if (info.abrechnungsmonat !== expected) {
            debugLog(`❌ PDF Abrechnungsmonat ${info.abrechnungsmonat} != expected ${expected}`);
            return false;
        }

        debugLog(`✅ PDF Abrechnungsmonat matches ${expected}`);
        return true;
    }

    async dumpExportUiDebug(label) {
        const snapshot = await this.page.evaluate(() => {
            const visible = (el) => {
                if (!el || el.offsetParent === null) return false;
                const style = window.getComputedStyle(el);
                return style.visibility !== 'hidden' && style.display !== 'none';
            };
            const controls = [...document.querySelectorAll('input, select, [role="listbox"], [data-uin], .LG-Button, .MenuItem, .LGSmartThingContentItem, .gwt-Label')]
                .filter(visible)
                .slice(0, 120)
                .map((el) => ({
                    tag: el.tagName,
                    uin: el.getAttribute('data-uin'),
                    aria: el.getAttribute('aria-label'),
                    name: el.getAttribute('name'),
                    type: el.getAttribute('type'),
                    value: el.value || '',
                    text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
                }));
            const smartThings = controls.filter((c) => (c.uin || '').includes('smartthing') || /protokoll|export|abrechnung|monat|period/i.test(`${c.uin} ${c.text} ${c.aria}`));
            return {
                smartThings,
                controls,
                bodySample: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2500),
            };
        }).catch((error) => ({ error: error.message }));

        const outPath = path.join(getLogsDir(), `export-debug-${label}.json`);
        try {
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
            debugLog(`🧾 Export UI debug written: ${outPath}`);
        } catch (error) {
            debugLog(`⚠️  Could not write debug json: ${error.message}`);
            debugLog(`🧾 Export UI debug (${label}): ${JSON.stringify(snapshot).slice(0, 2000)}`);
        }
        await this.takeScreenshot(`export-debug-${label}.png`);
    }

    async extractAbrechnungsmonat(fallbackMonth, fallbackYear) {
        debugLog('📄 Extracting Abrechnungsmonat from page content...');

        try {
            await this.waitForUiReady('Reading Abrechnungsmonat');

            const pickerState = await this.getMonthPickerState();
            if (pickerState?.month && pickerState?.year) {
                const filename = periodToFilename(pickerState.month, pickerState.year);
                debugLog(`✅ Abrechnungsmonat from header: ${pickerState.month}/${pickerState.year} -> ${filename}`);
                return filename;
            }

            const preferred = fallbackMonth && fallbackYear
                ? { month: fallbackMonth, year: fallbackYear }
                : null;
            const text = await this.getPageText();
            const parsed = parseAbrechnungsmonat(text, preferred);

            if (parsed) {
                const filename = periodToFilename(parsed.month, parsed.year);
                debugLog(`✅ Abrechnungsmonat found: ${parsed.month}/${parsed.year} -> ${filename} (${parsed.source})`);
                return filename;
            }

            if (fallbackMonth && fallbackYear) {
                const filename = periodToFilename(fallbackMonth, fallbackYear);
                debugLog(`ℹ️  Using selected month as fallback: ${filename}`);
                return filename;
            }

            const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 400);
            debugLog('⚠️  Abrechnungsmonat not found in page content');
            if (snippet) {
                debugLog(`ℹ️  Page content (excerpt): ${snippet}`);
            }
            return null;
        } catch (error) {
            debugLog('❌ Error extracting Abrechnungsmonat:', error.message);
            return null;
        }
    }

    async isZeitprotokollDialogVisible() {
        const checks = [
            () => this.page.getByRole('button', { name: 'Herunterladen', exact: true }),
            () => this.page.locator('span.PrimaryButton[role="button"]', { hasText: 'Herunterladen' }),
            () => this.page.locator('[data-uin="ic-delete"][aria-label="Schließen"]'),
        ];

        for (const getLocator of checks) {
            try {
                const locator = getLocator();
                if (await locator.first().isVisible({ timeout: 1000 })) {
                    return true;
                }
            } catch {
                continue;
            }
        }

        return false;
    }

    async clickElementInPageOrFrames(getLocator, label) {
        const contexts = [this.page, ...this.page.frames()];

        for (const context of contexts) {
            try {
                const locator = getLocator(context);
                if (await locator.first().isVisible({ timeout: 2000 })) {
                    await locator.first().scrollIntoViewIfNeeded().catch(() => {});
                    await this.page.waitForTimeout(500);
                    await locator.first().click({ timeout: this.elementTimeout });
                    debugLog(`✅ ${label} clicked`);
                    return true;
                }
            } catch {
                continue;
            }
        }

        return false;
    }

    async clickDownloadButton() {
        debugLog('🔍 Looking for download button...');

        const locatorFactories = [
            (ctx) => ctx.getByRole('button', { name: 'Herunterladen', exact: true }),
            (ctx) => ctx.locator('span.PrimaryButton[role="button"]', { hasText: /^Herunterladen$/ }),
            (ctx) => ctx.locator('span.PrimaryButton', { hasText: 'Herunterladen' }),
            (ctx) => ctx.locator('[role="button"]', { hasText: 'Herunterladen' }),
        ];

        for (let attempt = 1; attempt <= 8; attempt++) {
            for (const factory of locatorFactories) {
                const clicked = await this.clickElementInPageOrFrames(factory, `Download button (${attempt}/8)`);
                if (clicked) {
                    await this.page.waitForTimeout(this.stepDelay);
                    return true;
                }
            }

            debugLog(`⏳ Download button not visible yet (${attempt}/8)...`);
            await this.page.waitForTimeout(3000);
        }

        debugLog('⚠️  Download button not found or click failed');
        return false;
    }

    async clickCloseDialog() {
        debugLog('🔍 Looking for close ("Schließen") button...');

        const locatorFactories = [
            (ctx) => ctx.locator('[data-uin="ic-delete"][aria-label="Schließen"]'),
            (ctx) => ctx.locator('[aria-label="Schließen"].ic-delete'),
            (ctx) => ctx.locator('[title="Schließen"]'),
            (ctx) => ctx.getByRole('button', { name: 'Schließen', exact: true }),
        ];

        for (let attempt = 1; attempt <= 4; attempt++) {
            for (const factory of locatorFactories) {
                const clicked = await this.clickElementInPageOrFrames(factory, `Close ("Schließen") (${attempt}/4)`);
                if (clicked) {
                    await this.page.waitForTimeout(this.stepDelay);
                    await this.waitForLoadingIndicatorToSettle();
                    return true;
                }
            }

            await this.page.waitForTimeout(1500);
        }

        debugLog('⚠️  Close ("Schließen") button not found');
        return false;
    }

    async handleDownload(filename) {
        debugLog('💾 Finalizing download...');

        try {
            const targetName = `${filename}.pdf`;
            const targetPath = this.lastSavedDownloadPath || path.join(this.downloadsDir, targetName);

            if (!fs.existsSync(targetPath)) {
                throw new Error(`Expected file missing: ${targetPath}`);
            }

            const stat = await fs.promises.stat(targetPath);
            debugLog(`✅ PDF ready: ${targetPath} (${stat.size} bytes)`);

            await this.clickCloseDialog();
            debugLog(`📁 Downloads folder: ${this.downloadsDir}`);
            return true;
        } catch (error) {
            debugLog('❌ Download handling failed:', error.message);
            await this.clickCloseDialog().catch(() => {});
            return false;
        }
    }

    async takeScreenshot(filename = 'loga3-workflow-screenshot.png') {
        try {
            if (!this.screenshotConfig.enabled) {
                return;
            }
            
            const screenshotDir = this.screenshotConfig.directory || getLogsDir();
            const screenshotPath = path.join(screenshotDir, filename);
            await this.page.screenshot({ path: screenshotPath, fullPage: true });
            debugLog(`📸 Screenshot saved: ${screenshotPath}`);
        } catch (error) {
            console.error('❌ Failed to take screenshot:', error.message);
        }
    }

    async cleanup() {
        if (this.context) {
            await this.context.close();
            debugLog('🧹 Browser context closed');
        } else if (this.browser) {
            await this.browser.close();
            debugLog('🧹 Browser closed');
        }
    }

    async run() {
        try {
            await this.init();
            
            // Navigate to LOGA3 first
            debugLog('📡 Navigating to LOGA3...');
            const baseUrl = config.baseUrl || 'https://stelisab.pi-asp.de/loga3/#';
            await this.page.goto(baseUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: this.pageLoadTimeout 
            });
            await this.waitForFullNavigation();
            debugLog('✅ Successfully loaded LOGA3 page');
            
            // Step 1: Click first "öffnen" button
            debugLog('\n📋 Step 1: Clicking first "öffnen" button...');
            await this.clickOpenButton();
            await this.takeScreenshot('step1-first-open.png');
            
            // Step 2: Click smartedingeborder icon
            debugLog('\n📋 Step 2: Clicking smartedingeborder icon...');
            await this.clickSmartEdinGeborderIcon();
            await this.takeScreenshot('step2-smartedingeborder.png');
            
            // Step 3: Click "Export" button (MUST be before Zeitprotokoll generieren!)
            debugLog('\n📋 Step 3: Clicking "Export" button...');
            await this.clickExportButton();
            await this.takeScreenshot('step3-export.png');
            
            // Step 4: Click "Zeitprotokoll generieren" (now available after export)
            debugLog('\n📋 Step 4: Clicking "Zeitprotokoll generieren"...');
            await this.clickZeitprotokollGenerieren();
            await this.takeScreenshot('step4-zeitprotokoll.png');
            
            // Step 5: Extract Abrechnungsmonat
            debugLog('\n📋 Step 5: Extracting Abrechnungsmonat...');
            const filename = await this.extractAbrechnungsmonat();
            if (!filename) {
                throw new Error('Step 5 failed: Could not extract Abrechnungsmonat');
            }
            await this.takeScreenshot('step5-content-extracted.png');
            
            // Step 6: Click download button
            debugLog('\n📋 Step 6: Clicking download button...');
            const step6Success = await this.clickDownloadButton();
            if (!step6Success) {
                throw new Error('Step 6 failed: Could not click download button');
            }
            await this.takeScreenshot('step6-download-clicked.png');
            
            // Step 7: Handle download
            debugLog('\n📋 Step 7: Handling download...');
            const step7Success = await this.handleDownload(filename);
            if (!step7Success) {
                throw new Error('Step 7 failed: Could not handle download');
            }
            await this.takeScreenshot('step7-downloaded.png');
            
            debugLog('\n🎉 Workflow completed successfully!');
            debugLog(`📁 Downloads saved to: ${this.downloadsDir}`);

            if (process.argv.includes('--once')) {
                await this.cleanup();
                return;
            }

            debugLog('⏸️  Browser will remain open for manual interaction');
            debugLog('Press Ctrl+C to close the browser');
            await new Promise(() => {});
            
        } catch (error) {
            console.error('❌ Workflow failed:', error.message);
            await this.takeScreenshot('workflow-error.png');
            process.exit(1);
        }
    }
}

// Main execution
if (require.main === module) {
    const workflow = new Loga3Workflow();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        debugLog('\n🛑 Shutting down...');
        await workflow.cleanup();
        process.exit(0);
    });
    
    workflow.run().catch(console.error);
}

module.exports = Loga3Workflow;

