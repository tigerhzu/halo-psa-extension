/**
 * options.js（設定頁，extension 頁面環境）
 *
 * 職責：讀 / 寫設定到 chrome.storage.local。包含：
 *  - Ornith / Azure OpenAI API 設定、互斥 Provider 與「測試連線」。
 *  - 聯絡人名單（contactGroups）：寄信 CC 快速加入用的群組與成員。
 *  - 簡單模式（ultimateMode）：開啟中的 HaloPSA 透過 storage change 即時套用。
 *
 * 設定的 key / 欄位須與其他模組一致：
 *  - service-worker.js：SETTINGS_KEY / DEFAULTS（Provider / API Keys）
 *  - besties-config.js：STORAGE_KEY = 'hpx_settings'、GROUPS_FIELD = 'contactGroups'
 *
 * 重點：儲存時一律「合併」整包設定，避免存 API 設定時清掉名單（或反之）。
 */
'use strict';

const SETTINGS_KEY = 'hpx_settings';
const GROUPS_FIELD = 'contactGroups';
const TEAMS_FIELD = 'ultimateTeams';
const TEAM_CATALOG_VERSION_FIELD = 'ultimateTeamsCatalogVersion';
const TEAM_CATALOG_VERSION = 2;
const DEFAULT_CC_FIELD = 'defaultCcRecipients';
const ONBOARDING_FIELD = 'onboardingVersion';
const SETTINGS_EXPORT_FORMAT = 'halo-psa-extension-settings';
const SETTINGS_EXPORT_VERSION = 1;
const AI_SETTINGS = window.HPX_AI_SETTINGS;
const PROVIDERS = AI_SETTINGS.PROVIDERS;
const API_KEY_FIELDS = ['ornithApiKey', 'azureApiKey', 'apiKey'];
const DEFAULT_TEAMS = [
  'Op Team A', 'Op Team B', 'Op Team C', 'Other Support',
  'Project Manager', 'SecOp Team A', 'Technical Solutions Division',
  'RD', 'Thailand Team', 'Sales&Admin',
];
const TEAM_PRESETS = DEFAULT_TEAMS.slice();

const DEFAULTS = {
  provider: '',
  ornithBaseUrl: AI_SETTINGS.ORNITH_BASE_URL,
  ornithModel: AI_SETTINGS.ORNITH_MODEL,
  ornithApiKey: '',
  azureEndpoint: '',
  azureDeployment: '',
  azureApiKey: '',
  theme: 'cute-ios',
  accent: '#0c2d55',
  opacity: 100,
  ultimateMode: false,
};

function normalizeAccent(value) {
  const hex = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : DEFAULTS.accent;
}

// 名單種子（與 besties-config.js 的 defaultGroups 對齊；使用者尚未設定時顯示）
const DEFAULT_GROUPS = [];

const $ = function (id) {
  return document.getElementById(id);
};

const els = {
  providerInputs: Array.from(document.querySelectorAll('input[name="provider"]')),
  providerOrnith: $('providerOrnith'),
  providerAzure: $('providerAzure'),
  providerLockHint: $('providerLockHint'),
  ornithBaseUrl: $('ornithBaseUrl'),
  ornithModel: $('ornithModel'),
  ornithApiKey: $('ornithApiKey'),
  toggleOrnithKey: $('toggleOrnithKey'),
  ornithSection: $('ornithSection'),
  removeOrnith: $('removeOrnith'),
  azureEndpoint: $('azureEndpoint'),
  azureDeployment: $('azureDeployment'),
  azureApiKey: $('azureApiKey'),
  toggleAzureKey: $('toggleAzureKey'),
  azureSection: $('azureSection'),
  removeAzure: $('removeAzure'),
  test: $('test'),
  status: $('status'),
  groups: $('groups'),
  addGroup: $('addGroup'),
  groupsStatus: $('groupsStatus'),
  theme: $('theme'),
  themeStatus: $('themeStatus'),
  accentRow: $('accentRow'),
  accentCustom: $('accentCustom'),
  accentValue: $('accentValue'),
  customColorWrap: $('customColorWrap'),
  opacity: $('opacity'),
  opacityValue: $('opacityValue'),
  ultimateMode: $('ultimateMode'),
  ultimateTeams: $('ultimateTeams'),
  newUltimateTeam: $('newUltimateTeam'),
  addUltimateTeam: $('addUltimateTeam'),
  teamPresets: $('teamPresets'),
  reopenOnboarding: $('reopenOnboarding'),
  ultimateTeamsStatus: $('ultimateTeamsStatus'),
  onboardingStatus: $('onboardingStatus'),
  defaultCcRecipients: $('defaultCcRecipients'),
  addDefaultCc: $('addDefaultCc'),
  defaultCcStatus: $('defaultCcStatus'),
  exportSettingsWithKeys: $('exportSettingsWithKeys'),
  exportSettingsWithoutKeys: $('exportSettingsWithoutKeys'),
  importSettings: $('importSettings'),
  importSettingsFile: $('importSettingsFile'),
  backupStatus: $('backupStatus'),
  saveStatus: $('saveStatus'),
  teamCount: $('teamCount'),
};

let opacitySetting = DEFAULTS.opacity;
let settingsPersistTimer = null;
let teamsPersistTimer = null;
let groupsPersistTimer = null;
let defaultCcPersistTimer = null;
let storageWriteQueue = Promise.resolve();
let pendingWrites = 0;

function setSaveIndicator(text, state) {
  if (!els.saveStatus) return;
  els.saveStatus.textContent = text;
  els.saveStatus.dataset.state = state || 'ok';
}

