/**
 * Convert / Sync tab — uses converter/ core + prefs from Einstellungen.
 */
import {
    loadHospitalConfig,
    loadMapping,
    loadHospitalParser,
} from '/converter/src/shiftTypesLoader.js';
import { extractTextFromPdfBuffer } from '/converter/src/pdfText.js';
import { parseTimeSheet } from '/converter/src/convert.js';
import { exportToICS } from '/converter/src/icsGenerator.js';
import { initGoogleCalendar } from '/converter/src/google.js';
import {
    extractMonthSummariesFromText,
    isMonthSummaryEnabled,
} from '/converter/src/monthSummary.js';

const HOSPITAL_DEFAULT = 'st-elisabeth-leipzig';
const PREF_SHOW = 'prefShowMonthSummary';
const PREF_RICH = 'prefRichEventDetails';
const BUILTIN_GOOGLE_CLIENT_ID =
    '443643010945-l4r4n5t6vaj93tcqs8jlbvccltd06kaf.apps.googleusercontent.com';

const els = {
    group: document.getElementById('settingsGroup'),
    area: document.getElementById('settingsArea'),
    preset: document.getElementById('settingsPreset'),
    showSummary: document.getElementById('showMonthSummaryChk'),
    richDetails: document.getElementById('richEventDetailsChk'),
    mappingSummary: document.getElementById('convertMappingSummary'),
    pdfList: document.getElementById('pdfList'),
    pdfListEmpty: document.getElementById('pdfListEmpty'),
    convertBtn: document.getElementById('convertBtn'),
    reconvertBtn: document.getElementById('reconvertBtn'),
    convertStatus: document.getElementById('convertStatus'),
    previewContent: document.getElementById('previewContent'),
    missingContainer: document.getElementById('missingShiftsContainer'),
    missingList: document.getElementById('missingShiftsList'),
    monthSummaryCard: document.getElementById('monthSummaryCard'),
    icsExportBtn: document.getElementById('icsExportBtn'),
    refreshPdfsBtn: document.getElementById('refreshPdfsBtn'),
    selectAllPdfsBtn: document.getElementById('selectAllPdfsBtn'),
    editMappingBtn: document.getElementById('editMappingBtn'),
};

let hospitalConfig = null;
let currentMapping = null;
let currentParser = null;
let convertPrefs = {
    hospital: HOSPITAL_DEFAULT,
    group: 'pflege',
    area: 'op-bereich',
    preset: '',
    showMonthSummary: true,
    richEventDetails: false,
    googleClientId: BUILTIN_GOOGLE_CLIENT_ID,
};
let ready = false;
let suppressMappingEvents = false;

function setStatus(text, { error = false } = {}) {
    if (!els.convertStatus) return;
    if (!text) {
        els.convertStatus.hidden = true;
        els.convertStatus.textContent = '';
        return;
    }
    els.convertStatus.hidden = false;
    els.convertStatus.textContent = text;
    els.convertStatus.classList.toggle('error', error);
}

function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function api(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Anfrage fehlgeschlagen');
    return data;
}

function setupPdfJs() {
    if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
}

function syncLocalPrefsFromForm() {
    if (els.showSummary) {
        localStorage.setItem(PREF_SHOW, els.showSummary.checked ? '1' : '0');
    }
    if (els.richDetails) {
        localStorage.setItem(PREF_RICH, els.richDetails.checked ? '1' : '0');
    }
    localStorage.setItem('googleClientId', BUILTIN_GOOGLE_CLIENT_ID);
}

function updateMappingSummary() {
    if (!els.mappingSummary || !hospitalConfig) return;
    const group = hospitalConfig.groups.find((g) => g.id === convertPrefs.group);
    const area = group?.areas?.find((a) => a.id === convertPrefs.area);
    const parts = [
        group?.label || convertPrefs.group,
        area?.label || convertPrefs.area,
        convertPrefs.preset || '—',
    ];
    els.mappingSummary.textContent = parts.join(' · ');
}

