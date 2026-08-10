/**
 * options.js（設定頁，extension 頁面環境）
 *
 * 職責：讀 / 寫設定到 chrome.storage.local。包含：
 *  - Gemini API 設定（apiKey / model / useStub）與「測試連線」。
 *  - 聯絡人名單（contactGroups）：寄信 CC 快速加入用的群組與成員。
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

const DEFAULTS = {
  provider: 'azure-deepseek',
  azureEndpoint: '',
  azureDeployment: '',
  azureApiKey: '',
  apiKey: '',
  model: 'gemini-2.5-flash',
  useStub: false,
  theme: 'cute-ios',
  accent: '#3a82f7',
  opacity: 100,
};

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
  save: $('save'),
  test: $('test'),
  status: $('status'),
  groups: $('groups'),
  addGroup: $('addGroup'),
  saveGroups: $('saveGroups'),
  groupsStatus: $('groupsStatus'),
  theme: $('theme'),
  themeStatus: $('themeStatus'),
  accentRow: $('accentRow'),
  opacity: $('opacity'),
  opacityValue: $('opacityValue'),
  saveAppearance: $('saveAppearance'),
};

function setStatus(node, text, kind) {
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
  });

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
  });
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
  const on = els.accentRow.querySelector('.swatch.active');
  return (on && on.getAttribute('data-accent')) || DEFAULTS.accent;
}

function currentOpacity() {
  const v = parseInt(els.opacity.value, 10);
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
    // contactGroups 不在這裡：由 persistGroups() 獨立寫入。
    // 若放在這裡，theme/accent 自動儲存或「測試連線」在 load() 完成前觸發時，
    // 會以空 DOM（[]）覆蓋已存在的 contactGroups。
  };
}

/** 設定頁本身即時套用 theme / accent / opacity（即時預覽）。 */
function applyAppearance() {
  const root = document.documentElement;
  root.setAttribute('data-hpx-theme', els.theme.value || 'cute-ios');
  root.style.setProperty('--hpx-accent', activeAccent());
  const frac = (currentOpacity() / 100).toFixed(2);
  root.style.setProperty('--hpx-opacity', frac);
  root.style.setProperty('--hpx-glass-opacity', frac);
  els.opacityValue.textContent = currentOpacity() + '%';
}

/** 寫入 AI 設定＋外觀（不含 contactGroups，避免覆蓋名單）。 */
function persist() {
  const next = collectSettings();
  return new Promise(function (resolve) {
    chrome.storage.local.get(SETTINGS_KEY, function (data) {
      const prev = (data && data[SETTINGS_KEY]) || {};
      const merged = Object.assign({}, prev, next);
      chrome.storage.local.set({ [SETTINGS_KEY]: merged }, function () {
        resolve(merged);
      });
    });
  });
}

/** 只寫入 contactGroups，讀自目前 DOM 狀態。 */
function persistGroups() {
  const groups = readGroupsFromDom();
  return new Promise(function (resolve) {
    chrome.storage.local.get(SETTINGS_KEY, function (data) {
      const prev = (data && data[SETTINGS_KEY]) || {};
      const merged = Object.assign({}, prev, { [GROUPS_FIELD]: groups });
      chrome.storage.local.set({ [SETTINGS_KEY]: merged }, function () {
        resolve(merged);
      });
    });
  });
}

function applyProviderSections(provider) {
  const isAzure = provider === 'azure-deepseek';
  els.azureSection.style.display = isAzure ? '' : 'none';
  els.geminiSection.style.display = isAzure ? 'none' : '';
}

function load() {
  chrome.storage.local.get(SETTINGS_KEY, function (data) {
    const s = (data && data[SETTINGS_KEY]) || {};
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
    const accent = s.accent || DEFAULTS.accent;
    els.accentRow.querySelectorAll('.swatch').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-accent') === accent);
    });
    els.opacity.value = typeof s.opacity === 'number' ? s.opacity : DEFAULTS.opacity;
    applyAppearance();

    const groups = Array.isArray(s[GROUPS_FIELD]) && s[GROUPS_FIELD].length
      ? s[GROUPS_FIELD]
      : DEFAULT_GROUPS;
    renderGroups(groups);
  });
}

// ── 事件 ───────────────────────────────────────────────────

els.provider.addEventListener('change', function () {
  applyProviderSections(els.provider.value);
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

els.save.addEventListener('click', function () {
  persist().then(persistGroups).then(function () {
    setStatus(els.status, '已儲存 ✓', 'ok');
  });
});

els.addGroup.addEventListener('click', function () {
  const groups = readGroupsFromDom();
  groups.push({ name: '', members: [{ name: '', email: '' }] });
  renderGroups(groups);
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
  applyAppearance();
  persist().then(function () {
    setStatus(els.themeStatus, '已套用 Accent ✓', 'ok');
  });
});

els.opacity.addEventListener('input', applyAppearance); // 拖動即時預覽
els.opacity.addEventListener('change', function () {
  persist().then(function () {
    setStatus(els.themeStatus, '已套用透明度 ✓', 'ok');
  });
});

els.saveAppearance.addEventListener('click', function () {
  persist().then(function () {
    setStatus(els.themeStatus, '已儲存外觀設定 ✓ 開啟中的 HaloPSA 即時生效。', 'ok');
  });
});

els.saveGroups.addEventListener('click', function () {
  persistGroups().then(function (merged) {
    const n = (merged[GROUPS_FIELD] || []).length;
    setStatus(els.groupsStatus, '名單已儲存 ✓（共 ' + n + ' 個群組）寄信視窗會自動套用。', 'ok');
  });
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
  els.save.disabled = true;
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
      els.save.disabled = false;
    });
});

load();