function setupNavigation() {
  const pageKeys = new Set(['workspace', 'writing', 'contacts', 'backup']);
  function showPage(focusContent) {
    const hash = window.location.hash.slice(1);
    if (hash === 'main') return;
    const key = pageKeys.has(hash) ? hash : 'workspace';
    document.querySelectorAll('.settings-page').forEach(function (page) { page.hidden = page.id !== key; });
    document.querySelectorAll('.nav-item').forEach(function (link) {
      const active = link.getAttribute('href') === '#' + key;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (focusContent) {
      $('main').focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }
  window.addEventListener('hashchange', function () { showPage(true); });
  showPage(false);
}

function enqueueStorageWrite(task) {
  pendingWrites += 1;
  setSaveIndicator('儲存中', 'busy');
  const run = storageWriteQueue.then(task, task).then(function (result) {
    pendingWrites -= 1;
    if (!pendingWrites) setSaveIndicator('已儲存', 'ok');
    return result;
  }, function (error) {
    pendingWrites -= 1;
    setSaveIndicator('儲存失敗，請重試', 'err');
    throw error;
  });
  storageWriteQueue = run.catch(function () {});
  return run;
}

function mergeFields(patch) {
  return enqueueStorageWrite(function () {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get(SETTINGS_KEY, function (data) {
        const readError = chrome.runtime.lastError;
        if (readError) { reject(new Error(readError.message || '無法讀取設定')); return; }
        const previous = (data && data[SETTINGS_KEY]) || {};
        const merged = Object.assign({}, previous, patch);
        chrome.storage.local.set({ [SETTINGS_KEY]: merged }, function () {
          const error = chrome.runtime.lastError;
          if (error) { reject(new Error(error.message || '無法保存設定')); return; }
          resolve(merged);
        });
      });
    });
  });
}

function readStoredSettings() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(SETTINGS_KEY, function (data) {
      resolve((data && data[SETTINGS_KEY]) || {});
    });
  });
}

function replaceStoredSettings(settings) {
  return enqueueStorageWrite(function () {
    return new Promise(function (resolve, reject) {
      try {
        AI_SETTINGS.validateExclusive(settings);
      } catch (error) {
        reject(error);
        return;
      }
      chrome.storage.local.set({ [SETTINGS_KEY]: settings }, function () {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || '無法保存設定'));
          return;
        }
        resolve(settings);
      });
    });
  });
}

function downloadSettingsJson(payload, includeApiKeys) {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const suffix = includeApiKeys ? 'complete' : 'without-api-keys';
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'halo-psa-settings-' + suffix + '-' + stamp + '.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function liveSettingsSnapshot() {
  return readStoredSettings().then(function (stored) {
    const live = collectSettings();
    live[TEAMS_FIELD] = readTeamsFromDom();
    live[GROUPS_FIELD] = readGroupsFromDom();
    live[DEFAULT_CC_FIELD] = readDefaultCcFromDom();
    return Object.assign({}, stored, live);
  });
}

function exportSettings(includeApiKeys) {
  liveSettingsSnapshot().then(function (settings) {
    const exported = Object.assign({}, settings);
    if (!includeApiKeys) {
      API_KEY_FIELDS.forEach(function (field) { delete exported[field]; });
    }
    downloadSettingsJson({
      format: SETTINGS_EXPORT_FORMAT,
      version: SETTINGS_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      includeApiKeys: includeApiKeys,
      settings: exported,
    }, includeApiKeys);
    setStatus(els.backupStatus, includeApiKeys
      ? '已匯出完整設定（含 API Key）✓'
      : '已匯出設定（不含 API Key）✓', 'ok');
  }).catch(function (error) {
    setStatus(els.backupStatus, '匯出失敗：' + (error.message || '無法讀取設定'), 'err');
  });
}

function normalizeImportedSettings(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('設定檔格式不正確。');
  }
  const hasSettingsEnvelope = Object.prototype.hasOwnProperty.call(payload, 'settings');
  if (hasSettingsEnvelope && (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings))) {
    throw new Error('設定檔內容不正確。');
  }
  if (payload.format && payload.format !== SETTINGS_EXPORT_FORMAT) {
    throw new Error('這不是 HaloPSA Writing Helper 的設定檔。');
  }
  const isEnvelope = hasSettingsEnvelope;
  const source = isEnvelope ? payload.settings : payload;
  const settings = {};
  Object.keys(source).forEach(function (key) {
    if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') settings[key] = source[key];
  });
  const includeApiKeys = !isEnvelope || payload.includeApiKeys !== false;
  // A no-secret backup never supplies credentials, even if key fields were added to it.
  if (!includeApiKeys) API_KEY_FIELDS.forEach(function (field) { delete settings[field]; });

  settings.ornithBaseUrl = String(settings.ornithBaseUrl || DEFAULTS.ornithBaseUrl).trim().replace(/\/+$/, '');
  settings.ornithModel = String(settings.ornithModel || DEFAULTS.ornithModel).trim();
  settings.ornithApiKey = String(settings.ornithApiKey || '').trim();
  settings.azureEndpoint = String(settings.azureEndpoint || '').trim().replace(/\/+$/, '');
  settings.azureDeployment = String(settings.azureDeployment || '').trim();
  settings.azureApiKey = String(settings.azureApiKey || '').trim();
  settings.provider = AI_SETTINGS.resolveProvider(settings);
  AI_SETTINGS.validateExclusive(settings);
  settings.theme = settings.theme === 'default' || settings.theme === 'cute-ios' ? settings.theme : DEFAULTS.theme;
  settings.accent = normalizeAccent(settings.accent);
  const opacity = Number(settings.opacity);
  settings.opacity = Number.isFinite(opacity) ? Math.max(40, Math.min(100, Math.round(opacity))) : DEFAULTS.opacity;
  settings.ultimateMode = settings.ultimateMode === true;
  if (Object.prototype.hasOwnProperty.call(settings, TEAMS_FIELD)) settings[TEAMS_FIELD] = normalizeTeamList(settings[TEAMS_FIELD]);

  return {
    settings: settings,
    includeApiKeys: includeApiKeys,
  };
}

