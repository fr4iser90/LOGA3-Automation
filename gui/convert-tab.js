/**
 * Convert / Sync tab — uses converter/ core + prefs from Einstellungen.
 */
import {
    loadHospitalConfig,
    loadMapping,
    loadHospitalParser,
    listHospitals,
} from '/converter/src/shiftTypesLoader.js';
import { extractTextFromPdfBuffer } from '/converter/src/pdfText.js';
import { parseTimeSheet } from '/converter/src/convert.js';
import { exportToICS } from '/converter/src/icsGenerator.js';
import { initGoogleCalendar } from '/converter/src/google.js';
import {
    extractMonthSummariesFromText,
    isMonthSummaryEnabled,
} from '/converter/src/monthSummary.js';
import { buildSupportParserSample, scorePdfForSupportSample } from '/converter/src/anonymize.js';
import {
    sendSupportRequest,
    buildSupportReport,
    downloadSupportReport,
    loadMaintainerEmail,
    truncateForMailto,
} from '/converter/src/api.js';

const HOSPITAL_DEFAULT = 'st-elisabeth-leipzig';
const PREF_SHOW = 'prefShowMonthSummary';
const PREF_RICH = 'prefRichEventDetails';
const SUPPORT_SAMPLE_KEY = 'supportAnonymizedSample';
const SUPPORT_SAMPLE_LS_KEY = 'supportAnonymizedSample';
/** 1 PDF-Ausschnitt — soll mit Meta in mailto passen */
const SUPPORT_SAMPLE_MAX_CHARS = 700;
const SUPPORT_SAMPLE_PDF_COUNT = 1;
const BUILTIN_GOOGLE_CLIENT_ID =
    '443643010945-l4r4n5t6vaj93tcqs8jlbvccltd06kaf.apps.googleusercontent.com';

const els = {
    hospital: document.getElementById('settingsHospital'),
    hospitalHint: document.getElementById('hospitalSupportHint'),
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
    saveUserMappingBtn: document.getElementById('saveUserMappingBtn'),
    resetUserMappingBtn: document.getElementById('resetUserMappingBtn'),
    userMappingStatus: document.getElementById('userMappingStatus'),
    monthSummaryCard: document.getElementById('monthSummaryCard'),
    icsExportBtn: document.getElementById('icsExportBtn'),
    refreshPdfsBtn: document.getElementById('refreshPdfsBtn'),
    selectAllPdfsBtn: document.getElementById('selectAllPdfsBtn'),
    editMappingBtn: document.getElementById('editMappingBtn'),
    supportHospital: document.getElementById('supportHospital'),
    supportGroup: document.getElementById('supportGroup'),
    supportArea: document.getElementById('supportArea'),
    supportNote: document.getElementById('supportNote'),
    supportIncludeSample: document.getElementById('supportIncludeSample'),
    supportSampleHint: document.getElementById('supportSampleHint'),
    supportSendBtn: document.getElementById('supportSendBtn'),
    supportDownloadBtn: document.getElementById('supportDownloadBtn'),
    supportStatus: document.getElementById('supportStatus'),
    packInstallInput: document.getElementById('packInstallInput'),
    packsList: document.getElementById('packsList'),
    packsCatalogList: document.getElementById('packsCatalogList'),
    packsCatalogBtn: document.getElementById('packsCatalogBtn'),
    packsGithubLink: document.getElementById('packsGithubLink'),
    packsStatus: document.getElementById('packsStatus'),
};

let hospitalConfig = null;
let currentMapping = null;
let currentParser = null;
let convertPrefs = {
    hospital: HOSPITAL_DEFAULT,
    group: 'pflege',
    area: 'op-bereich',
    preset: 'Anästhesie',
    showMonthSummary: true,
    richEventDetails: false,
    googleClientId: BUILTIN_GOOGLE_CLIENT_ID,
};
let ready = false;
let suppressMappingEvents = false;

function ti(key, vars = {}) {
    if (typeof window.t === 'function') return window.t(key, vars);
    return key;
}

function setSupportStatus(text, { error = false } = {}) {
    if (!els.supportStatus) return;
    if (!text) {
        els.supportStatus.hidden = true;
        els.supportStatus.textContent = '';
        return;
    }
    els.supportStatus.hidden = false;
    els.supportStatus.textContent = text;
    els.supportStatus.classList.toggle('error', error);
}