function fillGroups() {
    if (!hospitalConfig || !els.group) return;
    suppressMappingEvents = true;
    els.group.innerHTML = hospitalConfig.groups
        .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.label)}</option>`)
        .join('');
    if (convertPrefs.group) els.group.value = convertPrefs.group;
    if (![...els.group.options].some((o) => o.value === els.group.value) && els.group.options[0]) {
        els.group.selectedIndex = 0;
    }
    suppressMappingEvents = false;
    fillAreas();
}

function fillAreas() {
    if (!hospitalConfig || !els.area) return;
    const groupId = els.group?.value || convertPrefs.group;
    const group = hospitalConfig.groups.find((g) => g.id === groupId);
    suppressMappingEvents = true;
    els.area.innerHTML = (group?.areas || [])
        .map((a) => `<option value="${escapeHtml(a.id)}" data-mapping="${escapeHtml(a.mapping)}">${escapeHtml(a.label)}</option>`)
        .join('');
    if (convertPrefs.area) els.area.value = convertPrefs.area;
    if (![...els.area.options].some((o) => o.value === els.area.value) && els.area.options[0]) {
        els.area.selectedIndex = 0;
    }
    suppressMappingEvents = false;
    return loadCurrentMapping();
}

async function loadCurrentMapping() {
    const opt = els.area?.selectedOptions?.[0];
    const mappingPath = opt?.dataset?.mapping;
    if (!mappingPath) {
        currentMapping = null;
        if (els.preset) els.preset.innerHTML = '';
        return;
    }
    const hospital = convertPrefs.hospital || HOSPITAL_DEFAULT;
    currentMapping = await loadMapping(hospital, mappingPath);
    if (currentMapping.colors) {
        localStorage.setItem('shiftColors', JSON.stringify(currentMapping.colors));
    }
    const presets = Object.keys(currentMapping.presets || {});
    suppressMappingEvents = true;
    if (els.preset) {
        els.preset.innerHTML = presets
            .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
            .join('');
        if (convertPrefs.preset && presets.includes(convertPrefs.preset)) {
            els.preset.value = convertPrefs.preset;
        } else if (presets[0]) {
            els.preset.value = presets[0];
            convertPrefs.preset = presets[0];
        }
    }
    suppressMappingEvents = false;
    updateMappingSummary();
}

function readConvertFromForm() {
    return {
        hospital: convertPrefs.hospital || HOSPITAL_DEFAULT,
        group: els.group?.value || convertPrefs.group,
        area: els.area?.value || convertPrefs.area,
        preset: els.preset?.value || convertPrefs.preset,
        showMonthSummary: els.showSummary ? els.showSummary.checked : true,
        richEventDetails: els.richDetails ? els.richDetails.checked : false,
        googleClientId: BUILTIN_GOOGLE_CLIENT_ID,
    };
}

function applyConvertPrefsToForm(prefs) {
    convertPrefs = {
        ...convertPrefs,
        ...prefs,
        googleClientId: BUILTIN_GOOGLE_CLIENT_ID,
    };
    if (els.showSummary) els.showSummary.checked = convertPrefs.showMonthSummary !== false;
    if (els.richDetails) els.richDetails.checked = Boolean(convertPrefs.richEventDetails);
    syncLocalPrefsFromForm();
    return fillGroups();
}

async function refreshPdfList() {
    const { files } = await api('/api/downloads');
    if (!files.length) {
        els.pdfList.innerHTML = '';
        els.pdfListEmpty.hidden = false;
        return;
    }
    els.pdfListEmpty.hidden = true;
    els.pdfList.innerHTML = files
        .map((f) => {
            const sizeKb = Math.round((f.size || 0) / 1024);
            return `
        <label class="pdf-item">
          <input type="checkbox" name="pdf" value="${escapeHtml(f.name)}" checked>
          <span class="pdf-name">${escapeHtml(f.name)}</span>
          <span class="pdf-meta">${sizeKb} KB</span>
        </label>`;
        })
        .join('');
}

function selectedPdfNames() {
    return [...els.pdfList.querySelectorAll('input[name="pdf"]:checked')].map((el) => el.value);
}

function renderPreview(entries) {
    const preset = convertPrefs.preset || els.preset?.value;
    const presetData = (currentMapping?.presets && currentMapping.presets[preset]) || {};

    const missing = new Set();
    (entries || []).forEach((entry) => {
        if (entry.isWork && entry.start && entry.end) {
            const range = `${entry.start}-${entry.end}`;
            if (!presetData[range]) missing.add(range);
        }
    });
    if (missing.size) {
        els.missingContainer.hidden = false;
        els.missingList.innerHTML = [...missing]
            .map((s) => `<span class="badge warn">${escapeHtml(s)}</span>`)
            .join('');
    } else {
        els.missingContainer.hidden = true;
        els.missingList.innerHTML = '';
    }

    if (!entries?.length) {
        els.previewContent.innerHTML = '<p class="hint">Keine Einträge erkannt.</p>';
        return;
    }

    const now = new Date();
    const todayY = now.getFullYear();
    const todayM = now.getMonth();
    const todayStart = startOfLocalDay(now);
    const weekStart = startOfWeekMonday(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    let focusAssigned = false;
    let monthFocusPending = null;

    const rows = entries.map((entry, idx) => {
        let displayDate = entry.date || '';
        let rowClass = '';
        let isFocus = false;
        try {
            const d = parseEntryDate(entry.date);
            if (d) {
                displayDate = d.toLocaleDateString('de-DE');
                const inMonth = d.getFullYear() === todayY && d.getMonth() === todayM;
                const inWeek = d >= weekStart && d < weekEnd;
                const isToday = d.getTime() === todayStart.getTime();
                if (isToday) rowClass = 'preview-today';
                else if (inWeek) rowClass = 'preview-week';
                else if (inMonth) rowClass = 'preview-month';

                if (!focusAssigned && (isToday || inWeek)) {
                    isFocus = true;
                    focusAssigned = true;
                } else if (inMonth && monthFocusPending == null) {
                    monthFocusPending = idx;
                }
            }
        } catch {
            // keep
        }
        const type = entry.isWork && !entry.type ? '?' : (entry.type || '');
        const start = entry.allDay ? 'ganztägig' : (entry.start || '');
        const end = entry.allDay ? '' : (entry.end || '');
        const idAttr = isFocus ? ' id="preview-focus-row"' : '';
        const classAttr = rowClass ? ` class="${rowClass}"` : '';
        return `<tr${idAttr}${classAttr}>
          <td>${escapeHtml(displayDate)}</td>
          <td><strong>${escapeHtml(type)}</strong></td>
          <td>${escapeHtml(start)}</td>
          <td>${escapeHtml(end)}</td>
        </tr>`;
    });

    if (!focusAssigned && monthFocusPending != null) {
        rows[monthFocusPending] = rows[monthFocusPending].replace('<tr', '<tr id="preview-focus-row"');
    }

    els.previewContent.innerHTML = `
      <table class="preview-table">
        <thead><tr><th>Datum</th><th>Code</th><th>Start</th><th>Ende</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <p class="hint">${entries.length} Einträge · aktueller Monat / Woche hervorgehoben</p>`;

    requestAnimationFrame(() => {
        const focus = document.getElementById('preview-focus-row');
        const scroller = els.previewContent;
        if (focus && scroller) {
            const wrapRect = scroller.getBoundingClientRect();
            const rowRect = focus.getBoundingClientRect();
            scroller.scrollTop += rowRect.top - wrapRect.top - 40;
        }
    });
}

function parseEntryDate(value) {
    if (!value) return null;
    const d = new Date(`${value}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : startOfLocalDay(d);
}

function startOfLocalDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeekMonday(d) {
    const day = startOfLocalDay(d);
    const wd = day.getDay(); // 0 Sun … 6 Sat
    const diff = wd === 0 ? -6 : 1 - wd;
    day.setDate(day.getDate() + diff);
    return day;
}

function renderSummaries(summaries) {
    const card = els.monthSummaryCard;
    if (!card) return;
    if (!isMonthSummaryEnabled()) {
        const details = document.getElementById('monthSummaryDetails');
        if (details) details.hidden = true;
        card.innerHTML = '';
        return;
    }
    const details = document.getElementById('monthSummaryDetails');
    if (details) details.hidden = false;

    const list = (summaries || []).filter((s) => s && (
        s.uebertragVormonat || s.uebertragFolgemonat || s.periodeIst
        || s.periodeSaldo || s.bereitschaftAuszahlung || s.bereitschaftAzk
    ));
    if (!list.length) {
        card.innerHTML = '<p class="hint">Keine Monatsdaten (Übertrag / AZK) in den PDFs gefunden.</p>';
        return;
    }
    card.innerHTML = list.map((s) => {
        const title = s.month && s.year ? `Monatsübersicht ${s.month}/${s.year}` : 'Monatsübersicht';
        const cells = [
            ['Übertrag Vormonat', s.uebertragVormonat],
            ['Übertrag Folgemonat', s.uebertragFolgemonat],
            ['Ist (Periode)', s.periodeIst],
            ['Saldo Periode', s.periodeSaldo],
            ['Bereitschaft Auszahlung', s.bereitschaftAuszahlung],
            ['Bereitschaft → AZK', s.bereitschaftAzk],
        ].filter(([, v]) => v != null && v !== '')
            .map(([k, v]) => `<div class="stat"><strong>${escapeHtml(v)}</strong><span>${escapeHtml(k)}</span></div>`)
            .join('');
        return `<div class="summary-block"><h3>${escapeHtml(title)}</h3><div class="summary">${cells}</div></div>`;
    }).join('');
}