function mergeImportedSettings(imported, current) {
  const next = Object.assign({}, imported.settings);
  if (!imported.includeApiKeys) {
    API_KEY_FIELDS.forEach(function (field) { next[field] = (current && current[field]) || ''; });
  }
  next.provider = AI_SETTINGS.resolveProvider(next);
  // Keep a different provider from inheriting the current provider's credentials.
  AI_SETTINGS.validateExclusive(next);
  return next;
}

function importSettingsFromFile(file) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    setStatus(els.backupStatus, '匯入失敗：設定檔不可超過 5 MB。', 'err');
    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const parsed = JSON.parse(String(reader.result || ''));
      const imported = normalizeImportedSettings(parsed);
      readStoredSettings().then(function (current) {
        return replaceStoredSettings(mergeImportedSettings(imported, current));
      }).then(function () {
        setStatus(els.backupStatus, '匯入成功，正在重新載入設定頁…', 'ok');
        setTimeout(function () { window.location.reload(); }, 350);
      }).catch(function (error) {
        setStatus(els.backupStatus, '匯入失敗：' + (error.message || '無法保存設定'), 'err');
      });
    } catch (error) {
      setStatus(els.backupStatus, '匯入失敗：' + ((error && error.message) || '設定檔不是有效的 JSON。'), 'err');
    }
  };
  reader.onerror = function () { setStatus(els.backupStatus, '匯入失敗：無法讀取檔案。', 'err'); };
  reader.readAsText(file);
}

function normalizeTeamList(teams) {
  const seen = new Set();
  return (Array.isArray(teams) ? teams : []).reduce(function (list, team) {
    const label = String(team || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key) || list.length >= 20) return list;
    seen.add(key); list.push(label); return list;
  }, []);
}

function readTeamsFromDom() {
  return normalizeTeamList(Array.from(els.ultimateTeams.querySelectorAll('[data-team-name]')).map(function (node) {
    return node.getAttribute('data-team-name');
  }));
}

function mergeTeamCatalog(teams) {
  const merged = normalizeTeamList(teams);
  const seen = new Set(merged.map(function (team) { return team.toLocaleLowerCase(); }));
  TEAM_PRESETS.forEach(function (team) {
    const key = team.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(team);
  });
  return normalizeTeamList(merged);
}

/**
 * 將舊版只包含 A/B/C（或舊版預設 Team）的清單一次補齊目前 HaloPSA Team catalog。
 * 寫入版本旗標後，使用者之後手動移除的 Team 不會在每次載入時被加回。
 */
function ensureTeamCatalog(settings) {
  const source = settings || {};
  if (Number(source[TEAM_CATALOG_VERSION_FIELD] || 0) >= TEAM_CATALOG_VERSION) {
    return Promise.resolve(source);
  }
  const existing = Array.isArray(source[TEAMS_FIELD]) ? source[TEAMS_FIELD] : DEFAULT_TEAMS;
  return mergeFields({
    [TEAMS_FIELD]: mergeTeamCatalog(existing),
    [TEAM_CATALOG_VERSION_FIELD]: TEAM_CATALOG_VERSION,
  });
}

function scheduleTeamsPersist() {
  setSaveIndicator('儲存中', 'busy');
  if (teamsPersistTimer) clearTimeout(teamsPersistTimer);
  teamsPersistTimer = setTimeout(function () {
    teamsPersistTimer = null;
    mergeFields({ [TEAMS_FIELD]: readTeamsFromDom() }).then(function (merged) {
      const count = (merged[TEAMS_FIELD] || []).length;
      setStatus(els.ultimateTeamsStatus, '已自動套用 ✓（共 ' + count + ' 個 Team）', 'ok');
    }).catch(function (error) {
      setStatus(els.ultimateTeamsStatus, '無法儲存：' + error.message, 'err');
    });
  }, 120);
}

function updateTeamOrderButtons() {
  const rows = Array.from(els.ultimateTeams.querySelectorAll('[data-team-name]'));
  if (els.teamCount) els.teamCount.textContent = rows.length + ' 個';
  els.teamPresets.querySelectorAll('button').forEach(function (button) {
    const selected = rows.some(function (row) {
      return row.getAttribute('data-team-name').toLocaleLowerCase() === button.getAttribute('data-team-preset').toLocaleLowerCase();
    });
    button.disabled = selected;
    button.title = selected ? '已加入清單' : '加入 ' + button.getAttribute('data-team-preset');
  });
  rows.forEach(function (row, index) {
    const buttons = row.querySelectorAll('.team-order-btn');
    if (buttons.length < 2) return;
    buttons[0].disabled = index === 0;
    buttons[1].disabled = index === rows.length - 1;
  });
}

function moveTeamRow(row, direction) {
  if (!row || !row.parentElement) return;
  const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling || !sibling.hasAttribute('data-team-name')) return;
  if (direction < 0) row.parentElement.insertBefore(row, sibling);
  else row.parentElement.insertBefore(sibling, row);
  updateTeamOrderButtons();
  scheduleTeamsPersist();
}

