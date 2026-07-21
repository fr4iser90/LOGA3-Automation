const yearSelect = document.getElementById('yearSelect');
const refreshBtn = document.getElementById('refreshBtn');
const settingsBtn = document.getElementById('settingsBtn');
const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
const downloadMissingBtn = document.getElementById('downloadMissingBtn');
const downloadCurrentBtn = document.getElementById('downloadCurrentBtn');
const selectMissingBtn = document.getElementById('selectMissingBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const selectionInfo = document.getElementById('selectionInfo');
const stopBtn = document.getElementById('stopBtn');
const openDownloadsBtn = document.getElementById('openDownloadsBtn');
const summaryEl = document.getElementById('summary');
const monthsGrid = document.getElementById('monthsGrid');
const logOutput = document.getElementById('logOutput');
const setupBanner = document.getElementById('setupBanner');
const setupBannerBtn = document.getElementById('setupBannerBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsForm = document.getElementById('settingsForm');
const settingsUsername = document.getElementById('settingsUsername');
const settingsPassword = document.getElementById('settingsPassword');
const settingsHeadless = document.getElementById('settingsHeadless');
const settingsLocale = document.getElementById('settingsLocale');
const settingsCancelBtn = document.getElementById('settingsCancelBtn');
const settingsError = document.getElementById('settingsError');
const passwordHint = document.getElementById('passwordHint');
const settingsTitle = document.getElementById('settingsTitle');
const sectionCalendar = document.getElementById('sectionCalendar');

let running = false;
let configured = false;
let inventoryData = null;
let messages = {};
let locale = 'de';
const selectedMonths = new Set();

function t(key, vars = {}) {
  let text = messages[key] || key;
  for (const [name, value] of Object.entries(vars)) {
    text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
  }
  return text;
}

function applyStaticI18n() {
  document.documentElement.lang = locale;
  document.title = t('appTitle');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  if (settingsLocale) {
    settingsLocale.options[0].textContent = t('langDe');
    settingsLocale.options[1].textContent = t('langEn');
  }
  updateSelectionInfo();
}

function appendLog(line) {
  if (!logOutput) return;
  logOutput.textContent += `${line}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

function setRunning(value) {
  running = value;
  downloadSelectedBtn.disabled = value || !configured;
  downloadMissingBtn.disabled = value || !configured;
  downloadCurrentBtn.disabled = value || !configured;
  selectMissingBtn.disabled = value;
  clearSelectionBtn.disabled = value;
  stopBtn.hidden = !value;
}

function updateSetupUi() {
  setupBanner.hidden = configured;
  setRunning(running);
}

function setFlowStep(step) {
  document.querySelectorAll('.flow-step').forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step);
  });
}

function focusCalendar() {
  setFlowStep(2);
  sectionCalendar?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateSelectionInfo() {
  const count = selectedMonths.size;
  selectionInfo.textContent = count === 1
    ? t('selectedCount', { count })
    : t('selectedCountPlural', { count });
  downloadSelectedBtn.textContent = count
    ? t('downloadSelectedN', { count })
    : t('downloadSelected');
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    const err = new Error(data.error || t('errRequest'));
    err.needsSetup = Boolean(data.needsSetup);
    throw err;
  }
  return data;
}

function openSettings({ required = false } = {}) {
  settingsTitle.textContent = required ? t('settingsWelcome') : t('settingsTitle');
  settingsCancelBtn.hidden = required;
  passwordHint.hidden = !configured;
  settingsPassword.required = !configured;
  settingsPassword.value = '';
  settingsPassword.placeholder = configured ? t('passwordKeep') : t('password');
  settingsError.hidden = true;
  settingsModal.hidden = false;
  settingsUsername.focus();
}

function closeSettings() {
  if (!configured) return;
  settingsModal.hidden = true;
}

async function loadSettingsIntoForm() {
  const data = await api('/api/settings');
  if (data.messages) messages = data.messages;
  if (data.locale) locale = data.locale;
  configured = Boolean(data.configured);
  settingsUsername.value = data.username || '';
  settingsHeadless.checked = data.headless === true;
  settingsLocale.value = locale;
  if (data.convert && typeof window.onConvertSettingsSaved === 'function') {
    await window.onConvertSettingsSaved(data.convert);
  } else if (data.convert) {
    const showChk = document.getElementById('showMonthSummaryChk');
    const richChk = document.getElementById('richEventDetailsChk');
    if (showChk) showChk.checked = data.convert.showMonthSummary !== false;
    if (richChk) richChk.checked = Boolean(data.convert.richEventDetails);
  }
  applyStaticI18n();
  updateSetupUi();
  return data;
}

async function loadYears() {
  const { years } = await api('/api/years');
  const currentYear = new Date().getFullYear();
  yearSelect.innerHTML = years
    .map((year) => `<option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>`)
    .join('');
}

function toggleMonth(month) {
  if (selectedMonths.has(month)) selectedMonths.delete(month);
  else selectedMonths.add(month);
  updateSelectionInfo();
  renderInventory(inventoryData);
}

function selectMissing() {
  if (!inventoryData) return;
  inventoryData.months
    .filter((month) => !month.present)
    .forEach((month) => selectedMonths.add(month.month));
  updateSelectionInfo();
  renderInventory(inventoryData);
}

function clearSelection() {
  selectedMonths.clear();
  updateSelectionInfo();
  renderInventory(inventoryData);
}

function renderInventory(data) {
  inventoryData = data;

  summaryEl.innerHTML = `
    <div class="stat"><strong>${data.presentCount}</strong><span>${t('presentCount')}</span></div>
    <div class="stat"><strong>${data.missingCount}</strong><span>${t('missingCount')}</span></div>
    <div class="stat"><strong>${data.noPlanCount || 0}</strong><span>${t('noPlanCount')}</span></div>
    <div class="stat"><strong>12</strong><span>${t('monthsTotal')}</span></div>
  `;

  monthsGrid.innerHTML = data.months.map((month) => {
    const selected = selectedMonths.has(month.month);
    const statusClass = month.present ? 'present' : (month.noPlan ? 'noplan' : 'missing');
    const badgeClass = month.present ? 'ok' : (month.noPlan ? 'warn' : 'no');
    const badgeText = month.present ? t('present') : (month.noPlan ? t('noPlanBadge') : t('missing'));
    return `
      <article class="month-card ${statusClass} ${selected ? 'selected' : ''}" data-month="${month.month}">
        <label class="month-label">
          <input type="checkbox" ${selected ? 'checked' : ''} ${running ? 'disabled' : ''}>
          <span>${month.label}</span>
        </label>
        <span class="badge ${badgeClass}">${badgeText}</span>
        ${month.file ? `<p class="file-name">${month.file}</p>` : ''}
      </article>
    `;
  }).join('');

  monthsGrid.querySelectorAll('.month-card').forEach((card) => {
    card.addEventListener('click', () => {
      if (running) return;
      toggleMonth(Number(card.dataset.month));
    });
  });
}

async function refreshInventory(preserveSelection = false) {
  if (!preserveSelection) {
    selectedMonths.clear();
    updateSelectionInfo();
  }
  const year = Number(yearSelect.value);
  const data = await api(`/api/inventory?year=${year}`);
  renderInventory(data);
}

async function startDownload(payload) {
  if (!configured) {
    openSettings({ required: true });
    appendLog(`⚠️ ${t('errNeedCredentials')}`);
    return;
  }
  setFlowStep(1);
  try {
    await api('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setRunning(true);
  } catch (error) {
    if (error.needsSetup) openSettings({ required: true });
    appendLog(`❌ ${error.message}`);
  }
}

function downloadSelected() {
  if (!selectedMonths.size) {
    appendLog(`⚠️ ${t('errSelectMonth')}`);
    return;
  }
  startDownload({
    year: Number(yearSelect.value),
    months: [...selectedMonths].sort((a, b) => a - b),
    requireTargets: true,
  });
}

function downloadMissing() {
  if (!inventoryData) {
    appendLog(`⚠️ ${t('errInventory')}`);
    return;
  }
  const months = inventoryData.months
    .filter((month) => !month.present)
    .map((month) => month.month)
    .sort((a, b) => a - b);
  if (!months.length) {
    appendLog(`ℹ️ ${t('errNoMissing', { year: yearSelect.value })}`);
    return;
  }
  startDownload({
    year: Number(yearSelect.value),
    months,
    requireTargets: true,
  });
}

function downloadCurrent() {
  startDownload({});
}

async function stopDownload() {
  try {
    await api('/api/stop', { method: 'POST' });
  } catch (error) {
    appendLog(`❌ ${error.message}`);
  }
}

async function runAutoConvert() {
  for (let i = 0; i < 60 && typeof window.convertAllPdfs !== 'function'; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (typeof window.convertAllPdfs !== 'function') {
    appendLog(`⚠️ ${t('errConvertNotReady')}`);
    return;
  }
  focusCalendar();
  appendLog(`ℹ️ ${t('logAutoConvert')}`);
  try {
    await window.convertAllPdfs();
  } catch (error) {
    appendLog(`❌ ${error.message}`);
  }
}

function connectEvents() {
  const source = new EventSource('/api/events');

  source.addEventListener('log', (event) => {
    appendLog(JSON.parse(event.data).line);
  });

  source.addEventListener('status', (event) => {
    setRunning(Boolean(JSON.parse(event.data).running));
  });

  source.addEventListener('done', async (event) => {
    const data = JSON.parse(event.data);
    setRunning(false);
    selectedMonths.clear();
    updateSelectionInfo();
    if (data.ok) {
      await refreshInventory();
      await runAutoConvert();
    } else {
      const year = Number(yearSelect.value);
      renderInventory(await api(`/api/inventory?year=${year}`));
    }
  });

  source.onerror = () => appendLog(`⚠️ ${t('errReconnect')}`);
}

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  settingsError.hidden = true;
  try {
    const convert = typeof window.getConvertFormValues === 'function'
      ? window.getConvertFormValues()
      : undefined;
    const payload = {
      username: settingsUsername.value.trim(),
      headless: settingsHeadless.checked,
      locale: settingsLocale.value,
      convert,
    };
    if (settingsPassword.value) payload.password = settingsPassword.value;
    const result = await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (result.messages) messages = result.messages;
    if (result.locale) locale = result.locale;
    configured = Boolean(result.configured);
    if (result.convert && typeof window.onConvertSettingsSaved === 'function') {
      await window.onConvertSettingsSaved(result.convert);
    }
    applyStaticI18n();
    updateSetupUi();
    settingsModal.hidden = true;
    await refreshInventory(true);
  } catch (error) {
    settingsError.textContent = error.message;
    settingsError.hidden = false;
  }
});

yearSelect.addEventListener('change', refreshInventory);
refreshBtn.addEventListener('click', async () => {
  await refreshInventory(true);
  if (typeof window.refreshConvertTab === 'function') window.refreshConvertTab();
});
settingsBtn.addEventListener('click', () => openSettings({ required: false }));
setupBannerBtn.addEventListener('click', () => openSettings({ required: true }));
settingsCancelBtn.addEventListener('click', closeSettings);
downloadSelectedBtn.addEventListener('click', downloadSelected);
downloadMissingBtn.addEventListener('click', downloadMissing);
downloadCurrentBtn.addEventListener('click', downloadCurrent);
selectMissingBtn.addEventListener('click', selectMissing);
clearSelectionBtn.addEventListener('click', clearSelection);
stopBtn.addEventListener('click', stopDownload);
openDownloadsBtn.addEventListener('click', async () => {
  try {
    const result = await api('/api/open-downloads', { method: 'POST' });
    appendLog(t('logFolder', { path: result.path }));
  } catch (error) {
    appendLog(`❌ ${error.message}`);
  }
});

async function init() {
  setFlowStep(1);
  const status = await api('/api/status');
  if (status.messages) messages = status.messages;
  if (status.locale) locale = status.locale;
  configured = Boolean(status.configured);
  applyStaticI18n();
  setRunning(status.running);
  updateSelectionInfo();
  updateSetupUi();
  await loadSettingsIntoForm();
  await loadYears();
  await refreshInventory();
  connectEvents();

  for (let i = 0; i < 40 && typeof window.onConvertSettingsSaved !== 'function'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (typeof window.onConvertSettingsSaved === 'function') {
    const settings = await api('/api/settings');
    if (settings.convert) await window.onConvertSettingsSaved(settings.convert);
  }

  // Existing entries → show calendar step as available
  try {
    const entries = JSON.parse(localStorage.getItem('parsedEntries') || '[]');
    if (entries.length) setFlowStep(2);
  } catch {
    // ignore
  }

  if (location.hash === '#calendar') focusCalendar();

  if (!configured) openSettings({ required: true });
}

init().catch((error) => appendLog(`❌ ${t('errStart', { message: error.message })}`));