async function ensureMappingLoaded() {
    convertPrefs = { ...convertPrefs, ...readConvertFromForm() };
    await fillGroups();
    if (!currentMapping || !currentParser) {
        throw new Error('Mapping/Parser nicht geladen — unter Einstellungen prüfen.');
    }
}

async function runConvert(namesOverride = null) {
    try {
        await ensureMappingLoaded();
    } catch (e) {
        setStatus(e.message, { error: true });
        return { ok: false, error: e.message };
    }
    if (!window.pdfjsLib) {
        const msg = 'PDF.js nicht geladen (Netzwerk?).';
        setStatus(msg, { error: true });
        return { ok: false, error: msg };
    }

    let names = namesOverride;
    if (!names) {
        names = selectedPdfNames();
    }
    if (!names.length) {
        const msg = 'Keine PDFs zum Umwandeln.';
        setStatus(msg, { error: true });
        return { ok: false, error: msg };
    }

    if (els.convertBtn) els.convertBtn.disabled = true;
    if (els.reconvertBtn) els.reconvertBtn.disabled = true;
    setStatus(`Umwandeln… 0/${names.length}`);

    const allEntries = [];
    const allSummaries = [];
    const failed = [];
    const { group, area, preset } = convertPrefs;

    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        setStatus(`Umwandeln… ${i + 1}/${names.length}: ${name}`);
        try {
            const response = await fetch(`/api/downloads/file?name=${encodeURIComponent(name)}`);
            if (!response.ok) throw new Error(`Download fehlgeschlagen (${response.status})`);
            const buffer = await response.arrayBuffer();
            const text = await extractTextFromPdfBuffer(buffer);
            if (!text.trim()) {
                failed.push(`${name}: kein lesbarer Text`);
                continue;
            }
            const summaries = extractMonthSummariesFromText(text);
            if (summaries?.length) allSummaries.push(...summaries);

            const parsed = parseTimeSheet(
                text,
                group,
                area,
                preset,
                currentMapping,
                currentParser
            );
            if (!parsed.entries?.length) {
                failed.push(`${name}: keine Schichten erkannt`);
            } else {
                allEntries.push(...parsed.entries);
            }
        } catch (err) {
            console.error(name, err);
            failed.push(`${name}: ${err.message || err}`);
        }
    }

    allEntries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    localStorage.setItem('parsedEntries', JSON.stringify(allEntries));
    localStorage.setItem('monthSummaries', JSON.stringify(allSummaries));
    renderSummaries(allSummaries);
    renderPreview(allEntries);

    const hasEntries = allEntries.length > 0;
    if (els.icsExportBtn) els.icsExportBtn.disabled = !hasEntries;

    if (hasEntries) {
        let msg = `✅ ${allEntries.length} Einträge aus ${names.length} PDF(s)`;
        if (failed.length) msg += ` — ${failed.length} mit Hinweis`;
        setStatus(msg, { error: false });
    } else {
        setStatus(failed.length ? `❌ ${failed.join('; ')}` : '❌ Keine Einträge', { error: true });
    }

    if (els.convertBtn) els.convertBtn.disabled = false;
    if (els.reconvertBtn) els.reconvertBtn.disabled = false;
    return { ok: hasEntries, count: allEntries.length, failed };
}