function renderUltimateTeams(teams) {
  els.ultimateTeams.textContent = '';
  normalizeTeamList(teams).forEach(function (team) {
    const row = makeEl('div', 'setting-row ultimate-team-row');
    row.setAttribute('data-team-name', team);
    row.draggable = true;
    const handle = makeEl('span', 'team-drag-handle', '⋮⋮');
    handle.setAttribute('role', 'img');
    handle.setAttribute('aria-label', '拖曳調整 Team 順序');
    handle.title = '拖曳調整順序';
    row.appendChild(handle);
    row.appendChild(makeEl('span', 'ultimate-team-name', team));
    const order = makeEl('span', 'team-order-actions');
    const up = makeEl('button', 'btn-sm team-order-btn', '↑');
    up.type = 'button'; up.title = '上移'; up.setAttribute('aria-label', '上移 ' + team);
    up.addEventListener('click', function () { moveTeamRow(row, -1); });
    const down = makeEl('button', 'btn-sm team-order-btn', '↓');
    down.type = 'button'; down.title = '下移'; down.setAttribute('aria-label', '下移 ' + team);
    down.addEventListener('click', function () { moveTeamRow(row, 1); });
    order.appendChild(up); order.appendChild(down); row.appendChild(order);
    const remove = makeEl('button', 'btn-sm btn-danger', '移除');
    remove.type = 'button'; remove.addEventListener('click', function () {
      row.remove();
      updateTeamOrderButtons();
      if (!els.ultimateTeams.querySelector('[data-team-name]')) {
        els.ultimateTeams.appendChild(makeEl('p', 'empty-hint', '目前不保留任何 Team（仍會保留 Timesheets）。'));
      }
      scheduleTeamsPersist();
    });
    row.appendChild(remove); els.ultimateTeams.appendChild(row);

    row.addEventListener('dragstart', function (event) {
      row.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', team);
      }
    });
    row.addEventListener('dragend', function () {
      row.classList.remove('is-dragging');
      updateTeamOrderButtons();
      scheduleTeamsPersist();
    });
    row.addEventListener('dragover', function (event) {
      event.preventDefault();
      const dragging = els.ultimateTeams.querySelector('.is-dragging');
      if (!dragging || dragging === row) return;
      const rect = row.getBoundingClientRect();
      const insertBefore = event.clientY < rect.top + rect.height / 2;
      els.ultimateTeams.insertBefore(dragging, insertBefore ? row : row.nextElementSibling);
      updateTeamOrderButtons();
    });
  });
  if (!els.ultimateTeams.children.length) els.ultimateTeams.appendChild(makeEl('p', 'empty-hint', '目前不保留任何 Team（仍會保留 Timesheets）。'));
  updateTeamOrderButtons();
}

function addUltimateTeam(label) {
  if (!String(label || '').trim()) { els.newUltimateTeam.focus(); return; }
  const teams = readTeamsFromDom(); teams.push(label); renderUltimateTeams(normalizeTeamList(teams));
  scheduleTeamsPersist();
}

function makeDefaultCcRow(recipient) {
  const row = makeEl('div', 'setting-row default-cc-row');
  const name = makeEl('input', 'default-cc-name'); name.type = 'text'; name.placeholder = '姓名（選填）'; name.value = (recipient && recipient.name) || '';
  const email = makeEl('input', 'default-cc-email'); email.type = 'text'; email.placeholder = 'name@example.com'; email.value = (recipient && recipient.email) || '';
  name.setAttribute('aria-label', '永遠 CC 收件人姓名');
  email.setAttribute('aria-label', '永遠 CC 收件人 Email');
  email.inputMode = 'email'; email.autocomplete = 'off'; email.spellcheck = false;
  const remove = makeEl('button', 'btn-sm btn-danger', '移除'); remove.type = 'button'; remove.addEventListener('click', function () {
    row.remove();
    if (!els.defaultCcRecipients.querySelector('.default-cc-row')) {
      els.defaultCcRecipients.appendChild(makeEl('p', 'empty-hint', '尚未設定永遠 CC。'));
    }
    scheduleDefaultCcPersist();
  });
  name.addEventListener('input', scheduleDefaultCcPersist);
  email.addEventListener('input', scheduleDefaultCcPersist);
  row.appendChild(name); row.appendChild(email); row.appendChild(remove); return row;
}

function renderDefaultCc(recipients) {
  els.defaultCcRecipients.textContent = '';
  (Array.isArray(recipients) ? recipients : []).forEach(function (recipient) { els.defaultCcRecipients.appendChild(makeDefaultCcRow(recipient)); });
  if (!els.defaultCcRecipients.children.length) els.defaultCcRecipients.appendChild(makeEl('p', 'empty-hint', '尚未設定永遠 CC。'));
}

function readDefaultCcFromDom() {
  return Array.from(els.defaultCcRecipients.querySelectorAll('.default-cc-row')).map(function (row) {
    return { name: row.querySelector('.default-cc-name').value.trim(), email: row.querySelector('.default-cc-email').value.trim() };
  }).filter(function (recipient) { return recipient.email.indexOf('@') > 0; });
}

function setStatus(node, text, kind) {
  if (!node) return;
  node.textContent = text || '';
  node.className = 'status' + (kind ? ' ' + kind : '');
  if (kind === 'err') setSaveIndicator('有項目需要處理', 'err');
}

// ── 名單編輯 UI（資料驅動）─────────────────────────────────