function updateSupportSampleHint() {
    if (!els.supportSampleHint) return;
    const data = readStoredSupportSample();
    if (!data?.text) {
        els.supportSampleHint.textContent = ti('supportSampleHintEmpty');
        return;
    }
    els.supportSampleHint.textContent = ti('supportSampleHintReady', {
        chars: data.chars || data.text.length,
        files: data.files || 1,
    });
}

function fillSupportFormDefaults() {
    if (els.supportHospital && !els.supportHospital.value) {
        els.supportHospital.value = hospitalConfig?.name || 'St. Elisabeth Leipzig';
    }
    const group = hospitalConfig?.groups?.find((g) => g.id === convertPrefs.group);
    const area = group?.areas?.find((a) => a.id === convertPrefs.area);
    if (els.supportGroup) els.supportGroup.value = group?.label || convertPrefs.group || '';
    if (els.supportArea) els.supportArea.value = area?.label || convertPrefs.area || '';
}

function collectMissingShiftsText() {
    if (!els.missingList) return '';
    const ranges = new Set();
    els.missingList.querySelectorAll('[data-range], .badge.warn').forEach((el) => {
        const r = el.dataset?.range || el.textContent.trim();
        if (r) ranges.add(r);
    });
    if (!ranges.size) return '';
    return [...ranges].map((b) => `- ${b}`).join('\n');
}

async function saveUserMappingFromForm() {
    const inputs = [...(els.missingList?.querySelectorAll('input.missing-code') || [])];
    const preset = convertPrefs.preset || els.preset?.value || 'default';
    const shifts = {};
    for (const input of inputs) {
        const code = input.value.trim();
        const range = input.dataset.range;
        if (code && range) {
            shifts[range] = { code, isValidated: true };
        }
    }
    if (!Object.keys(shifts).length) {
        setUserMappingStatus(ti('userMappingNeedCodes'), { error: true });
        return;
    }
    const hospital = convertPrefs.hospital || HOSPITAL_DEFAULT;
    const group = els.group?.value || convertPrefs.group;
    const area = els.area?.value || convertPrefs.area;
    try {
        await api('/api/user-mapping', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hospital,
                group,
                area,
                presets: { [preset]: shifts },
            }),
        });
        setUserMappingStatus(ti('userMappingSaved'), { error: false });
        await loadCurrentMapping();
        await convertAllPdfs();
    } catch (e) {
        setUserMappingStatus(e.message || String(e), { error: true });
    }
}

async function resetUserMapping() {
    const hospital = convertPrefs.hospital || HOSPITAL_DEFAULT;
    const group = els.group?.value || convertPrefs.group;
    const area = els.area?.value || convertPrefs.area;
    try {
        const q = new URLSearchParams({ hospital, group, area });
        await api(`/api/user-mapping?${q}`, { method: 'DELETE' });
        setUserMappingStatus(ti('userMappingResetOk'), { error: false });
        await loadCurrentMapping();
        const names = selectedPdfNames();
        if (names.length) await runConvert(names);
        else {
            try {
                const entries = JSON.parse(localStorage.getItem('parsedEntries') || '[]');
                renderPreview(entries);
            } catch { /* ignore */ }
        }
    } catch (e) {
        setUserMappingStatus(e.message || String(e), { error: true });
    }
}

