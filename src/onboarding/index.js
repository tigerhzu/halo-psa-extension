/** First-login setup hint. All writes merge into chrome.storage.local.hpx_settings. */
(function () {
  'use strict';
  const NS = window.__HPX;
  const SETTINGS_KEY = 'hpx_settings';
  const VERSION_FIELD = 'onboardingVersion';
  const CURRENT_VERSION = 1;
  const TEAMS_FIELD = 'ultimateTeams';
  const DEFAULT_CC_FIELD = 'defaultCcRecipients';
  const cfg = NS.config.selectors.ULTIMATE_MODE;
  let currentSettings = {};
  let currentStep = 0;
  let overlay = null;
  let standalonePage = false;
  let openRequestSent = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function mergeSettings(patch) {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get(SETTINGS_KEY, function (data) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        const previous = (data && data[SETTINGS_KEY]) || {};
        const merged = Object.assign({}, previous, patch);
        chrome.storage.local.set({ [SETTINGS_KEY]: merged }, function () {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else {
            currentSettings = merged;
            resolve(merged);
          }
        });
      });
    });
  }

  function selectedTeams() {
    const teams = [];
    overlay.querySelectorAll('[data-onboarding-team]:checked').forEach(function (input) {
      const preset = cfg.TEAM_PRESETS.find(function (item) { return item.id === input.value; });
      if (preset) preset.teams.forEach(function (team) { if (!teams.includes(team)) teams.push(team); });
    });
    const presetTeams = cfg.TEAM_PRESETS.reduce(function (all, preset) { return all.concat(preset.teams); }, []);
    (Array.isArray(currentSettings[TEAMS_FIELD]) ? currentSettings[TEAMS_FIELD] : []).forEach(function (team) {
      if (!presetTeams.includes(team) && !teams.includes(team)) teams.push(team);
    });
    return teams;
  }

  function ccRecipients() {
    const recipients = [];
    overlay.querySelectorAll('.hpx-onboarding-cc-row').forEach(function (row) {
      const name = row.querySelector('[data-cc-name]').value.trim();
      const email = row.querySelector('[data-cc-email]').value.trim();
      if (email && email.indexOf('@') > 0) recipients.push({ name: name, email: email });
    });
    return recipients;
  }

  function mergeTeamCatalog(value) {
    const teams = [];
    const seen = new Set();
    const append = function (team) {
      const label = String(team || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const key = label.toLocaleLowerCase();
      if (!label || seen.has(key) || teams.length >= 20) return;
      seen.add(key);
      teams.push(label);
    };
    (Array.isArray(value) ? value : cfg.DEFAULT_TEAM_ITEMS).forEach(append);
    cfg.TEAM_PRESETS.forEach(function (preset) { preset.teams.forEach(append); });
    return teams;
  }

  function ensureTeamCatalog(settings) {
    const source = settings || {};
    if (Number(source[cfg.TEAM_CATALOG_VERSION_FIELD] || 0) >= cfg.TEAM_CATALOG_VERSION) {
      return Promise.resolve(source);
    }
    return mergeSettings({
      [TEAMS_FIELD]: mergeTeamCatalog(source[TEAMS_FIELD]),
      [cfg.TEAM_CATALOG_VERSION_FIELD]: cfg.TEAM_CATALOG_VERSION,
    });
  }

  function stepPatch(index) {
    if (index === 0) return { [TEAMS_FIELD]: selectedTeams() };
    if (index === 1) {
      const provider = overlay.querySelector('[data-api-provider]').value;
      if (provider === 'gemini') {
        return {
          provider: provider,
          apiKey: overlay.querySelector('[data-gemini-key]').value.trim(),
          model: overlay.querySelector('[data-gemini-model]').value.trim() || 'gemini-2.5-flash',
        };
      }
      return {
        provider: provider,
        azureEndpoint: overlay.querySelector('[data-azure-endpoint]').value.trim().replace(/\/+$/, ''),
        azureDeployment: overlay.querySelector('[data-azure-deployment]').value.trim(),
        azureApiKey: overlay.querySelector('[data-azure-key]').value.trim(),
      };
    }
    if (index === 2) return { [DEFAULT_CC_FIELD]: ccRecipients() };
    return {};
  }

  function finish() {
    const patch = Object.assign({}, stepPatch(currentStep), { [VERSION_FIELD]: CURRENT_VERSION });
    mergeSettings(patch).then(close).catch(showError);
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.documentElement.classList.remove('hpx-onboarding-open');
    document.documentElement.classList.remove('hpx-onboarding-page');
    if (standalonePage) {
      const complete = el('main', 'hpx-onboarding-complete');
      complete.appendChild(el('h1', '', '首次登入提示已完成'));
      complete.appendChild(el('p', '', '之後可從 Extension 的「設定」重新開啟此頁面。'));
      const status = el('p', 'hpx-onboarding-complete-status');
      const settings = el('button', 'hpx-onboarding-primary', '開啟完整設定');
      settings.type = 'button';
      settings.addEventListener('click', function () {
        chrome.runtime.sendMessage({ type: 'HPX_OPEN_OPTIONS' });
      });
      const home = el('button', 'hpx-onboarding-secondary', '回到 HaloPSA 主頁');
      home.type = 'button';
      home.addEventListener('click', function () {
        home.disabled = true;
        chrome.runtime.sendMessage({ type: 'HPX_OPEN_HALOPSA_HOME' }, function (response) {
          const lastError = chrome.runtime.lastError;
          if (lastError || !response || response.ok === false) {
            home.disabled = false;
            status.textContent = (response && response.error) || '找不到可返回的 HaloPSA 分頁，請從 HaloPSA 重新整理。';
          }
        });
      });
      const actions = el('div', 'hpx-onboarding-complete-actions');
      actions.appendChild(settings);
      actions.appendChild(home);
      complete.appendChild(status);
      complete.appendChild(actions);
      document.body.appendChild(complete);
    }
    standalonePage = false;
  }

  function showError(error) {
    const status = overlay && overlay.querySelector('.hpx-onboarding-status');
    if (status) status.textContent = '無法儲存設定：' + ((error && error.message) || '未知錯誤');
  }

  function showStep(index) {
    currentStep = Math.max(0, Math.min(2, index));
    overlay.querySelectorAll('.hpx-onboarding-step').forEach(function (step, stepIndex) {
      step.hidden = stepIndex !== currentStep;
    });
    overlay.querySelectorAll('.hpx-onboarding-dot').forEach(function (dot, dotIndex) {
      dot.classList.toggle('is-active', dotIndex === currentStep);
      dot.classList.toggle('is-done', dotIndex < currentStep);
    });
    overlay.querySelector('[data-back]').hidden = currentStep === 0;
    overlay.querySelector('[data-next]').textContent = currentStep === 2 ? '完成設定' : '儲存並繼續';
    overlay.querySelector('[data-skip]').textContent = currentStep === 2 ? '略過並完成' : '略過這一步';
    const provider = overlay.querySelector('[data-api-provider]');
    if (provider) provider.dispatchEvent(new Event('change'));
  }

  function teamStep() {
    const section = el('section', 'hpx-onboarding-step');
    section.appendChild(el('h2', '', '1. 你的團隊？'));
    section.appendChild(el('p', 'hpx-onboarding-hint', '只保留你選擇的 Team；之後可在設定中自由新增或刪除。'));
    const chosen = Array.isArray(currentSettings[TEAMS_FIELD])
      ? currentSettings[TEAMS_FIELD]
      : cfg.DEFAULT_TEAM_ITEMS;
    const grid = el('div', 'hpx-onboarding-team-grid');
    cfg.TEAM_PRESETS.forEach(function (preset) {
      const label = el('label', 'hpx-onboarding-choice');
      const input = el('input');
      input.type = 'checkbox';
      input.value = preset.id;
      input.setAttribute('data-onboarding-team', '1');
      input.checked = preset.teams.every(function (team) { return chosen.includes(team); });
      label.appendChild(input);
      label.appendChild(el('span', '', preset.label));
      grid.appendChild(label);
    });
    section.appendChild(grid);
    return section;
  }

  function apiStep() {
    const section = el('section', 'hpx-onboarding-step');
    section.appendChild(el('h2', '', '2. 設定 AI API'));
    section.appendChild(el('p', 'hpx-onboarding-hint', '沒有 API Key 可以先略過，之後再到 Extension 設定補上。金鑰只儲存在本機瀏覽器。'));
    const provider = el('select');
    provider.setAttribute('data-api-provider', '1');
    [['azure-deepseek', 'Azure OpenAI'], ['gemini', 'Google Gemini']].forEach(function (item) {
      const option = el('option', '', item[1]); option.value = item[0]; provider.appendChild(option);
    });
    provider.value = currentSettings.provider || 'azure-deepseek';
    section.appendChild(el('label', '', 'AI Provider'));
    section.appendChild(provider);

    const azure = el('div', 'hpx-onboarding-provider'); azure.setAttribute('data-azure-fields', '1');
    [['Endpoint', 'data-azure-endpoint', currentSettings.azureEndpoint || '', 'text'], ['Deployment Name', 'data-azure-deployment', currentSettings.azureDeployment || '', 'text'], ['API Key', 'data-azure-key', currentSettings.azureApiKey || '', 'password']].forEach(function (field) {
      azure.appendChild(el('label', '', field[0]));
      const input = el('input'); input.type = field[3]; input.value = field[2]; input.autocomplete = 'off'; input.setAttribute(field[1], '1'); azure.appendChild(input);
    });
    section.appendChild(azure);

    const gemini = el('div', 'hpx-onboarding-provider'); gemini.setAttribute('data-gemini-fields', '1');
    gemini.appendChild(el('label', '', 'Gemini API Key'));
    const key = el('input'); key.type = 'password'; key.value = currentSettings.apiKey || ''; key.autocomplete = 'off'; key.setAttribute('data-gemini-key', '1'); gemini.appendChild(key);
    gemini.appendChild(el('label', '', 'Model'));
    const model = el('input'); model.type = 'text'; model.value = currentSettings.model || 'gemini-2.5-flash'; model.setAttribute('data-gemini-model', '1'); gemini.appendChild(model);
    section.appendChild(gemini);
    provider.addEventListener('change', function () {
      azure.hidden = provider.value !== 'azure-deepseek';
      gemini.hidden = provider.value !== 'gemini';
    });
    return section;
  }

  function addCcRow(container, recipient) {
    const row = el('div', 'hpx-onboarding-cc-row');
    const name = el('input'); name.type = 'text'; name.placeholder = '姓名（選填）'; name.value = (recipient && recipient.name) || ''; name.setAttribute('data-cc-name', '1');
    const email = el('input'); email.type = 'email'; email.placeholder = 'name@example.com'; email.value = (recipient && recipient.email) || ''; email.setAttribute('data-cc-email', '1');
    const remove = el('button', 'hpx-onboarding-remove', '移除'); remove.type = 'button'; remove.addEventListener('click', function () { row.remove(); });
    row.appendChild(name); row.appendChild(email); row.appendChild(remove); container.appendChild(row);
  }

  function ccStep() {
    const section = el('section', 'hpx-onboarding-step');
    section.appendChild(el('h2', '', '3. 永遠 CC 收件人'));
    section.appendChild(el('p', 'hpx-onboarding-hint', '所有文件自動cc。'));
    const rows = el('div', 'hpx-onboarding-cc-rows'); rows.setAttribute('data-cc-rows', '1');
    const recipients = Array.isArray(currentSettings[DEFAULT_CC_FIELD]) ? currentSettings[DEFAULT_CC_FIELD] : [];
    (recipients.length ? recipients : [{}]).forEach(function (recipient) { addCcRow(rows, recipient); });
    section.appendChild(rows);
    const add = el('button', 'hpx-onboarding-add', '＋ 新增 CC 收件人'); add.type = 'button'; add.addEventListener('click', function () { addCcRow(rows, {}); }); section.appendChild(add);
    return section;
  }

  function render(options) {
    if (overlay) return;
    standalonePage = !!(options && options.page);
    overlay = el('div', 'hpx-onboarding-overlay');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'hpx-onboarding-title');
    const modal = el('div', 'hpx-onboarding-modal');
    const closeButton = el('button', 'hpx-onboarding-close', '×'); closeButton.type = 'button'; closeButton.title = '略過首次登入提示'; closeButton.addEventListener('click', finish);
    const title = el('h1', '', '首次登入提示'); title.id = 'hpx-onboarding-title';
    modal.appendChild(closeButton); modal.appendChild(title);
    modal.appendChild(el('p', 'hpx-onboarding-intro', '用三個簡短步驟完成基本設定；每一步都可以略過。'));
    const dots = el('div', 'hpx-onboarding-progress');
    ['團隊', 'API', '永遠 CC'].forEach(function (label) { const dot = el('span', 'hpx-onboarding-dot', label); dots.appendChild(dot); });
    modal.appendChild(dots); modal.appendChild(teamStep()); modal.appendChild(apiStep()); modal.appendChild(ccStep());
    modal.appendChild(el('p', 'hpx-onboarding-status'));
    const actions = el('div', 'hpx-onboarding-actions');
    const back = el('button', '', '上一步'); back.type = 'button'; back.setAttribute('data-back', '1'); back.addEventListener('click', function () { showStep(currentStep - 1); });
    const skip = el('button', '', '略過這一步'); skip.type = 'button'; skip.setAttribute('data-skip', '1'); skip.addEventListener('click', function () { if (currentStep === 2) finish(); else showStep(currentStep + 1); });
    const next = el('button', 'hpx-onboarding-primary', '儲存並繼續'); next.type = 'button'; next.setAttribute('data-next', '1'); next.addEventListener('click', function () { mergeSettings(stepPatch(currentStep)).then(function () { if (currentStep === 2) finish(); else showStep(currentStep + 1); }).catch(showError); });
    actions.appendChild(back); actions.appendChild(skip); actions.appendChild(next); modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.documentElement.classList.add('hpx-onboarding-open');
    if (standalonePage) document.documentElement.classList.add('hpx-onboarding-page');
    showStep(0);
    closeButton.focus();
  }

  function requestStandalonePage() {
    if (openRequestSent) return;
    openRequestSent = true;
    try {
      chrome.runtime.sendMessage({ type: 'HPX_OPEN_ONBOARDING', sourceUrl: window.location.href }, function (response) {
        if (chrome.runtime.lastError || !response || response.ok === false) {
          openRequestSent = false;
          render();
        }
      });
    } catch (error) {
      openRequestSent = false;
      render();
    }
  }

  function start(options) {
    options = options || {};
    chrome.storage.local.get(SETTINGS_KEY, function (data) {
      const loaded = (data && data[SETTINGS_KEY]) || {};
      ensureTeamCatalog(loaded).catch(function () { return loaded; }).then(function (settings) {
        currentSettings = settings;
        if (!(options && options.force) && Number(currentSettings[VERSION_FIELD] || 0) >= CURRENT_VERSION) return;
        if (options.page) render({ page: true });
        else requestStandalonePage();
      });
    });
  }

  NS.ui.onboarding = { start: start, open: function () { start({ force: true }); }, close: close, _stepPatch: stepPatch };
})();
