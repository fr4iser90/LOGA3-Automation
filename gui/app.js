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
const openConverterBtn = document.getElementById('openConverterBtn');
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
const settingsCancelBtn = document.getElementById('settingsCancelBtn');
const settingsError = document.getElementById('settingsError');
const passwordHint = document.getElementById('passwordHint');
const settingsTitle = document.getElementById('settingsTitle');

let running = false;
let configured = false;
let inventoryData = null;
const selectedMonths = new Set();

function appendLog(line) {
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

function updateSelectionInfo() {
  const count = selectedMonths.size;
  selectionInfo.textContent = `${count} Monat${count === 1 ? '' : 'e'} ausgewählt`;
  downloadSelectedBtn.textContent = count ? `Ausgewählte laden (${count})` : 'Ausgewählte laden';
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    const err = new Error(data.error || 'Anfrage fehlgeschlagen');
    err.needsSetup = Boolean(data.needsSetup);
    throw err;
  }
  return data;
}

function openSettings({ required = false } = {}) {
  settingsTitle.textContent = required ? 'Willkommen — Zugang einrichten' : 'Einstellungen';
  settingsCancelBtn.hidden = required;
  passwordHint.hidden = !configured;
  settingsPassword.required = !configured;
  settingsPassword.value = '';
  settingsPassword.placeholder = configured ? '•••••••• (leer = behalten)' : 'Passwort';
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
  configured = Boolean(data.configured);
  settingsUsername.value = data.username || '';
  settingsHeadless.checked = data.headless === true;
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
  if (selectedMonths.has(month)) {
    selectedMonths.delete(month);
  } else {
    selectedMonths.add(month);
  }
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
    <div class="stat"><strong>${data.presentCount}</strong><span>vorhanden</span></div>
    <div class="stat"><strong>${data.missingCount}</strong><span>fehlen</span></div>
    <div class="stat"><strong>12</strong><span>Monate gesamt</span></div>
  `;

  monthsGrid.innerHTML = data.months.map((month) => {
    const selected = selectedMonths.has(month.month);
    return `
      <article class="month-card ${month.present ? 'present' : 'missing'} ${selected ? 'selected' : ''}" data-month="${month.month}">
        <label class="month-label">
          <input type="checkbox" ${selected ? 'checked' : ''} ${running ? 'disabled' : ''}>
          <span>${month.label}</span>
        </label>
        <span class="badge ${month.present ? 'ok' : 'no'}">${month.present ? 'vorhanden' : 'fehlt'}</span>
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
    appendLog('⚠️ Bitte zuerst Zugangsdaten speichern.');
    return;
  }
  try {
    const result = await api('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (result.targets?.length) {
      appendLog(`▶ Warteschlange: ${result.targets.join(' → ')}`);
    }
    setRunning(true);
  } catch (error) {
    if (error.needsSetup) openSettings({ required: true });
    appendLog(`❌ ${error.message}`);
  }
}

function downloadSelected() {
  if (!selectedMonths.size) {
    appendLog('⚠️ Bitte mindestens einen Monat auswählen.');
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
    appendLog('⚠️ Inventar noch nicht geladen.');
    return;
  }

  const months = inventoryData.months
    .filter((month) => !month.present)
    .map((month) => month.month)
    .sort((a, b) => a - b);

  if (!months.length) {
    appendLog(`ℹ️ Für ${yearSelect.value} fehlen keine Monate.`);
    return;
  }

  const labels = months.map((month) => inventoryData.months[month - 1].label);
  appendLog(`📋 Fehlende Monate (${months.length}): ${labels.join(' → ')}`);

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

function connectEvents() {
  const source = new EventSource('/api/events');

  source.addEventListener('log', (event) => {
    const data = JSON.parse(event.data);
    appendLog(data.line);
  });

  source.addEventListener('status', (event) => {
    const data = JSON.parse(event.data);
    setRunning(Boolean(data.running));
  });

  source.addEventListener('done', async (event) => {
    const data = JSON.parse(event.data);
    setRunning(false);
    selectedMonths.clear();
    updateSelectionInfo();
    if (data.ok) {
      await refreshInventory();
    } else {
      const year = Number(yearSelect.value);
      const refreshed = await api(`/api/inventory?year=${year}`);
      renderInventory(refreshed);
    }
  });

  source.onerror = () => {
    appendLog('⚠️ Verbindung zum Server unterbrochen, versuche erneut...');
  };
}

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  settingsError.hidden = true;
  try {
    const payload = {
      username: settingsUsername.value.trim(),
      headless: settingsHeadless.checked,
    };
    if (settingsPassword.value) {
      payload.password = settingsPassword.value;
    }
    const result = await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    configured = Boolean(result.configured);
    updateSetupUi();
    settingsModal.hidden = true;
  } catch (error) {
    settingsError.textContent = error.message;
    settingsError.hidden = false;
  }
});

yearSelect.addEventListener('change', refreshInventory);
refreshBtn.addEventListener('click', () => refreshInventory(true));
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
    appendLog(`📂 Ordner: ${result.path}`);
  } catch (error) {
    appendLog(`❌ ${error.message}`);
  }
});
openConverterBtn.addEventListener('click', async () => {
  try {
    const result = await api('/api/open-converter', { method: 'POST' });
    appendLog(`🌐 Converter: ${result.url}`);
  } catch (error) {
    appendLog(`❌ ${error.message}`);
  }
});

async function init() {
  const status = await api('/api/status');
  configured = Boolean(status.configured);
  setRunning(status.running);
  updateSelectionInfo();
  updateSetupUi();
  await loadSettingsIntoForm();
  await loadYears();
  await refreshInventory();
  connectEvents();
  if (!configured) {
    openSettings({ required: true });
  }
}

init().catch((error) => appendLog(`❌ Startfehler: ${error.message}`));