/** Convert every PDF in downloads/ (used after fetch). */
export async function convertAllPdfs() {
    await refreshPdfList();
    els.pdfList?.querySelectorAll('input[name="pdf"]').forEach((el) => { el.checked = true; });
    const names = selectedPdfNames();
    return runConvert(names);
}

export function getConvertFormValues() {
    return readConvertFromForm();
}

export async function onConvertSettingsSaved(prefs) {
    await applyConvertPrefsToForm(prefs || readConvertFromForm());
    updateMappingSummary();
    try {
        const summaries = JSON.parse(localStorage.getItem('monthSummaries') || '[]');
        renderSummaries(summaries);
    } catch {
        renderSummaries([]);
    }
}

export async function refreshConvertTab() {
    if (!ready) return;
    try {
        const data = await api('/api/settings');
        if (data.convert) {
            await applyConvertPrefsToForm(data.convert);
        }
        await refreshPdfList();
        updateMappingSummary();
    } catch (e) {
        setStatus(e.message, { error: true });
    }
}

export async function initConvertTab() {
    setupPdfJs();
    initGoogleCalendar();

    const hospital = convertPrefs.hospital || HOSPITAL_DEFAULT;
    hospitalConfig = await loadHospitalConfig(hospital);
    currentParser = await loadHospitalParser(hospital);
    if (!currentParser) {
        setStatus('Parser für St. Elisabeth nicht geladen.', { error: true });
    }

    try {
        const data = await api('/api/settings');
        if (data.convert) {
            await applyConvertPrefsToForm(data.convert);
        } else {
            fillGroups();
        }
    } catch {
        fillGroups();
    }

    els.group?.addEventListener('change', () => {
        if (suppressMappingEvents) return;
        convertPrefs.group = els.group.value;
        fillAreas();
    });
    els.area?.addEventListener('change', () => {
        if (suppressMappingEvents) return;
        convertPrefs.area = els.area.value;
        loadCurrentMapping();
    });
    els.preset?.addEventListener('change', () => {
        if (suppressMappingEvents) return;
        convertPrefs.preset = els.preset.value;
        updateMappingSummary();
    });

    els.refreshPdfsBtn?.addEventListener('click', () => refreshPdfList().catch((e) => setStatus(e.message, { error: true })));
    els.selectAllPdfsBtn?.addEventListener('click', () => {
        els.pdfList.querySelectorAll('input[name="pdf"]').forEach((el) => { el.checked = true; });
    });
    els.convertBtn?.addEventListener('click', () => runConvert());
    els.reconvertBtn?.addEventListener('click', () => convertAllPdfs());
    els.icsExportBtn?.addEventListener('click', () => exportToICS());
    els.editMappingBtn?.addEventListener('click', () => {
        document.getElementById('settingsBtn')?.click();
    });

    await refreshPdfList();
    ready = true;

    try {
        const entries = JSON.parse(localStorage.getItem('parsedEntries') || '[]');
        if (entries.length) {
            renderPreview(entries);
            if (els.icsExportBtn) els.icsExportBtn.disabled = false;
        }
        const summaries = JSON.parse(localStorage.getItem('monthSummaries') || '[]');
        renderSummaries(summaries);
    } catch {
        // ignore
    }
}

window.refreshConvertTab = refreshConvertTab;
window.getConvertFormValues = getConvertFormValues;
window.onConvertSettingsSaved = onConvertSettingsSaved;
window.convertAllPdfs = convertAllPdfs;

initConvertTab().catch((err) => {
    console.error(err);
    setStatus(`Converter-Startfehler: ${err.message}`, { error: true });
});