function makeEl(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function makeMemberRow(member) {
  const row = makeEl('div', 'member-row');

  const name = makeEl('input', 'm-name');
  name.type = 'text';
  name.placeholder = '顯示名稱（可空）';
  name.value = (member && member.name) || '';
  name.setAttribute('aria-label', '群組成員姓名');

  const email = makeEl('input', 'm-email');
  email.type = 'text';
  email.placeholder = 'name@example.com';
  email.value = (member && member.email) || '';
  email.setAttribute('aria-label', '群組成員 Email');
  email.inputMode = 'email'; email.autocomplete = 'off'; email.spellcheck = false;

  const del = makeEl('button', 'btn-sm btn-danger', '刪除');
  del.type = 'button';
  del.addEventListener('click', function () {
    row.remove();
    scheduleGroupsPersist();
  });

  name.addEventListener('input', scheduleGroupsPersist);
  email.addEventListener('input', scheduleGroupsPersist);

  row.appendChild(name);
  row.appendChild(email);
  row.appendChild(del);
  return row;
}

function makeGroupCard(group) {
  const card = makeEl('div', 'group');

  const head = makeEl('div', 'group-head');
  const gname = makeEl('input', 'group-name');
  gname.type = 'text';
  gname.placeholder = '群組名稱（例如：主管 / 同事 / 專案經理）';
  gname.value = (group && group.name) || '';
  gname.setAttribute('aria-label', '群組名稱');
  const delGroup = makeEl('button', 'btn-sm btn-danger', '刪除群組');
  delGroup.type = 'button';
  delGroup.addEventListener('click', function () {
    card.remove();
    if (!els.groups.querySelector('.group')) renderGroups([]);
    scheduleGroupsPersist();
  });
  gname.addEventListener('input', scheduleGroupsPersist);
  head.appendChild(gname);
  head.appendChild(delGroup);
  card.appendChild(head);

  const members = makeEl('div', 'members');
  ((group && group.members) || []).forEach(function (m) {
    members.appendChild(makeMemberRow(m));
  });
  card.appendChild(members);

  const actions = makeEl('div', 'group-actions');
  const addMember = makeEl('button', 'btn-sm', '＋ 新增成員');
  addMember.type = 'button';
  addMember.addEventListener('click', function () {
    const row = makeMemberRow({ name: '', email: '' });
    members.appendChild(row);
    row.querySelector('input').focus();
    scheduleGroupsPersist();
  });
  actions.appendChild(addMember);
  card.appendChild(actions);

  return card;
}

/** 從 DOM 讀回目前名單（過濾掉沒有有效 email 的成員 / 空群組）。 */
function readGroupsFromDom() {
  const cards = els.groups.querySelectorAll('.group');
  const groups = [];
  cards.forEach(function (card) {
    const name = (card.querySelector('.group-name').value || '').trim();
    const members = [];
    card.querySelectorAll('.member-row').forEach(function (row) {
      const mName = (row.querySelector('.m-name').value || '').trim();
      const mEmail = (row.querySelector('.m-email').value || '').trim();
      if (mEmail.indexOf('@') !== -1) {
        members.push({ name: mName, email: mEmail });
      }
    });
    if (name || members.length) {
      groups.push({ name: name || '（未命名群組）', members: members });
    }
  });
  return groups;
}

/** 把目前 DOM 狀態重繪（先讀回，避免結構變動時遺失未存的編輯）。 */
function renderGroups(groups) {
  els.groups.textContent = '';
  if (!groups.length) {
    els.groups.appendChild(makeEl('p', 'empty-hint', '目前沒有任何群組，點「新增群組」開始建立。'));
  }
  groups.forEach(function (g) {
    els.groups.appendChild(makeGroupCard(g));
  });
}

// ── 設定讀寫（合併）────────────────────────────────────────

function activeAccent() {
  const rawCustom = els.accentCustom && String(els.accentCustom.value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(rawCustom)) return rawCustom.toLowerCase();
  const on = els.accentRow.querySelector('.swatch.active');
  return normalizeAccent(on && on.getAttribute('data-accent'));
}

function refreshAccentUi() {
  const accent = activeAccent();
  els.accentRow.querySelectorAll('.swatch').forEach(function (button) {
    const active = button.getAttribute('data-accent') === accent;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (els.accentCustom) els.accentCustom.value = accent;
  if (els.accentValue) els.accentValue.textContent = accent.toUpperCase();
  if (els.customColorWrap) {
    const isPreset = Array.from(els.accentRow.querySelectorAll('.swatch')).some(function (button) {
      return button.getAttribute('data-accent') === accent;
    });
    els.customColorWrap.classList.toggle('active', !isPreset);
  }
}

function currentOpacity() {
  const v = parseInt(els.opacity ? els.opacity.value : opacitySetting, 10);
  return isNaN(v) ? DEFAULTS.opacity : Math.max(40, Math.min(100, v));
}

function selectedProvider() {
  const selected = els.providerInputs.find(function (input) { return input.checked; });
  return selected ? selected.value : '';
}

function collectSettings() {
  return {
    provider: selectedProvider(),
    ornithBaseUrl: els.ornithBaseUrl.value.trim().replace(/\/+$/, ''),
    ornithModel: els.ornithModel.value.trim(),
    ornithApiKey: els.ornithApiKey.value.trim(),
    azureEndpoint: els.azureEndpoint.value.trim().replace(/\/+$/, ''),
    azureDeployment: els.azureDeployment.value.trim(),
    azureApiKey: els.azureApiKey.value.trim(),
    theme: els.theme.value,
    accent: activeAccent(),
    opacity: currentOpacity(),
    ultimateMode: els.ultimateMode.checked,
    // contactGroups 不在這裡：由 persistGroups() 獨立寫入。
    // 若放在這裡，theme/accent 自動儲存或「測試連線」在 load() 完成前觸發時，
    // 會以空 DOM（[]）覆蓋已存在的 contactGroups。
  };
}

/** 設定頁本身即時套用 theme / accent，並沿用已保存的 opacity（即時預覽）。 */
function applyAppearance() {
  const root = document.documentElement;
  root.setAttribute('data-hpx-theme', els.theme.value || 'cute-ios');
  root.style.setProperty('--hpx-accent', activeAccent());
  const hex = activeAccent().slice(1);
  const rgb = [0, 2, 4].map(function (offset) {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  root.style.setProperty('--hpx-accent-ink', luminance > .179 ? '#000000' : '#ffffff');
  const frac = (currentOpacity() / 100).toFixed(2);
  root.style.setProperty('--hpx-opacity', frac);
  root.style.setProperty('--hpx-glass-opacity', frac);
  if (els.opacityValue) els.opacityValue.textContent = currentOpacity() + '%';
}

/** 寫入 AI 設定＋外觀（不含 contactGroups，避免覆蓋名單）。 */
function persist() {
  const next = collectSettings();
  return enqueueStorageWrite(function () {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get(SETTINGS_KEY, function (data) {
        const readError = chrome.runtime.lastError;
        if (readError) { reject(new Error(readError.message || '無法讀取設定')); return; }
        const prev = (data && data[SETTINGS_KEY]) || {};
        const merged = Object.assign({}, prev, next);
        try {
          AI_SETTINGS.validateExclusive(merged);
        } catch (error) {
          reject(error);
          return;
        }
        chrome.storage.local.set({ [SETTINGS_KEY]: merged }, function () {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message || '無法保存設定'));
            return;
          }
          resolve(merged);
        });
      });
    });
  });
}