async function refreshPacksList() {
    if (!els.packsList) return;
    try {
        const data = await api('/api/packs');
        const packs = data.packs || [];
        if (!packs.length) {
            els.packsList.innerHTML = `<p class="field-hint">${escapeHtml(ti('packsEmpty'))}</p>`;
            return;
        }
        els.packsList.innerHTML = packs.map((p) => `
          <div class="pack-row" data-id="${escapeHtml(p.id)}">
            <span><strong>${escapeHtml(p.name)}</strong> <code>${escapeHtml(p.id)}</code></span>
            <button type="button" class="pack-remove" data-id="${escapeHtml(p.id)}">${escapeHtml(ti('packsRemove'))}</button>
          </div>`).join('');
        els.packsList.querySelectorAll('.pack-remove').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                try {
                    await api(`/api/packs/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    if (els.packsStatus) els.packsStatus.textContent = ti('packsRemoved', { id });
                    await fillHospitals();
                    await refreshPacksList();
                    if (convertPrefs.hospital === id) {
                        await switchHospital(HOSPITAL_DEFAULT);
                    }
                } catch (e) {
                    if (els.packsStatus) els.packsStatus.textContent = ti('packsError', { message: e.message });
                }
            });
        });
    } catch (e) {
        if (els.packsStatus) els.packsStatus.textContent = ti('packsError', { message: e.message });
    }
}

async function loadPacksCatalog() {
    if (els.packsStatus) els.packsStatus.textContent = '…';
    try {
        const data = await api('/api/packs/catalog');
        if (data.githubRepo && els.packsGithubLink) {
            els.packsGithubLink.href = `${String(data.githubRepo).replace(/\/$/, '')}/tree/main/packs`;
        }
        const packs = data.packs || [];
        if (!els.packsCatalogList) return;
        if (!packs.length) {
            els.packsCatalogList.innerHTML = `<p class="field-hint">${escapeHtml(ti('packsCatalogEmpty'))}</p>`;
            if (data.note) {
                els.packsCatalogList.innerHTML += `<p class="field-hint">${escapeHtml(data.note)}</p>`;
            }
            if (els.packsStatus) els.packsStatus.textContent = ti('packsCatalogOk', { count: 0 });
            return;
        }
        els.packsCatalogList.innerHTML = packs.map((p) => `
          <div class="pack-row">
            <span>
              <strong>${escapeHtml(p.name || p.id)}</strong>
              ${p.version ? `<code>v${escapeHtml(p.version)}</code>` : ''}
              ${p.description ? `<br><span class="field-hint">${escapeHtml(p.description)}</span>` : ''}
            </span>
            <button type="button" class="pack-catalog-install primary" data-url="${escapeHtml(p.zipUrl || '')}" ${p.zipUrl ? '' : 'disabled'}>
              ${escapeHtml(ti('packsCatalogInstall'))}
            </button>
          </div>`).join('');
        els.packsCatalogList.querySelectorAll('.pack-catalog-install').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const zipUrl = btn.dataset.url;
                if (!zipUrl) return;
                btn.disabled = true;
                try {
                    const result = await api('/api/packs/install-url', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ zipUrl }),
                    });
                    if (els.packsStatus) els.packsStatus.textContent = ti('packsInstalled', { name: result.name || result.id });
                    await fillHospitals();
                    await refreshPacksList();
                    if (result.id && els.hospital) {
                        els.hospital.value = result.id;
                        await switchHospital(result.id);
                    }
                } catch (e) {
                    if (els.packsStatus) els.packsStatus.textContent = ti('packsError', { message: e.message });
                } finally {
                    btn.disabled = false;
                }
            });
        });
        if (els.packsStatus) els.packsStatus.textContent = ti('packsCatalogOk', { count: packs.length });
    } catch (e) {
        if (els.packsStatus) els.packsStatus.textContent = ti('packsError', { message: e.message });
        if (els.packsCatalogList) {
            els.packsCatalogList.innerHTML = `<p class="field-hint">${escapeHtml(e.message || String(e))}</p>`;
        }
    }
}

async function installPackFile(file) {
    if (!file) return;
    if (els.packsStatus) els.packsStatus.textContent = '…';
    try {
        const buf = await file.arrayBuffer();
        const response = await fetch('/api/packs/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/zip' },
            body: buf,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Install fehlgeschlagen');
        if (els.packsStatus) els.packsStatus.textContent = ti('packsInstalled', { name: data.name || data.id });
        await fillHospitals();
        await refreshPacksList();
        if (data.id && els.hospital) {
            els.hospital.value = data.id;
            await switchHospital(data.id);
        }
    } catch (e) {
        if (els.packsStatus) els.packsStatus.textContent = ti('packsError', { message: e.message || e });
    }
}

function readStoredSupportSample() {
    for (const store of [sessionStorage, localStorage]) {
        try {
            const raw = store.getItem(SUPPORT_SAMPLE_KEY);
            if (!raw) continue;
            const data = JSON.parse(raw);
            if (data?.text) return data;
        } catch {
            // continue
        }
    }
    return null;
}

function writeStoredSupportSample(sampleText, files) {
    const payload = JSON.stringify({
        text: sampleText,
        chars: sampleText.length,
        files,
        at: Date.now(),
    });
    try { sessionStorage.setItem(SUPPORT_SAMPLE_KEY, payload); } catch { /* ignore */ }
    try { localStorage.setItem(SUPPORT_SAMPLE_LS_KEY, payload); } catch { /* ignore */ }
}

/**
 * Rohtext für Support: PDF mit echten Schichtzeiten bevorzugen, Ausschnitt smart wählen.
 * @param {{ force?: boolean }} [opts]
 */
async function ensureSupportRawSample({ force = false } = {}) {
    if (!force) {
        const existing = readStoredSupportSample();
        if (existing?.text && /KO\*|GE\*/.test(existing.text)) {
            const trimmed = truncateForMailto(existing.text, SUPPORT_SAMPLE_MAX_CHARS);
            return trimmed;
        }
    }

    if (!window.pdfjsLib) {
        setupPdfJs();
    }
    if (!window.pdfjsLib) return '';

    let names = selectedPdfNames();
    if (!names.length) {
        try {
            const { files } = await api('/api/downloads');
            names = (files || []).map((f) => f.name);
        } catch {
            names = [];
        }
    }
    // Bis zu 8 PDFs scoren, das mit den meisten KO*/GE* nehmen
    names = names.slice(0, 8);
    if (!names.length) return '';

    let best = { score: -1, name: '', text: '' };
    for (const name of names) {
        try {
            const response = await fetch(`/api/downloads/file?name=${encodeURIComponent(name)}`);
            if (!response.ok) continue;
            const buffer = await response.arrayBuffer();
            const text = await extractTextFromPdfBuffer(buffer);
            if (!text.trim()) continue;
            const score = scorePdfForSupportSample(text);
            if (score > best.score) {
                best = { score, name, text };
            }
            // Schon gute Treffer → früh abbrechen
            if (score >= 20) break;
        } catch (e) {
            console.warn('Support-Sample PDF', name, e);
        }
    }
    if (!best.text) return '';

    const sampleText = buildSupportParserSample(best.text, {
        maxChars: SUPPORT_SAMPLE_MAX_CHARS,
        fileLabel: best.name,
    });
    writeStoredSupportSample(sampleText, 1);
    updateSupportSampleHint();
    return sampleText;
}

async function buildSupportPayload() {
    const includeSample = !els.supportIncludeSample || els.supportIncludeSample.checked;
    let anonymizedSample = '';
    if (includeSample) {
        // Immer frisch/kurz — alter Cache mit 2×6000 Zeichen würde mailto sprengen
        anonymizedSample = await ensureSupportRawSample({ force: true });
    }
    return {
        hospitalName: (els.supportHospital?.value || '').trim(),
        groupLabel: (els.supportGroup?.value || '').trim(),
        areaLabel: (els.supportArea?.value || '').trim(),
        preset: convertPrefs.preset || els.preset?.value || '',
        note: (els.supportNote?.value || '').trim(),
        missingShifts: collectMissingShiftsText(),
        anonymizedSample,
    };
}

async function handleSupportSend() {
    setSupportStatus('…', { error: false });
    const payload = await buildSupportPayload();
    if (!payload.hospitalName) {
        setSupportStatus(ti('supportNeedHospital'), { error: true });
        return;
    }
    if (els.supportIncludeSample?.checked && !payload.anonymizedSample) {
        setSupportStatus(ti('supportSampleHintEmpty'), { error: true });
        return;
    }
    try {
        const email = await loadMaintainerEmail();
        const result = await sendSupportRequest({ maintainerEmail: email, ...payload });
        setSupportStatus(
            result.mode === 'file'
                ? ti('supportFileOk', { filename: result.filename || 'loga3-support.txt' })
                : ti('supportMailOk'),
            { error: false }
        );
    } catch (e) {
        setSupportStatus(ti('supportError', { message: e.message || e }), { error: true });
    }
}

async function handleSupportDownload() {
    setSupportStatus('…', { error: false });
    const payload = await buildSupportPayload();
    if (!payload.hospitalName) {
        setSupportStatus(ti('supportNeedHospital'), { error: true });
        return;
    }
    try {
        const { fullBody } = buildSupportReport(payload);
        const slug = payload.hospitalName.replace(/\s+/g, '-').toLowerCase().replace(/[^a-z0-9\-äöüß]/gi, '');
        downloadSupportReport(`loga3-support-${slug || 'anfrage'}.txt`, fullBody);
        setSupportStatus(ti('supportDownloadOk'), { error: false });
    } catch (e) {
        setSupportStatus(ti('supportError', { message: e.message || e }), { error: true });
    }
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

function setUserMappingStatus(text, { error = false } = {}) {
    if (!els.userMappingStatus) return;
    if (!text) {
        els.userMappingStatus.hidden = true;
        els.userMappingStatus.textContent = '';
        return;
    }
    els.userMappingStatus.hidden = false;
    els.userMappingStatus.textContent = text;
    els.userMappingStatus.classList.toggle('error', error);
}

function updateMappingSummary() {
    if (!els.mappingSummary || !hospitalConfig) return;
    const group = hospitalConfig.groups.find((g) => g.id === convertPrefs.group);
    const area = group?.areas?.find((a) => a.id === convertPrefs.area);
    const parts = [
        hospitalConfig.name || convertPrefs.hospital,
        group?.label || convertPrefs.group,
        area?.label || convertPrefs.area,
        convertPrefs.preset || '—',
    ];
    els.mappingSummary.textContent = parts.join(' · ');
}

async function fillHospitals() {
    if (!els.hospital) return;
    let hospitals = [];
    try {
        hospitals = await listHospitals();
    } catch {
        hospitals = [{ id: HOSPITAL_DEFAULT, name: 'St. Elisabeth Leipzig', source: 'builtin' }];
    }
    suppressMappingEvents = true;
    els.hospital.innerHTML = hospitals
        .map((h) => {
            const tag = h.source === 'pack' ? ' (Pack)' : '';
            return `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}${tag}</option>`;
        })
        .join('');
    if (convertPrefs.hospital) els.hospital.value = convertPrefs.hospital;
    if (![...els.hospital.options].some((o) => o.value === els.hospital.value) && els.hospital.options[0]) {
        els.hospital.selectedIndex = 0;
        convertPrefs.hospital = els.hospital.value;
    }
    suppressMappingEvents = false;
}

async function switchHospital(hospitalId) {
    convertPrefs.hospital = hospitalId || HOSPITAL_DEFAULT;
    hospitalConfig = await loadHospitalConfig(convertPrefs.hospital);
    currentParser = await loadHospitalParser(convertPrefs.hospital);
    if (!currentParser) {
        setStatus(ti('packsError', { message: `Kein Parser für ${convertPrefs.hospital}` }), { error: true });
    }
    await fillGroups();
}

async function fillGroups() {
    if (!hospitalConfig || !els.group) return;
    // Nur Gruppen mit mindestens einem freigeschalteten Bereich
    const groups = (hospitalConfig.groups || []).filter((g) =>
        (g.areas || []).some((a) => a.supported !== false)
    );
    suppressMappingEvents = true;
    els.group.innerHTML = groups
        .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.label)}</option>`)
        .join('');
    if (convertPrefs.group) els.group.value = convertPrefs.group;
    if (![...els.group.options].some((o) => o.value === els.group.value) && els.group.options[0]) {
        els.group.selectedIndex = 0;
        convertPrefs.group = els.group.value;
    }
    suppressMappingEvents = false;
    if (els.hospitalHint) {
        els.hospitalHint.textContent = hospitalConfig.hint || '';
    }
    await fillAreas();
}

async function fillAreas() {
    if (!hospitalConfig || !els.area) return;
    const groupId = els.group?.value || convertPrefs.group;
    const group = hospitalConfig.groups.find((g) => g.id === groupId);
    const areas = (group?.areas || []).filter((a) => a.supported !== false);
    suppressMappingEvents = true;
    els.area.innerHTML = areas
        .map((a) => `<option value="${escapeHtml(a.id)}" data-mapping="${escapeHtml(a.mapping)}" data-default-preset="${escapeHtml(a.defaultPreset || '')}">${escapeHtml(a.label)}</option>`)
        .join('');
    if (convertPrefs.area) els.area.value = convertPrefs.area;
    if (![...els.area.options].some((o) => o.value === els.area.value) && els.area.options[0]) {
        els.area.selectedIndex = 0;
        convertPrefs.area = els.area.value;
    }
    suppressMappingEvents = false;
    await loadCurrentMapping();
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
    const group = els.group?.value || convertPrefs.group;
    const area = els.area?.value || convertPrefs.area;
    currentMapping = await loadMapping(hospital, mappingPath, { group, area });
    if (currentMapping.colors) {
        localStorage.setItem('shiftColors', JSON.stringify(currentMapping.colors));
    }
    // Nur Presets mit mindestens einem isValidated: true
    const presetNames = Object.entries(currentMapping.presets || {})
        .filter(([, shifts]) => Object.values(shifts || {}).some((v) => v && v.isValidated === true))
        .map(([name]) => name);

    suppressMappingEvents = true;
    if (els.preset) {
        els.preset.innerHTML = presetNames
            .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
            .join('');
        const preferred = opt?.dataset?.defaultPreset || convertPrefs.preset;
        if (preferred && presetNames.includes(preferred)) {
            els.preset.value = preferred;
            convertPrefs.preset = preferred;
        } else if (convertPrefs.preset && presetNames.includes(convertPrefs.preset)) {
            els.preset.value = convertPrefs.preset;
        } else if (presetNames[0]) {
            els.preset.value = presetNames[0];
            convertPrefs.preset = presetNames[0];
        }
    }
    suppressMappingEvents = false;
    updateMappingSummary();
}

function readConvertFromForm() {
    return {
        hospital: els.hospital?.value || convertPrefs.hospital || HOSPITAL_DEFAULT,
        group: els.group?.value || convertPrefs.group,
        area: els.area?.value || convertPrefs.area,
        preset: els.preset?.value || convertPrefs.preset,
        showMonthSummary: els.showSummary ? els.showSummary.checked : true,
        richEventDetails: els.richDetails ? els.richDetails.checked : false,
        googleClientId: BUILTIN_GOOGLE_CLIENT_ID,
    };
}

async function applyConvertPrefsToForm(prefs) {
    convertPrefs = {
        ...convertPrefs,
        ...prefs,
        googleClientId: BUILTIN_GOOGLE_CLIENT_ID,
    };
    if (els.showSummary) els.showSummary.checked = convertPrefs.showMonthSummary !== false;
    if (els.richDetails) els.richDetails.checked = Boolean(convertPrefs.richEventDetails);
    syncLocalPrefsFromForm();
    await fillHospitals();
    if (els.hospital) els.hospital.value = convertPrefs.hospital || HOSPITAL_DEFAULT;
    await switchHospital(convertPrefs.hospital || HOSPITAL_DEFAULT);
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
            .map((range) => `
              <label class="missing-row">
                <span class="badge warn">${escapeHtml(range)}</span>
                <input type="text" class="missing-code" data-range="${escapeHtml(range)}"
                  placeholder="Code" maxlength="16" aria-label="Code für ${escapeHtml(range)}">
              </label>`)
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
    const anonymizedParts = [];
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
            if (anonymizedParts.length < SUPPORT_SAMPLE_PDF_COUNT) {
                anonymizedParts.push(
                    buildSupportParserSample(text, {
                        maxChars: SUPPORT_SAMPLE_MAX_CHARS,
                        fileLabel: name,
                    })
                );
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

    if (anonymizedParts.length) {
        const sampleText = anonymizedParts.join('\n\n');
        writeStoredSupportSample(sampleText, anonymizedParts.length);
    }
    updateSupportSampleHint();
    fillSupportFormDefaults();

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

    try {
        const data = await api('/api/settings');
        if (data.convert) {
            await applyConvertPrefsToForm(data.convert);
        } else {
            await fillHospitals();
            await switchHospital(convertPrefs.hospital || HOSPITAL_DEFAULT);
        }
    } catch {
        await fillHospitals();
        await switchHospital(convertPrefs.hospital || HOSPITAL_DEFAULT);
    }

    els.hospital?.addEventListener('change', async () => {
        if (suppressMappingEvents) return;
        try {
            await switchHospital(els.hospital.value);
        } catch (e) {
            setStatus(e.message, { error: true });
        }
    });
    els.group?.addEventListener('change', () => {
        if (suppressMappingEvents) return;
        convertPrefs.group = els.group.value;
        fillAreas().catch((e) => setStatus(e.message, { error: true }));
    });
    els.area?.addEventListener('change', () => {
        if (suppressMappingEvents) return;
        convertPrefs.area = els.area.value;
        loadCurrentMapping().catch((e) => setStatus(e.message, { error: true }));
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
    els.supportSendBtn?.addEventListener('click', () => handleSupportSend());
    els.supportDownloadBtn?.addEventListener('click', () => handleSupportDownload());
    els.saveUserMappingBtn?.addEventListener('click', () => saveUserMappingFromForm());
    els.resetUserMappingBtn?.addEventListener('click', () => resetUserMapping());
    els.packInstallInput?.addEventListener('change', async () => {
        const file = els.packInstallInput.files?.[0];
        await installPackFile(file);
        els.packInstallInput.value = '';
    });
    els.packsCatalogBtn?.addEventListener('click', () => loadPacksCatalog());

    await refreshPdfList();
    await refreshPacksList();
    ready = true;
    fillSupportFormDefaults();
    updateSupportSampleHint();

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
