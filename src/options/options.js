/**
 * options.js（設定頁，extension 頁面環境）
 *
 * 職責：讀 / 寫設定到 chrome.storage.local。包含：
 *  - Gemini API 設定（apiKey / model / useStub）與「測試連線」。
 *  - 聯絡人名單（contactGroups）：寄信 CC 快速加入用的群組與成員。
 *  - 簡單模式（ultimateMode）：開啟中的 HaloPSA 透過 storage change 即時套用。
 *
 * 設定的 key / 欄位須與其他模組一致：
 *  - service-worker.js：SETTINGS_KEY / DEFAULTS（apiKey / model / useStub）
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
const DEFAULT_TEAMS = [
  'Op Team A', 'Op Team B', 'Op Team C', 'Other Support',
  'Project Manager', 'SecOp Team A', 'Technical Solutions Division',
  'RD', 'Thailand Team', 'Sales&Admin',
];
const TEAM_PRESETS = DEFAULT_TEAMS.slice();

const DEFAULTS = {
  provider: 'azure-deepseek',
  azureEndpoint: '',
  azureDeployment: '',
  azureApiKey: '',
  apiKey: '',
  model: 'gemini-2.5-flash',
  useStub: false,
  theme: 'cute-ios',
  accent: '#1a8987',
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
  provider: $('provider'),
  azureEndpoint: $('azureEndpoint'),
  azureDeployment: $('azureDeployment'),
  azureApiKey: $('azureApiKey'),
  toggleAzureKey: $('toggleAzureKey'),
  azureSection: $('azureSection'),
  geminiSection: $('geminiSection'),
  apiKey: $('apiKey'),
  toggleKey: $('toggleKey'),
  model: $('model'),
  useStub: $('useStub'),
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
};

let opacitySetting = DEFAULTS.opacity;
let settingsPersistTimer = null;
let teamsPersistTimer = null;
let groupsPersistTimer = null;
let defaultCcPersistTimer = null;
let storageWriteQueue = Promise.resolve();

function enqueueStorageWrite(task) {
  const run = storageWriteQueue.then(task, task);
  storageWriteQueue = run.catch(function () {});
  return run;
}

function mergeFields(patch) {
  return enqueueStorageWrite(function () {
    return new Promise(function (resolve) {
      chrome.storage.local.get(SETTINGS_KEY, function (data) {
        const previous = (data && data[SETTINGS_KEY]) || {};
        const merged = Object.assign({}, previous, patch);
        chrome.storage.local.set({ [SETTINGS_KEY]: merged }, function () { resolve(merged); });
      });
    });
  });
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
  if (teamsPersistTimer) clearTimeout(teamsPersistTimer);
  teamsPersistTimer = setTimeout(function () {
    teamsPersistTimer = null;
    mergeFields({ [TEAMS_FIELD]: readTeamsFromDom() }).then(function (merged) {
      const count = (merged[TEAMS_FIELD] || []).length;
      setStatus(els.ultimateTeamsStatus, '已自動套用 ✓（共 ' + count + ' 個 Team）', 'ok');
    });
  }, 120);
}

function updateTeamOrderButtons() {
  const rows = Array.from(els.ultimateTeams.querySelectorAll('[data-team-name]'));
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
  const teams = readTeamsFromDom(); teams.push(label); renderUltimateTeams(normalizeTeamList(teams));
  scheduleTeamsPersist();
}

function makeDefaultCcRow(recipient) {
  const row = makeEl('div', 'setting-row default-cc-row');
  const name = makeEl('input', 'default-cc-name'); name.type = 'text'; name.placeholder = '姓名（選填）'; name.value = (recipient && recipient.name) || '';
  const email = makeEl('input', 'default-cc-email'); email.type = 'text'; email.placeholder = 'name@example.com'; email.value = (recipient && recipient.email) || '';
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

  const email = makeEl('input', 'm-email');
  email.type = 'text';
  email.placeholder = 'name@example.com';
  email.value = (member && member.email) || '';

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
  const delGroup = makeEl('button', 'btn-sm btn-danger', '刪除群組');
  delGroup.type = 'button';
  delGroup.addEventListener('click', function () {
    card.remove();
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
    members.appendChild(makeMemberRow({ name: '', email: '' }));
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

function collectSettings() {
  return {
    provider: els.provider.value,
    azureEndpoint: els.azureEndpoint.value.trim().replace(/\/+$/, ''),
    azureDeployment: els.azureDeployment.value.trim(),
    azureApiKey: els.azureApiKey.value.trim(),
    apiKey: els.apiKey.value.trim(),
    model: els.model.value,
    useStub: els.useStub.checked,
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
  const frac = (currentOpacity() / 100).toFixed(2);
  root.style.setProperty('--hpx-opacity', frac);
  root.style.setProperty('--hpx-glass-opacity', frac);
  if (els.opacityValue) els.opacityValue.textContent = currentOpacity() + '%';
}

/** 寫入 AI 設定＋外觀（不含 contactGroups，避免覆蓋名單）。 */
function persist() {
  const next = collectSettings();
  return enqueueStorageWrite(function () {
    return new Promise(function (resolve) {
      chrome.storage.local.get(SETTINGS_KEY, function (data) {
        const prev = (data && data[SETTINGS_KEY]) || {};
        const merged = Object.assign({}, prev, next);
        chrome.storage.local.set({ [SETTINGS_KEY]: merged }, function () {
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
    return new Promise(function (resolve) {
      chrome.storage.local.get(SETTINGS_KEY, function (data) {
        const prev = (data && data[SETTINGS_KEY]) || {};
        const merged = Object.assign({}, prev, { [GROUPS_FIELD]: groups });
        chrome.storage.local.set({ [SETTINGS_KEY]: merged }, function () {
          resolve(merged);
        });
      });
    });
  });
}

function scheduleSettingsPersist(statusNode, message) {
  if (settingsPersistTimer) clearTimeout(settingsPersistTimer);
  settingsPersistTimer = setTimeout(function () {
    settingsPersistTimer = null;
    persist().then(function () {
      if (statusNode) setStatus(statusNode, message || '已自動套用 ✓', 'ok');
    });
  }, 180);
}

function scheduleGroupsPersist() {
  if (groupsPersistTimer) clearTimeout(groupsPersistTimer);
  groupsPersistTimer = setTimeout(function () {
    groupsPersistTimer = null;
    persistGroups().then(function (merged) {
      const count = (merged[GROUPS_FIELD] || []).length;
      setStatus(els.groupsStatus, '已自動套用 ✓（共 ' + count + ' 個群組）', 'ok');
    });
  }, 180);
}

function scheduleDefaultCcPersist() {
  if (defaultCcPersistTimer) clearTimeout(defaultCcPersistTimer);
  defaultCcPersistTimer = setTimeout(function () {
    defaultCcPersistTimer = null;
    mergeFields({ [DEFAULT_CC_FIELD]: readDefaultCcFromDom() }).then(function (merged) {
      const count = (merged[DEFAULT_CC_FIELD] || []).length;
      setStatus(els.defaultCcStatus, '已自動套用 ✓（共 ' + count + ' 位）', 'ok');
    });
  }, 180);
}

function applyProviderSections(provider) {
  const isAzure = provider === 'azure-deepseek';
  els.azureSection.style.display = isAzure ? '' : 'none';
  els.geminiSection.style.display = isAzure ? 'none' : '';
}

function load() {
  chrome.storage.local.get(SETTINGS_KEY, function (data) {
    const raw = (data && data[SETTINGS_KEY]) || {};
    ensureTeamCatalog(raw).catch(function () { return raw; }).then(function (s) {
      const provider = s.provider || DEFAULTS.provider;
      els.provider.value = provider;
      applyProviderSections(provider);
      els.azureEndpoint.value = s.azureEndpoint || DEFAULTS.azureEndpoint;
      els.azureDeployment.value = s.azureDeployment || DEFAULTS.azureDeployment;
      els.azureApiKey.value = s.azureApiKey || DEFAULTS.azureApiKey;
      els.apiKey.value = s.apiKey || DEFAULTS.apiKey;
      els.model.value = s.model || DEFAULTS.model;
      els.useStub.checked = typeof s.useStub === 'boolean' ? s.useStub : DEFAULTS.useStub;

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
    });
  });
}

// ── 事件 ───────────────────────────────────────────────────

function onSettingsFieldChanged() {
  scheduleSettingsPersist(els.status, '已自動套用設定 ✓');
}

els.provider.addEventListener('change', function () {
  applyProviderSections(els.provider.value);
  onSettingsFieldChanged();
});

[els.azureEndpoint, els.azureDeployment, els.azureApiKey, els.apiKey].forEach(function (input) {
  input.addEventListener('input', onSettingsFieldChanged);
});
[els.model, els.useStub].forEach(function (input) {
  input.addEventListener('change', onSettingsFieldChanged);
});

els.toggleAzureKey.addEventListener('click', function () {
  const isPwd = els.azureApiKey.type === 'password';
  els.azureApiKey.type = isPwd ? 'text' : 'password';
  els.toggleAzureKey.textContent = isPwd ? '隱藏' : '顯示';
});

els.toggleKey.addEventListener('click', function () {
  const isPwd = els.apiKey.type === 'password';
  els.apiKey.type = isPwd ? 'text' : 'password';
  els.toggleKey.textContent = isPwd ? '隱藏' : '顯示';
});

els.addGroup.addEventListener('click', function () {
  const groups = readGroupsFromDom();
  groups.push({ name: '', members: [{ name: '', email: '' }] });
  renderGroups(groups);
  scheduleGroupsPersist();
});

els.theme.addEventListener('change', function () {
  applyAppearance(); // 設定頁即時預覽
  persist().then(function () {
    setStatus(els.themeStatus, '已套用 ✓ 開啟中的 HaloPSA 會即時更新（不需重整）。', 'ok');
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
    setStatus(els.themeStatus, '已套用 Accent ✓', 'ok');
  });
});

if (els.accentCustom) {
  els.accentCustom.addEventListener('input', function () {
    els.accentRow.querySelectorAll('.swatch').forEach(function (b) { b.classList.remove('active'); });
    refreshAccentUi();
    applyAppearance();
    onSettingsFieldChanged();
  });
  els.accentCustom.addEventListener('change', function () {
    persist().then(function () {
      setStatus(els.themeStatus, '已套用自訂 Accent ✓', 'ok');
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
  });
});

TEAM_PRESETS.forEach(function (team) {
  const button = makeEl('button', 'btn-sm', '＋ ' + team);
  button.type = 'button';
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
  });
});

els.addDefaultCc.addEventListener('click', function () {
  const empty = els.defaultCcRecipients.querySelector('.empty-hint');
  if (empty) empty.remove();
  els.defaultCcRecipients.appendChild(makeDefaultCcRow({}));
  scheduleDefaultCcPersist();
});

els.test.addEventListener('click', function () {
  const useStub = els.useStub.checked;
  const provider = els.provider.value;
  const activeKey = provider === 'azure-deepseek'
    ? els.azureApiKey.value.trim()
    : els.apiKey.value.trim();

  if (useStub) {
    setStatus(els.status, '目前為測試模式，不會呼叫真實 AI（請先取消勾選再測試）。', 'err');
    return;
  }
  if (provider === 'azure-deepseek' && !els.azureEndpoint.value.trim()) {
    setStatus(els.status, '請先填入 Azure Endpoint。', 'err');
    return;
  }
  if (provider === 'azure-deepseek' && !els.azureDeployment.value.trim()) {
    setStatus(els.status, '請先填入 Azure Deployment Name。', 'err');
    return;
  }
  if (!activeKey) {
    setStatus(els.status, '請先填入 API Key。', 'err');
    return;
  }

  els.test.disabled = true;
  setStatus(els.status, '測試中…（已自動儲存目前設定）', 'busy');

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
        const detail = res.provider === 'azure-deepseek'
          ? 'Azure DeepSeek（' + (res.deployment || '') + '）'
          : '模型 ' + (res.model || '');
        setStatus(els.status, '連線成功 ✓ ' + detail + ' 可正常呼叫。', 'ok');
      } else {
        setStatus(els.status, '連線失敗：' + (res.error || '未知錯誤'), 'err');
      }
    })
    .finally(function () {
      els.test.disabled = false;
    });
});

load();