/** 只寫入 contactGroups，讀自目前 DOM 狀態。 */
function persistGroups() {
  const groups = readGroupsFromDom();
  return enqueueStorageWrite(function () {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get(SETTINGS_KEY, function (data) {
        const readError = chrome.runtime.lastError;
        if (readError) { reject(new Error(readError.message || '無法讀取設定')); return; }
        const prev = (data && data[SETTINGS_KEY]) || {};
        const merged = Object.assign({}, prev, { [GROUPS_FIELD]: groups });
        chrome.storage.local.set({ [SETTINGS_KEY]: merged }, function () {
          const error = chrome.runtime.lastError;
          if (error) { reject(new Error(error.message || '無法保存名單')); return; }
          resolve(merged);
        });
      });
    });
  });
}

function scheduleSettingsPersist(statusNode, message) {
  setSaveIndicator('儲存中', 'busy');
  if (settingsPersistTimer) clearTimeout(settingsPersistTimer);
  settingsPersistTimer = setTimeout(function () {
    settingsPersistTimer = null;
    persist().then(function (merged) {
      applyProviderState(merged);
      if (statusNode) setStatus(statusNode, message || '已自動套用 ✓', 'ok');
    }).catch(function (error) {
      if (statusNode) setStatus(statusNode, '無法儲存：' + (error.message || 'Provider 設定衝突'), 'err');
    });
  }, 180);
}

function scheduleGroupsPersist() {
  setSaveIndicator('儲存中', 'busy');
  if (groupsPersistTimer) clearTimeout(groupsPersistTimer);
  groupsPersistTimer = setTimeout(function () {
    groupsPersistTimer = null;
    persistGroups().then(function (merged) {
      const count = (merged[GROUPS_FIELD] || []).length;
      setStatus(els.groupsStatus, '已自動套用 ✓（共 ' + count + ' 個群組）', 'ok');
    }).catch(function (error) {
      setStatus(els.groupsStatus, '無法儲存：' + error.message, 'err');
    });
  }, 180);
}

function scheduleDefaultCcPersist() {
  setSaveIndicator('儲存中', 'busy');
  if (defaultCcPersistTimer) clearTimeout(defaultCcPersistTimer);
  defaultCcPersistTimer = setTimeout(function () {
    defaultCcPersistTimer = null;
    mergeFields({ [DEFAULT_CC_FIELD]: readDefaultCcFromDom() }).then(function (merged) {
      const count = (merged[DEFAULT_CC_FIELD] || []).length;
      setStatus(els.defaultCcStatus, '已自動套用 ✓（共 ' + count + ' 位）', 'ok');
    }).catch(function (error) {
      setStatus(els.defaultCcStatus, '無法儲存：' + error.message, 'err');
    });
  }, 180);
}

function setProviderSectionEnabled(section, enabled) {
  section.classList.toggle('is-disabled', !enabled);
  section.querySelectorAll('[data-provider-input]').forEach(function (input) {
    input.disabled = !enabled;
  });
}

function applyProviderState(settings) {
  const source = settings || collectSettings();
  const provider = selectedProvider() || AI_SETTINGS.resolveProvider(source);
  const azureConfigured = !!String(source.azureApiKey || '').trim();
  const ornithConfigured = !!String(source.ornithApiKey || '').trim();
  const conflict = azureConfigured && ornithConfigured;

  els.providerAzure.checked = provider === PROVIDERS.AZURE;
  els.providerOrnith.checked = provider === PROVIDERS.ORNITH;
  els.providerAzure.disabled = conflict || ornithConfigured;
  els.providerOrnith.disabled = conflict || azureConfigured;

  setProviderSectionEnabled(els.azureSection, !conflict && provider === PROVIDERS.AZURE);
  setProviderSectionEnabled(els.ornithSection, !conflict && provider === PROVIDERS.ORNITH);
  // Keep conflict recovery visible; otherwise show only the selected service's form.
  els.azureSection.hidden = !conflict && provider !== PROVIDERS.AZURE;
  els.ornithSection.hidden = !conflict && provider !== PROVIDERS.ORNITH;
  els.removeAzure.disabled = !azureConfigured;
  els.removeOrnith.disabled = !ornithConfigured;

  if (conflict) {
    els.providerLockHint.textContent = '兩組 API Key 同時存在。請移除其中一組後再使用 AI。';
  } else if (azureConfigured) {
    els.providerLockHint.textContent = 'Azure OpenAI 已設定。若要改用 Ornith，請先移除 Azure 設定。';
  } else if (ornithConfigured) {
    els.providerLockHint.textContent = 'Ornith 已設定。若要改用 Azure，請先移除 Ornith 設定。';
  } else if (!provider) {
    els.providerLockHint.textContent = '';
  } else {
    els.providerLockHint.textContent = '';
  }
}

function load() {
  chrome.storage.local.get(SETTINGS_KEY, function (data) {
    const readError = chrome.runtime.lastError;
    if (readError) { setSaveIndicator('無法載入設定，請重新開啟', 'err'); return; }
    const raw = (data && data[SETTINGS_KEY]) || {};
    ensureTeamCatalog(raw).catch(function () { return raw; }).then(function (s) {
      const provider = AI_SETTINGS.resolveProvider(s);
      els.providerOrnith.checked = provider === PROVIDERS.ORNITH;
      els.providerAzure.checked = provider === PROVIDERS.AZURE;
      els.ornithBaseUrl.value = s.ornithBaseUrl || DEFAULTS.ornithBaseUrl;
      els.ornithModel.value = s.ornithModel || DEFAULTS.ornithModel;
      els.ornithApiKey.value = s.ornithApiKey || DEFAULTS.ornithApiKey;
      els.azureEndpoint.value = s.azureEndpoint || DEFAULTS.azureEndpoint;
      els.azureDeployment.value = s.azureDeployment || DEFAULTS.azureDeployment;
      els.azureApiKey.value = s.azureApiKey || DEFAULTS.azureApiKey;
      applyProviderState(Object.assign({}, s, { provider: provider }));

      els.theme.value = s.theme === 'default' || s.theme === 'cute-ios' ? s.theme : DEFAULTS.theme;
      const accent = normalizeAccent(s.accent);
      if (els.accentCustom) els.accentCustom.value = accent;
      els.accentRow.querySelectorAll('.swatch').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-accent') === accent);
      });
      refreshAccentUi();
      opacitySetting = typeof s.opacity === 'number' ? s.opacity : DEFAULTS.opacity;
      if (els.opacity) els.opacity.value = opacitySetting;
      els.ultimateMode.checked = typeof s.ultimateMode === 'boolean' ? s.ultimateMode : DEFAULTS.ultimateMode;
      renderUltimateTeams(Array.isArray(s[TEAMS_FIELD]) ? s[TEAMS_FIELD] : DEFAULT_TEAMS);
      renderDefaultCc(Array.isArray(s[DEFAULT_CC_FIELD]) ? s[DEFAULT_CC_FIELD] : []);
      applyAppearance();

      const groups = Array.isArray(s[GROUPS_FIELD]) && s[GROUPS_FIELD].length
        ? s[GROUPS_FIELD]
        : DEFAULT_GROUPS;
      renderGroups(groups);
      if (!pendingWrites) setSaveIndicator('自動儲存', 'ok');
    });
  });
}

// ── 事件 ───────────────────────────────────────────────────

function onSettingsFieldChanged() {
  scheduleSettingsPersist(els.status, '已儲存');
}

els.providerInputs.forEach(function (input) {
  input.addEventListener('change', function () {
    applyProviderState(collectSettings());
    onSettingsFieldChanged();
  });
});

[els.ornithBaseUrl, els.ornithModel, els.ornithApiKey, els.azureEndpoint, els.azureDeployment, els.azureApiKey].forEach(function (input) {
  input.addEventListener('input', onSettingsFieldChanged);
});
els.toggleOrnithKey.addEventListener('click', function () {
  const isPwd = els.ornithApiKey.type === 'password';
  els.ornithApiKey.type = isPwd ? 'text' : 'password';
  els.toggleOrnithKey.textContent = isPwd ? '隱藏' : '顯示';
  els.toggleOrnithKey.setAttribute('aria-pressed', String(isPwd));
});

els.toggleAzureKey.addEventListener('click', function () {
  const isPwd = els.azureApiKey.type === 'password';
  els.azureApiKey.type = isPwd ? 'text' : 'password';
  els.toggleAzureKey.textContent = isPwd ? '隱藏' : '顯示';
  els.toggleAzureKey.setAttribute('aria-pressed', String(isPwd));
});

function removeProviderSettings(provider) {
  if (settingsPersistTimer) {
    clearTimeout(settingsPersistTimer);
    settingsPersistTimer = null;
  }
  if (provider === PROVIDERS.ORNITH) {
    els.ornithBaseUrl.value = DEFAULTS.ornithBaseUrl;
    els.ornithModel.value = DEFAULTS.ornithModel;
    els.ornithApiKey.value = '';
  } else {
    els.azureEndpoint.value = '';
    els.azureDeployment.value = '';
    els.azureApiKey.value = '';
  }

  const remainingProvider = provider === PROVIDERS.ORNITH && els.azureApiKey.value.trim()
    ? PROVIDERS.AZURE
    : (provider === PROVIDERS.AZURE && els.ornithApiKey.value.trim() ? PROVIDERS.ORNITH : '');
  els.providerInputs.forEach(function (input) { input.checked = input.value === remainingProvider; });
  persist().then(function (merged) {
    applyProviderState(merged);
    setStatus(els.status, provider === PROVIDERS.ORNITH ? '已移除 Ornith 設定。' : '已移除 Azure OpenAI 設定。', 'ok');
  }).catch(function (error) {
    setStatus(els.status, '移除失敗：' + (error.message || '無法保存設定'), 'err');
  });
}

els.removeOrnith.addEventListener('click', function () { removeProviderSettings(PROVIDERS.ORNITH); });
els.removeAzure.addEventListener('click', function () { removeProviderSettings(PROVIDERS.AZURE); });

els.addGroup.addEventListener('click', function () {
  const empty = els.groups.querySelector('.empty-hint');
  if (empty) empty.remove();
  const created = makeGroupCard({ name: '', members: [{ name: '', email: '' }] });
  els.groups.appendChild(created);
  created.querySelector('.group-name').focus();
  scheduleGroupsPersist();
});

els.theme.addEventListener('change', function () {
  applyAppearance(); // 設定頁即時預覽
  persist().then(function () {
    setStatus(els.themeStatus, '已套用', 'ok');
  }).catch(function (error) {
    setStatus(els.themeStatus, '無法儲存：' + error.message, 'err');
  });
});

els.accentRow.addEventListener('click', function (e) {
  const btn = e.target.closest('.swatch');
  if (!btn) return;
  els.accentRow.querySelectorAll('.swatch').forEach(function (b) {
    b.classList.remove('active');
  });
  btn.classList.add('active');
  if (els.accentCustom) els.accentCustom.value = normalizeAccent(btn.getAttribute('data-accent'));
  refreshAccentUi();
  applyAppearance();
  persist().then(function () {
    setStatus(els.themeStatus, '已套用', 'ok');
  }).catch(function (error) {
    setStatus(els.themeStatus, '無法儲存：' + error.message, 'err');
  });
});

if (els.accentCustom) {
  els.accentCustom.addEventListener('input', function () {
    els.accentRow.querySelectorAll('.swatch').forEach(function (b) { b.classList.remove('active'); });
    refreshAccentUi();
    applyAppearance();
    scheduleSettingsPersist(els.themeStatus, '已套用');
  });
  els.accentCustom.addEventListener('change', function () {
    persist().then(function () {
      setStatus(els.themeStatus, '已套用', 'ok');
    }).catch(function (error) {
      setStatus(els.themeStatus, '無法儲存：' + error.message, 'err');
    });
  });
}

if (els.opacity) {
  els.opacity.addEventListener('input', function () {
    opacitySetting = els.opacity.value;
    applyAppearance();
    scheduleSettingsPersist(els.themeStatus, '已自動套用透明度 ✓');
  });
}

els.ultimateMode.addEventListener('change', function () {
  persist().then(function () {
    setStatus(els.ultimateTeamsStatus, '已自動套用簡單模式 ✓', 'ok');
  }).catch(function (error) {
    setStatus(els.ultimateTeamsStatus, '無法儲存：' + error.message, 'err');
  });
});

TEAM_PRESETS.forEach(function (team) {
  const button = makeEl('button', 'btn-sm', '＋ ' + team);
  button.type = 'button';
  button.setAttribute('data-team-preset', team);
  button.addEventListener('click', function () { addUltimateTeam(team); });
  els.teamPresets.appendChild(button);
});

els.addUltimateTeam.addEventListener('click', function () {
  addUltimateTeam(els.newUltimateTeam.value);
  els.newUltimateTeam.value = '';
});

els.newUltimateTeam.addEventListener('keydown', function (event) {
  if (event.key !== 'Enter') return;
  event.preventDefault(); els.addUltimateTeam.click();
});

els.reopenOnboarding.addEventListener('click', function () {
  mergeFields({ [ONBOARDING_FIELD]: 0 }).then(function () {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'HPX_OPEN_ONBOARDING' }, function (response) {
          // 讀取 lastError 以避免沒有回應的訊息造成未處理警告；設定已先成功保存。
          const lastError = chrome.runtime.lastError;
          resolve({ response: response, error: lastError && lastError.message });
        });
      } catch (error) {
        resolve({ error: error.message || '無法開啟首次登入提示' });
      }
    });
  }).then(function (result) {
    if (result && result.error) {
      setStatus(els.onboardingStatus, '無法開啟首次登入提示：' + result.error, 'err');
      return;
    }
    if (result && result.response && result.response.ok === false) {
      setStatus(els.onboardingStatus, result.response.error || '無法開啟首次登入提示。', 'err');
      return;
    }
    setStatus(els.onboardingStatus, '已開啟首次登入提示。', 'ok');
  }).catch(function (error) {
    setStatus(els.onboardingStatus, '無法開啟設定導引：' + error.message, 'err');
  });
});

els.addDefaultCc.addEventListener('click', function () {
  const empty = els.defaultCcRecipients.querySelector('.empty-hint');
  if (empty) empty.remove();
  const row = makeDefaultCcRow({});
  els.defaultCcRecipients.appendChild(row);
  row.querySelector('input').focus();
  scheduleDefaultCcPersist();
});

els.exportSettingsWithKeys.addEventListener('click', function () {
  exportSettings(true);
});

els.exportSettingsWithoutKeys.addEventListener('click', function () {
  exportSettings(false);
});

els.importSettings.addEventListener('click', function () {
  if (!window.confirm('匯入會取代目前的完整設定；含 API Key 的檔案請確認來源可信。要繼續嗎？')) return;
  els.importSettingsFile.value = '';
  els.importSettingsFile.click();
});

els.importSettingsFile.addEventListener('change', function () {
  const file = els.importSettingsFile.files && els.importSettingsFile.files[0];
  importSettingsFromFile(file);
  els.importSettingsFile.value = '';
});

els.test.addEventListener('click', function () {
  const provider = selectedProvider();
  const activeKey = provider === PROVIDERS.AZURE
    ? els.azureApiKey.value.trim()
    : (provider === PROVIDERS.ORNITH ? els.ornithApiKey.value.trim() : '');

  if (!provider) {
    setStatus(els.status, '請先選擇 AI Provider。', 'err');
    return;
  }
  if (provider === PROVIDERS.AZURE && !els.azureEndpoint.value.trim()) {
    setStatus(els.status, '請先填入 Azure Endpoint。', 'err');
    return;
  }
  if (provider === PROVIDERS.AZURE && !els.azureDeployment.value.trim()) {
    setStatus(els.status, '請先填入 Azure Deployment Name。', 'err');
    return;
  }
  if (provider === PROVIDERS.ORNITH && !els.ornithBaseUrl.value.trim()) {
    setStatus(els.status, '請先填入 Ornith Base URL。', 'err');
    return;
  }
  if (provider === PROVIDERS.ORNITH && !els.ornithModel.value.trim()) {
    setStatus(els.status, '請先填入 Ornith Model。', 'err');
    return;
  }
  if (!activeKey) {
    setStatus(els.status, '請先填入 API Key。', 'err');
    return;
  }

  els.test.disabled = true;
  setStatus(els.status, '測試中…', 'busy');

  persist()
    .then(function () {
      return new Promise(function (resolve) {
        chrome.runtime.sendMessage({ type: 'HPX_AI_PING' }, function (response) {
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            resolve({ ok: false, error: lastErr.message || '背景服務無回應' });
            return;
          }
          resolve(response || { ok: false, error: '背景服務無回應' });
        });
      });
    })
    .then(function (res) {
      if (res.ok) {
        const detail = res.provider === PROVIDERS.AZURE
          ? 'Azure OpenAI（' + (res.deployment || '') + '）'
          : 'Local Ornith（' + (res.model || '') + '）';
        setStatus(els.status, '連線成功 ✓ ' + detail + ' 可正常呼叫。', 'ok');
      } else {
        setStatus(els.status, '連線失敗：' + (res.error || '未知錯誤'), 'err');
      }
    })
    .catch(function (error) {
      setStatus(els.status, '連線失敗：' + (error.message || '無法保存設定'), 'err');
    })
    .finally(function () {
      els.test.disabled = false;
    });
});

setupNavigation();
load();
