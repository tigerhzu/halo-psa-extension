/** First-login setup hint. All writes merge into chrome.storage.local.hpx_settings. */
(function () {
  'use strict';
  const NS = window.__HPX;
  const SETTINGS_KEY = 'hpx_settings';
  const VERSION_FIELD = 'onboardingVersion';
  const CURRENT_VERSION = 18;
  const STEP_COUNT = 5;
  const LAST_STEP = STEP_COUNT - 1;
  const TEAMS_FIELD = 'ultimateTeams';
  const DEFAULT_CC_FIELD = 'defaultCcRecipients';
  const AI_SETTINGS = window.HPX_AI_SETTINGS;
  const PROVIDERS = AI_SETTINGS.PROVIDERS;
  const DEFAULT_ONBOARDING_TEAMS = ['Op Team A', 'Op Team B', 'Op Team C'];
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

  function createTigerAvatar(className) {
    const avatar = el('span', className, 'HC');
    avatar.setAttribute('aria-hidden', 'true');
    return avatar;
  }

  function applyAppearance(node) {
    const saved = String(currentSettings.accent || '').trim();
    const accent = /^#[0-9a-f]{6}$/i.test(saved) ? saved : '#0c2d55';
    const rgb = [1, 3, 5].map(function (offset) {
      const channel = parseInt(accent.slice(offset, offset + 2), 16) / 255;
      return channel <= .04045 ? channel / 12.92 : Math.pow((channel + .055) / 1.055, 2.4);
    });
    const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    node.style.setProperty('--ob-accent', accent);
    node.style.setProperty('--ob-accent-ink', luminance > .179 ? '#000000' : '#ffffff');
  }

  function openOptionsPage() {
    try {
      chrome.runtime.sendMessage({ type: 'HPX_OPEN_OPTIONS' }, function (response) {
        const lastError = chrome.runtime.lastError;
        if (lastError || !response || response.ok === false) {
          try { window.open(chrome.runtime.getURL('src/options/options.html'), '_blank'); } catch (error) { /* best effort fallback */ }
        }
      });
    } catch (error) {
      try { window.open(chrome.runtime.getURL('src/options/options.html'), '_blank'); } catch (fallbackError) { /* best effort fallback */ }
    }
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
        try {
          if (Object.prototype.hasOwnProperty.call(patch, 'provider')) AI_SETTINGS.validateExclusive(merged);
        } catch (error) {
          reject(error);
          return;
        }
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

  function isDefaultTeamCatalog(value) {
    return Array.isArray(value)
      && value.length === cfg.DEFAULT_TEAM_ITEMS.length
      && cfg.DEFAULT_TEAM_ITEMS.every(function (team, index) { return value[index] === team; });
  }

  function ensureTeamCatalog(settings) {
    const source = settings || {};
    if (Number(source[cfg.TEAM_CATALOG_VERSION_FIELD] || 0) >= cfg.TEAM_CATALOG_VERSION) {
      return Promise.resolve(source);
    }
    const existingTeams = Array.isArray(source[TEAMS_FIELD]) ? source[TEAMS_FIELD] : null;
    return mergeSettings({
      [TEAMS_FIELD]: existingTeams ? mergeTeamCatalog(existingTeams) : DEFAULT_ONBOARDING_TEAMS.slice(),
      [cfg.TEAM_CATALOG_VERSION_FIELD]: cfg.TEAM_CATALOG_VERSION,
    });
  }

  function stepPatch(index) {
    if (index === 0) return { [TEAMS_FIELD]: selectedTeams() };
    if (index === 1) {
      const selected = overlay.querySelector('[data-api-provider]:checked');
      const provider = selected ? selected.value : '';
      if (provider === PROVIDERS.ORNITH) {
        return {
          provider: provider,
          ornithBaseUrl: overlay.querySelector('[data-ornith-base-url]').value.trim().replace(/\/+$/, ''),
          ornithModel: overlay.querySelector('[data-ornith-model]').value.trim() || AI_SETTINGS.ORNITH_MODEL,
          ornithApiKey: overlay.querySelector('[data-ornith-key]').value.trim(),
        };
      }
      if (provider !== PROVIDERS.AZURE) return { provider: '' };
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
      applyAppearance(complete);
      complete.appendChild(el('span', 'hpx-onboarding-brand', 'Halopsa'));
      complete.appendChild(el('h1', '', '設定完成'));
      const status = el('p', 'hpx-onboarding-complete-status');
      const settings = el('button', 'hpx-onboarding-primary', '開啟設定');
      settings.type = 'button';
      settings.addEventListener('click', openOptionsPage);
      const home = el('button', 'hpx-onboarding-secondary', '回到 HaloPSA');
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
    currentStep = Math.max(0, Math.min(LAST_STEP, index));
    const modal = overlay.querySelector('.hpx-onboarding-modal');
    if (modal) modal.classList.toggle('hpx-onboarding-modal--guide', currentStep >= 3);
    overlay.querySelectorAll('.hpx-onboarding-step').forEach(function (step, stepIndex) {
      step.hidden = stepIndex !== currentStep;
    });
    overlay.querySelectorAll('.hpx-onboarding-dot').forEach(function (dot, dotIndex) {
      dot.classList.toggle('is-active', dotIndex === currentStep);
      dot.classList.toggle('is-done', dotIndex < currentStep);
      if (dotIndex === currentStep) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });
    overlay.querySelector('[data-back]').hidden = currentStep === 0;
    overlay.querySelector('[data-next]').textContent = currentStep === LAST_STEP ? '完成' : currentStep >= 3 ? '繼續' : '儲存並繼續';
    overlay.querySelector('[data-skip]').textContent = currentStep === LAST_STEP ? '略過並完成' : '略過';
    const provider = overlay.querySelector('[data-api-provider]');
    if (provider) provider.dispatchEvent(new Event('change'));
  }

  function teamStep() {
    const section = el('section', 'hpx-onboarding-step');
    section.appendChild(el('h2', '', '常用 Team'));
    section.appendChild(el('p', 'hpx-onboarding-hint', '選擇簡單模式顯示的 Team。'));
    const storedTeams = Array.isArray(currentSettings[TEAMS_FIELD]) ? currentSettings[TEAMS_FIELD] : null;
    const isFreshOnboarding = !Number(currentSettings[VERSION_FIELD] || 0);
    const chosen = !storedTeams || (isFreshOnboarding && isDefaultTeamCatalog(storedTeams))
      ? DEFAULT_ONBOARDING_TEAMS
      : storedTeams;
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
    section.appendChild(el('h2', '', 'AI 服務'));
    section.appendChild(el('p', 'hpx-onboarding-hint', 'API Key 儲存在本機。'));
    section.appendChild(el('label', '', '選擇服務'));
    const providerChoices = el('div', 'hpx-onboarding-provider-choices');
    const azureConfigured = !!String(currentSettings.azureApiKey || '').trim();
    const ornithConfigured = !!String(currentSettings.ornithApiKey || '').trim();
    const providerConflict = azureConfigured && ornithConfigured;
    const currentProvider = providerConflict ? '' : AI_SETTINGS.resolveProvider(currentSettings);
    const providerInputs = [];
    [[PROVIDERS.ORNITH, 'Local Ornith'], [PROVIDERS.AZURE, 'Azure OpenAI']].forEach(function (item) {
      const choice = el('label', 'hpx-onboarding-choice');
      const input = el('input'); input.type = 'radio'; input.name = 'hpx-onboarding-provider'; input.value = item[0];
      input.checked = currentProvider === item[0]; input.setAttribute('data-api-provider', '1');
      input.disabled = providerConflict || (item[0] === PROVIDERS.ORNITH && azureConfigured) || (item[0] === PROVIDERS.AZURE && ornithConfigured);
      choice.appendChild(input); choice.appendChild(el('span', '', item[1])); providerChoices.appendChild(choice); providerInputs.push(input);
    });
    section.appendChild(providerChoices);
    const lockHint = el('p', 'hpx-onboarding-hint');
    if (providerConflict) lockHint.textContent = '設定衝突：請到完整設定先移除其中一組 API 設定。';
    else if (azureConfigured) lockHint.textContent = 'Azure OpenAI 已設定；請到完整設定先移除 Azure，才能改用 Ornith。';
    else if (ornithConfigured) lockHint.textContent = 'Ornith 已設定；請到完整設定先移除 Ornith，才能改用 Azure。';
    else lockHint.textContent = '';
    section.appendChild(lockHint);

    const ornith = el('div', 'hpx-onboarding-provider'); ornith.setAttribute('data-ornith-fields', '1');
    [['Base URL', 'data-ornith-base-url', currentSettings.ornithBaseUrl || AI_SETTINGS.ORNITH_BASE_URL, 'text'], ['Model', 'data-ornith-model', currentSettings.ornithModel || AI_SETTINGS.ORNITH_MODEL, 'text'], ['API Key', 'data-ornith-key', currentSettings.ornithApiKey || '', 'password']].forEach(function (field) {
      ornith.appendChild(el('label', '', field[0]));
      const input = el('input'); input.type = field[3]; input.value = field[2]; input.autocomplete = 'off'; input.setAttribute(field[1], '1'); input.setAttribute('aria-label', 'Ornith ' + field[0]); ornith.appendChild(input);
    });
    section.appendChild(ornith);

    const azure = el('div', 'hpx-onboarding-provider'); azure.setAttribute('data-azure-fields', '1');
    [['Endpoint', 'data-azure-endpoint', currentSettings.azureEndpoint || '', 'text'], ['Deployment Name', 'data-azure-deployment', currentSettings.azureDeployment || '', 'text'], ['API Key', 'data-azure-key', currentSettings.azureApiKey || '', 'password']].forEach(function (field) {
      azure.appendChild(el('label', '', field[0]));
      const input = el('input'); input.type = field[3]; input.value = field[2]; input.autocomplete = 'off'; input.setAttribute(field[1], '1'); input.setAttribute('aria-label', 'Azure ' + field[0]); azure.appendChild(input);
    });
    section.appendChild(azure);
    function applyProviderUi() {
      const selected = providerInputs.find(function (input) { return input.checked; });
      const provider = selected ? selected.value : '';
      [[ornith, PROVIDERS.ORNITH], [azure, PROVIDERS.AZURE]].forEach(function (entry) {
        const enabled = provider === entry[1];
        entry[0].classList.toggle('is-disabled', !enabled);
        entry[0].hidden = !enabled;
        entry[0].querySelectorAll('input').forEach(function (input) { input.disabled = !enabled; });
      });
    }
    providerInputs.forEach(function (input) { input.addEventListener('change', applyProviderUi); });
    applyProviderUi();
    return section;
  }

  function addCcRow(container, recipient) {
    const row = el('div', 'hpx-onboarding-cc-row');
    const name = el('input'); name.type = 'text'; name.placeholder = '姓名（選填）'; name.value = (recipient && recipient.name) || ''; name.setAttribute('data-cc-name', '1'); name.setAttribute('aria-label', 'CC 收件人姓名');
    const email = el('input'); email.type = 'email'; email.placeholder = 'name@example.com'; email.value = (recipient && recipient.email) || ''; email.setAttribute('data-cc-email', '1'); email.setAttribute('aria-label', 'CC 收件人電子郵件');
    const remove = el('button', 'hpx-onboarding-remove', '移除'); remove.type = 'button'; remove.addEventListener('click', function () { row.remove(); });
    row.appendChild(name); row.appendChild(email); row.appendChild(remove); container.appendChild(row);
  }

  function ccStep() {
    const section = el('section', 'hpx-onboarding-step');
    section.appendChild(el('h2', '', '永遠 CC'));
    section.appendChild(el('p', 'hpx-onboarding-hint', '寄信時自動加入這些收件人。'));
    const rows = el('div', 'hpx-onboarding-cc-rows'); rows.setAttribute('data-cc-rows', '1');
    const recipients = Array.isArray(currentSettings[DEFAULT_CC_FIELD]) ? currentSettings[DEFAULT_CC_FIELD] : [];
    (recipients.length ? recipients : [{}]).forEach(function (recipient) { addCcRow(rows, recipient); });
    section.appendChild(rows);
    const add = el('button', 'hpx-onboarding-add', '+ 新增收件人'); add.type = 'button'; add.addEventListener('click', function () { addCcRow(rows, {}); }); section.appendChild(add);
    return section;
  }

  function guideStep() {
    const section = el('section', 'hpx-onboarding-step hpx-onboarding-guide hpx-onboarding-home-guide');
    section.appendChild(el('h2', '', '快捷列'));
    section.appendChild(el('p', 'hpx-onboarding-hint', '移到按鈕上查看功能。'));

    const shortcutItems = [
      ['shortcuts', 'L', '快捷連結', '常用工作網站'],
      ['mode', 'M', '簡單模式', '整理工作介面'],
      ['color', 'A', '主題色', '調整介面色彩'],
      ['pet', 'P', '寵物', '選擇工作夥伴'],
      ['settings', 'S', '設定', '管理所有偏好'],
    ];
    const guidePurposes = {
      shortcuts: '開啟常用連結。',
      mode: '切換簡單模式與完整 HaloPSA 介面。',
      color: '更換 Extension 介面配色。',
      pet: '選擇或關閉陪伴工作的小夥伴。',
      settings: '開啟設定後台。',
    };

    const demo = el('div', 'hpx-onboarding-guide-demo hpx-onboarding-quickbar-demo');
    const sidebar = el('aside', 'hpx-onboarding-guide-sidebar');
    sidebar.setAttribute('aria-label', '快捷列示意');
    sidebar.appendChild(el('div', 'hpx-onboarding-guide-branddot'));
    sidebar.appendChild(el('div', 'hpx-onboarding-guide-side-label', 'HaloPSA'));
    const purpose = el('div', 'hpx-onboarding-guide-purpose');
    purpose.setAttribute('aria-live', 'polite');
    purpose.setAttribute('aria-hidden', 'true');
    const quickbar = el('div', 'hpx-onboarding-guide-quickbar');
    shortcutItems.forEach(function (item) {
      const button = el('button', 'hpx-onboarding-guide-quick-btn');
      button.type = 'button';
      button.setAttribute('data-guide-key', item[0]);
      button.setAttribute('aria-label', item[3]);
      button.appendChild(el('span', 'hpx-onboarding-guide-quick-icon', item[1]));
      button.appendChild(el('strong', '', item[2]));
      button.appendChild(el('small', '', item[3]));
      const showPurpose = function () {
        purpose.textContent = guidePurposes[item[0]];
        purpose.classList.add('is-visible');
        purpose.setAttribute('aria-hidden', 'false');
        const sidebarRect = demo.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const gap = 6;
        const preferredTop = buttonRect.bottom - sidebarRect.top + gap;
        const maxTop = Math.max(8, demo.clientHeight - purpose.offsetHeight - 8);
        const top = preferredTop <= maxTop
          ? preferredTop
          : Math.max(8, buttonRect.top - sidebarRect.top - purpose.offsetHeight - gap);
        purpose.style.top = Math.round(top) + 'px';
        purpose.style.left = Math.round(Math.max(8, Math.min(buttonRect.left - sidebarRect.left, demo.clientWidth - purpose.offsetWidth - 8))) + 'px';
        purpose.classList.toggle('is-above', top < preferredTop);
      };
      const hidePurpose = function () {
        purpose.classList.remove('is-visible');
        purpose.classList.remove('is-above');
        purpose.setAttribute('aria-hidden', 'true');
      };
      button.addEventListener('pointerenter', showPurpose);
      button.addEventListener('pointerleave', hidePurpose);
      button.addEventListener('focus', showPurpose);
      button.addEventListener('blur', hidePurpose);
      quickbar.appendChild(button);
    });
    demo.appendChild(sidebar);

    const homeContent = el('main', 'hpx-onboarding-guide-home-page');
    homeContent.setAttribute('aria-label', 'HaloPSA Home 主頁示意');
    const homeHeader = el('div', 'hpx-onboarding-guide-home-header');
    homeHeader.appendChild(el('strong', '', 'Home'));
    const newTicket = el('button', 'hpx-onboarding-guide-home-ticket', '＋ New Ticket'); newTicket.type = 'button';
    homeHeader.appendChild(newTicket);
    homeContent.appendChild(homeHeader);
    homeContent.appendChild(el('h3', 'hpx-onboarding-guide-home-greeting', '工單概覽'));
    const profile = el('div', 'hpx-onboarding-guide-home-profile');
    const homeAvatar = el('span', 'hpx-onboarding-guide-home-avatar');
    homeAvatar.appendChild(createTigerAvatar('hpx-onboarding-guide-home-avatar-image'));
    profile.appendChild(homeAvatar);
    const profileText = el('div', '');
    profileText.appendChild(el('strong', '', '服務工程師'));
    profileText.appendChild(el('small', '', 'Op. Engineer　● Available'));
    profile.appendChild(profileText);
    homeContent.appendChild(profile);
    homeContent.appendChild(el('label', 'hpx-onboarding-guide-home-period-label', 'Reporting Period'));
    const period = el('div', 'hpx-onboarding-guide-home-period', 'All　⌄');
    homeContent.appendChild(period);
    const stats = el('div', 'hpx-onboarding-guide-home-stats');
    [
      ['本月工單', '60', '#0c2d55', 'bar'],
      ['每週案件', '109', '#7ba4e8', 'line'],
      ['平均回應時間', '27.98', '#a3aac9', 'line'],
      ['案件總量', '223', '#9a94d3', 'bar'],
      ['處理中案件', '198', '#7ba4e8', 'bar'],
      ['平均結案時間', '3.07', '#0c2d55', 'line'],
    ].forEach(function (item) {
      const card = el('article', 'hpx-onboarding-guide-home-stat');
      card.appendChild(el('strong', '', item[0]));
      const chart = el('div', 'hpx-onboarding-guide-home-chart' + (item[3] === 'line' ? ' is-line' : ''));
      chart.style.setProperty('--hpx-chart-color', item[2]);
      chart.appendChild(el('span', '', item[1]));
      if (item[3] === 'line') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 50');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M2 38 C12 22 16 42 25 29 S39 22 46 34 S60 42 67 25 S80 15 98 27');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', item[2]);
        path.setAttribute('stroke-width', '2.4');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
        chart.appendChild(svg);
      }
      card.appendChild(chart);
      stats.appendChild(card);
    });
    homeContent.appendChild(stats);
    demo.appendChild(homeContent);
    demo.appendChild(purpose);
    demo.appendChild(quickbar);
    section.appendChild(demo);
    return section;
  }

  function editorStep() {
    const section = el('section', 'hpx-onboarding-step hpx-onboarding-guide');
    section.appendChild(el('h2', '', '試用編輯器'));
    section.appendChild(el('p', 'hpx-onboarding-guide-instruction', '以下為示範內容，不會修改工單或呼叫 AI。'));

    const demo = el('div', 'hpx-onboarding-guide-demo hpx-onboarding-editor-demo');
    const content = el('main', 'hpx-onboarding-guide-note-page hpx-onboarding-edit-page');
    content.setAttribute('aria-label', 'HaloPSA 編輯頁示意');

    const editHeader = el('div', 'hpx-onboarding-edit-header');
    const editIdentity = el('div', 'hpx-onboarding-edit-identity');
    const editAvatar = el('span', 'hpx-onboarding-edit-avatar');
    editAvatar.appendChild(createTigerAvatar('hpx-onboarding-edit-avatar-image'));
    editIdentity.appendChild(editAvatar);
    const identityText = el('div', '');
    identityText.appendChild(el('strong', '', '示範工單'));
    identityText.appendChild(el('small', '', 'Activity Note'));
    editIdentity.appendChild(identityText);
    editHeader.appendChild(editIdentity);
    const editHeaderActions = el('div', 'hpx-onboarding-edit-header-actions');
    const attachButton = el('button', 'hpx-onboarding-edit-header-button', '⌕'); attachButton.type = 'button';
    const closeEditButton = el('button', 'hpx-onboarding-edit-header-button', '×'); closeEditButton.type = 'button';
    editHeaderActions.appendChild(attachButton);
    editHeaderActions.appendChild(closeEditButton);
    editHeader.appendChild(editHeaderActions);
    content.appendChild(editHeader);

    let adjustedMinutes = 0;
    const timeTaken = el('div', 'hpx-onboarding-edit-time-taken');
    timeTaken.appendChild(el('span', 'hpx-onboarding-edit-field-label', 'Time Taken'));
    const timeFields = el('div', 'hpx-onboarding-edit-time-fields');
    const timeValueNodes = [];
    ['00', '00', '00'].forEach(function (value, index) {
      if (index) timeFields.appendChild(el('span', 'hpx-onboarding-edit-time-separator', ':'));
      const timeValue = el('span', 'hpx-onboarding-edit-time-value', value);
      timeValueNodes.push(timeValue);
      timeFields.appendChild(timeValue);
    });
    timeFields.appendChild(el('span', 'hpx-onboarding-edit-time-clock', '◷'));
    timeTaken.appendChild(timeFields);
    content.appendChild(timeTaken);

    function updateTimeTaken() {
      const totalSeconds = Math.max(0, adjustedMinutes * 60);
      const values = [
        Math.floor(totalSeconds / 3600),
        Math.floor((totalSeconds % 3600) / 60),
        totalSeconds % 60,
      ];
      timeValueNodes.forEach(function (node, index) {
        node.textContent = String(values[index]).padStart(2, '0');
      });
    }

    const timeAdjust = el('div', 'hpx-onboarding-edit-time-adjust');
    const timeAdjustValue = el('strong', '', '目前 0 分鐘');
    timeAdjust.appendChild(timeAdjustValue);
    [['-5 分', '-5'], ['+5 分', '+5'], ['+10 分', '+10'], ['+15 分', '+15'], ['+30 分', '+30'], ['+1 小時', '+60']].forEach(function (item) {
      const button = el('button', 'hpx-onboarding-edit-adjustment-btn', item[0]);
      button.type = 'button'; button.setAttribute('data-time-adjust', item[1]);
      button.addEventListener('click', function () {
        adjustedMinutes = Math.max(0, adjustedMinutes + Number(item[1]));
        timeAdjustValue.textContent = '目前 ' + (adjustedMinutes > 0 ? '+' : '') + adjustedMinutes + ' 分鐘';
        updateTimeTaken();
      });
      timeAdjust.appendChild(button);
    });
    const resetTime = el('button', 'hpx-onboarding-edit-reset', '歸零');
    resetTime.type = 'button';
    resetTime.addEventListener('click', function () {
      adjustedMinutes = 0;
      timeAdjustValue.textContent = '目前 0 分鐘';
      updateTimeTaken();
    });
    timeAdjust.appendChild(resetTime);
    timeAdjust.appendChild(el('span', 'hpx-onboarding-edit-minute-input', '分鐘數'));
    const applyTime = el('button', 'hpx-onboarding-edit-apply-time', '套用'); applyTime.type = 'button';
    timeAdjust.appendChild(applyTime);
    content.appendChild(timeAdjust);
    content.appendChild(el('div', 'hpx-onboarding-edit-field-label hpx-onboarding-edit-note-label', 'note'));

    const noteWrap = el('div', 'hpx-onboarding-note-wrap hpx-onboarding-edit-note-wrap');
    const noteCard = el('article', 'hpx-onboarding-note-card hpx-onboarding-edit-card');
    const testEditor = el('div', 'hpx-onboarding-note-editor');
    const editorToolbar = el('div', 'hpx-onboarding-note-toolbar', 'B　 I　 U　 |　 標題　 清單　 引用　 |　 連結　 表格　 |　 復原　 重做');
    const aiStrip = el('div', 'hpx-onboarding-note-ai-strip');
    const noteStatus = el('span', 'hpx-onboarding-sr-status', '');
    noteStatus.setAttribute('aria-live', 'polite');
    const noteActions = [
      ['edit', '展開編輯', '在獨立工作區整理內容，再套用回原本的編輯器。'],
      ['customer', '回覆客戶', '整理成較有禮貌、格式清楚的客戶用內容。'],
      ['ticket', '工單分析', '整理處理內容、目前結果與下一步。'],
      ['en', '翻譯成英文', '將選取的文字翻譯成英文。'],
      ['zh', '翻譯成中文', '將選取的文字翻譯成中文。'],
      ['template', '快速範本 ▾', '插入常用 Note 格式。'],
    ];
    const actionButtons = {};
    let testTemplateButton = null;
    let testTemplateMenu = null;
    noteActions.forEach(function (item) {
      const button = el('button', 'hpx-onboarding-note-action' + (item[0] === 'edit' ? ' is-edit' : ''), item[1]);
      button.type = 'button';
      button.setAttribute('data-note-action', item[0]);
      button.title = item[2];
      button.appendChild(el('span', 'hpx-onboarding-note-tooltip', item[2]));
      if (item[0] === 'template') {
        const testTemplateWrap = el('div', 'hpx-onboarding-note-template-wrap');
        testTemplateButton = button;
        testTemplateButton.setAttribute('aria-expanded', 'false');
        testTemplateMenu = el('div', 'hpx-onboarding-note-template-menu');
        testTemplateMenu.hidden = true;
        [['followup', '等待客戶回覆'], ['done', '處理完成'], ['onsite', '現場／遠端檢查']].forEach(function (optionData) {
          const option = el('button', 'hpx-onboarding-note-template-option', optionData[1]);
          option.type = 'button'; option.setAttribute('data-note-test-template', optionData[0]);
          testTemplateMenu.appendChild(option);
        });
        testTemplateWrap.appendChild(button);
        testTemplateWrap.appendChild(testTemplateMenu);
        aiStrip.appendChild(testTemplateWrap);
      } else {
        aiStrip.appendChild(button);
      }
      actionButtons[item[0]] = button;
    });
    aiStrip.insertBefore(el('span', 'hpx-onboarding-note-ai-label', '寫作助手'), actionButtons.customer);
    testEditor.appendChild(editorToolbar);
    testEditor.appendChild(aiStrip);
    const testBody = el('div', 'hpx-onboarding-note-body', '已確認機房網路正常。重新啟動交換器後連線恢復，已請客戶持續觀察。');
    testBody.setAttribute('contenteditable', 'true');
    testBody.setAttribute('aria-label', '編輯頁內容');
    testEditor.appendChild(testBody);
    noteCard.appendChild(testEditor);
    noteWrap.appendChild(noteCard);
    content.appendChild(noteWrap);
    const jobCode = el('div', 'hpx-onboarding-edit-job-code');
    jobCode.appendChild(el('span', 'hpx-onboarding-edit-field-label', 'Job Code'));
    const jobCodeSelect = el('div', 'hpx-onboarding-edit-job-code-select');
    jobCodeSelect.appendChild(el('span', 'hpx-onboarding-edit-job-code-placeholder', 'Start typing JobCode'));
    const jobCodeChip = el('span', 'hpx-onboarding-edit-job-code-chip', 'Tiger 月維護');
    jobCodeChip.appendChild(el('b', '', '×'));
    jobCodeSelect.appendChild(jobCodeChip);
    jobCodeSelect.appendChild(el('span', 'hpx-onboarding-edit-job-code-arrow', '⌄'));
    jobCode.appendChild(jobCodeSelect);
    content.appendChild(jobCode);
    const editFooter = el('div', 'hpx-onboarding-edit-footer');
    const saveEditButton = el('button', 'hpx-onboarding-edit-footer-save', 'Save'); saveEditButton.type = 'button';
    const discardEditButton = el('button', 'hpx-onboarding-edit-footer-discard', 'Discard'); discardEditButton.type = 'button';
    const previewEditButton = el('button', 'hpx-onboarding-edit-footer-preview', '◉'); previewEditButton.type = 'button'; previewEditButton.title = '預覽示意';
    editFooter.appendChild(saveEditButton);
    editFooter.appendChild(discardEditButton);
    editFooter.appendChild(previewEditButton);
    content.appendChild(editFooter);
    content.appendChild(noteStatus);
    demo.appendChild(content);

    const modalBackdrop = el('div', 'hpx-onboarding-note-modal-backdrop');
    modalBackdrop.setAttribute('aria-hidden', 'true');
    const noteModal = el('div', 'hpx-onboarding-note-modal');
    noteModal.setAttribute('role', 'dialog');
    noteModal.setAttribute('aria-modal', 'true');
    noteModal.setAttribute('aria-labelledby', 'hpx-onboarding-note-modal-title');
    const modalTitlebar = el('div', 'hpx-onboarding-note-modal-titlebar');
    modalTitlebar.appendChild(el('strong', '', 'Halopsa · 示範工作區'));
    const modalClose = el('button', 'hpx-onboarding-note-modal-close', '×');
    modalClose.type = 'button'; modalClose.title = '關閉編輯頁面'; modalClose.setAttribute('aria-label', '關閉編輯頁面');
    modalTitlebar.appendChild(modalClose); noteModal.appendChild(modalTitlebar);
    const modalHead = el('div', 'hpx-onboarding-note-modal-head');
    const modalHeading = el('h3', '', 'Ticket 641844'); modalHeading.id = 'hpx-onboarding-note-modal-title';
    modalHead.appendChild(modalHeading);
    modalHead.appendChild(el('p', '', '套用後仍需在 HaloPSA 儲存。'));
    noteModal.appendChild(modalHead);

    const formatToolbar = el('div', 'hpx-onboarding-note-modal-toolbar');
    [['bold', 'B'], ['italic', 'I'], ['insertOrderedList', '1.'], ['insertUnorderedList', '•'], ['formatBlock', '❝'], ['undo', '↶'], ['redo', '↷']].forEach(function (item) {
      const button = el('button', 'hpx-onboarding-note-format', item[1]);
      button.type = 'button'; button.title = item[0]; button.setAttribute('data-note-format', item[0]);
      formatToolbar.appendChild(button);
    });
    noteModal.appendChild(formatToolbar);

    const modalAi = el('div', 'hpx-onboarding-note-modal-ai');
    modalAi.appendChild(el('span', 'hpx-onboarding-note-modal-ai-label', '寫作助手 · 示範輸出'));
    const modalEditor = el('div', 'hpx-onboarding-note-modal-editor');
    modalEditor.setAttribute('contenteditable', 'true'); modalEditor.setAttribute('spellcheck', 'false');
    modalEditor.setAttribute('aria-label', 'Note 編輯頁面內容');
    modalEditor.innerHTML = '<p>已確認機房網路正常。</p><p>重新啟動交換器後連線恢復。</p><p>已請客戶持續觀察，如再次發生請回覆工單。</p>';
    const modalNotice = el('div', 'hpx-onboarding-note-modal-notice', '');
    const modalPresetLabels = {
      customer: '回覆客戶', ticket: '工單分析', en: '翻譯成英文', zh: '翻譯成中文',
      followup: '等待客戶回覆', done: '處理完成', onsite: '現場／遠端檢查',
    };
    const modalPresets = {
      customer: '<p>您好，</p><p>我們已完成本次機房檢查，目前網路連線正常。</p><p>重新啟動交換器後連線已恢復，建議持續觀察；若問題再次發生，歡迎直接回覆此工單。</p><p>謝謝。</p>',
      ticket: '<p><strong>處理內容</strong></p><ul><li>確認機房網路狀態正常。</li><li>重新啟動交換器。</li><li>連線已恢復。</li></ul><p><strong>下一步</strong></p><p>請持續觀察，如再次發生再確認設備 Log。</p>',
      en: '<p><strong>Work Performed</strong></p><ul><li>Verified that the server room network was operating normally.</li><li>Restarted the network switch.</li><li>Connectivity was restored.</li></ul><p><strong>Next Step</strong></p><p>Please continue monitoring and review the switch logs if the issue occurs again.</p>',
      zh: '<p><strong>處理內容</strong></p><ul><li>確認機房網路正常。</li><li>已重新啟動交換器。</li><li>連線目前已恢復。</li></ul><p><strong>後續</strong></p><p>請持續觀察，如再次發生再進一步檢查設備紀錄。</p>',
      followup: '<p>您好，目前已完成初步檢查，尚需要您協助確認以下資訊：</p><ul><li>問題目前是否仍會發生</li><li>發生時間</li><li>錯誤畫面或訊息</li></ul><p>收到資訊後我們會再繼續協助，謝謝。</p>',
      done: '<p><strong>處理完成</strong></p><ul><li>問題已確認並完成處理。</li><li>目前服務運作正常。</li></ul><p>若後續仍有異常，請直接回覆此工單。</p>',
      onsite: '<p><strong>檢查內容</strong></p><ul><li>確認設備連線與電源狀態。</li><li>檢查網路與服務是否正常。</li><li>完成基本功能測試。</li></ul><p><strong>結果：</strong>目前狀態正常。</p>',
    };
    ['customer', 'ticket', 'en', 'zh'].forEach(function (key) {
      const label = modalPresetLabels[key];
      const button = el('button', 'hpx-onboarding-note-modal-pill', label);
      button.type = 'button'; button.setAttribute('data-note-preset', key); button.title = '在編輯頁面示範「' + label + '」';
      modalAi.appendChild(button);
    });
    const templateWrap = el('div', 'hpx-onboarding-note-template-wrap');
    const templateButton = el('button', 'hpx-onboarding-note-modal-pill', '快速範本 ▾');
    templateButton.type = 'button'; templateButton.title = '開啟多個快速範本'; templateButton.setAttribute('aria-expanded', 'false');
    const templateMenu = el('div', 'hpx-onboarding-note-template-menu');
    templateMenu.hidden = true;
    ['followup', 'done', 'onsite'].forEach(function (key) {
      const option = el('button', 'hpx-onboarding-note-template-option', modalPresetLabels[key]);
      option.type = 'button'; option.setAttribute('data-note-template', key);
      templateMenu.appendChild(option);
    });
    templateButton.addEventListener('click', function (event) {
      event.stopPropagation();
      setTemplateMenuOpen(templateMenu.hidden);
    });
    templateWrap.appendChild(templateButton);
    templateWrap.appendChild(templateMenu);
    modalAi.appendChild(templateWrap);
    noteModal.appendChild(modalAi);
    noteModal.appendChild(modalNotice);
    noteModal.appendChild(modalEditor);
    const modalActions = el('div', 'hpx-onboarding-note-modal-actions');
    const modalCancel = el('button', 'hpx-onboarding-note-modal-button', '取消'); modalCancel.type = 'button';
    const modalApply = el('button', 'hpx-onboarding-note-modal-button is-primary', '套用回編輯頁'); modalApply.type = 'button';
    modalActions.appendChild(modalCancel); modalActions.appendChild(modalApply); noteModal.appendChild(modalActions);
    modalBackdrop.appendChild(noteModal);
    section.appendChild(demo);
    section.appendChild(modalBackdrop);

    function closeEditor() {
      modalBackdrop.classList.remove('is-open');
      modalBackdrop.setAttribute('aria-hidden', 'true');
      setTemplateMenuOpen(false);
      actionButtons.edit.focus();
    }
    function openEditor() {
      modalEditor.innerHTML = testBody.innerHTML;
      modalNotice.textContent = '已帶入草稿。';
      modalBackdrop.classList.add('is-open');
      modalBackdrop.setAttribute('aria-hidden', 'false');
      modalClose.focus();
    }
    function setTemplateMenuOpen(open) {
      templateMenu.hidden = !open;
      templateButton.setAttribute('aria-expanded', String(!!open));
    }
    function setTestTemplateMenuOpen(open) {
      if (!testTemplateMenu || !testTemplateButton) return;
      testTemplateMenu.hidden = !open;
      testTemplateButton.setAttribute('aria-expanded', String(!!open));
    }
    function applyTestTemplate(key) {
      testBody.innerHTML = modalPresets[key];
      noteStatus.textContent = '測試頁已插入「' + modalPresetLabels[key] + '」範本；內容仍可繼續修改。';
      setTestTemplateMenuOpen(false);
    }
    function showPreset(key) {
      modalEditor.innerHTML = modalPresets[key];
      modalEditor.focus();
      setTemplateMenuOpen(false);
      modalNotice.textContent = '已示範「' + modalPresetLabels[key] + '」，內容仍可繼續編輯。';
    }

    applyTime.addEventListener('click', function () {
      noteStatus.textContent = '已套用時間調整：目前 ' + (adjustedMinutes > 0 ? '+' : '') + adjustedMinutes + ' 分鐘。';
    });
    saveEditButton.addEventListener('click', function () {
      noteStatus.textContent = '示範已按下 Save；正式使用時會保存這筆 Activity Note。';
    });
    discardEditButton.addEventListener('click', function () {
      testBody.textContent = '';
      noteStatus.textContent = '示範已按下 Discard，內容已清除。';
    });

    actionButtons.edit.addEventListener('click', openEditor);
    Object.keys(actionButtons).filter(function (key) { return key !== 'edit'; }).forEach(function (key) {
      actionButtons[key].addEventListener('click', function () {
        noteStatus.textContent = '測試結果：' + noteActions.find(function (item) { return item[0] === key; })[2];
        if (key === 'template') setTestTemplateMenuOpen(!testTemplateMenu.hidden);
      });
    });
    modalClose.addEventListener('click', closeEditor);
    modalCancel.addEventListener('click', closeEditor);
    modalApply.addEventListener('click', function () {
      testBody.innerHTML = modalEditor.innerHTML;
      noteStatus.textContent = '已套用回測試頁；正式使用時仍需回到 HaloPSA 按下儲存。';
      closeEditor();
    });
    modalBackdrop.addEventListener('click', function (event) { if (event.target === modalBackdrop) closeEditor(); });
    modalBackdrop.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeEditor(); });
    modalAi.querySelectorAll('[data-note-preset]').forEach(function (button) {
      button.addEventListener('click', function () { showPreset(button.getAttribute('data-note-preset')); });
    });
    templateMenu.querySelectorAll('[data-note-template]').forEach(function (button) {
      button.addEventListener('click', function () { showPreset(button.getAttribute('data-note-template')); });
    });
    testTemplateMenu.querySelectorAll('[data-note-test-template]').forEach(function (button) {
      button.addEventListener('click', function () { applyTestTemplate(button.getAttribute('data-note-test-template')); });
    });
    formatToolbar.querySelectorAll('[data-note-format]').forEach(function (button) {
      button.addEventListener('click', function () {
        modalEditor.focus();
        if (typeof document.execCommand === 'function') document.execCommand(button.getAttribute('data-note-format'), false, null);
        modalNotice.textContent = '格式工具：已示範「' + button.title + '」。';
      });
    });
    return section;
  }

  function render(options) {
    if (overlay) return;
    standalonePage = !!(options && options.page);
    overlay = el('div', 'hpx-onboarding-overlay');
    applyAppearance(overlay);
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', '首次登入提示');
    const modal = el('div', 'hpx-onboarding-modal');
    const closeButton = el('button', 'hpx-onboarding-close', '×'); closeButton.type = 'button'; closeButton.title = '略過首次登入提示'; closeButton.addEventListener('click', finish);
    closeButton.setAttribute('aria-label', '結束導覽');
    modal.appendChild(closeButton);
    const aside = el('aside', 'hpx-onboarding-aside');
    aside.appendChild(el('span', 'hpx-onboarding-brand', 'Halopsa'));
    aside.appendChild(el('h1', '', '快速設定'));
    const dots = el('nav', 'hpx-onboarding-progress');
    dots.setAttribute('aria-label', '開始使用的步驟');
    ['常用 Team', 'AI 服務', '永遠 CC', '快捷列', '編輯器'].forEach(function (label, index) {
      const dot = el('span', 'hpx-onboarding-dot');
      dot.appendChild(el('span', '', label));
      dots.appendChild(dot);
    });
    aside.appendChild(dots);
    modal.appendChild(aside);
    const main = el('div', 'hpx-onboarding-main');
    main.appendChild(teamStep()); main.appendChild(apiStep()); main.appendChild(ccStep()); main.appendChild(guideStep()); main.appendChild(editorStep());
    const status = el('p', 'hpx-onboarding-status'); status.setAttribute('role', 'status'); main.appendChild(status);
    const actions = el('div', 'hpx-onboarding-actions');
    const back = el('button', '', '上一步'); back.type = 'button'; back.setAttribute('data-back', '1'); back.addEventListener('click', function () { showStep(currentStep - 1); });
    const skip = el('button', '', '略過'); skip.type = 'button'; skip.setAttribute('data-skip', '1'); skip.addEventListener('click', function () { if (currentStep === LAST_STEP) finish(); else showStep(currentStep + 1); });
    const next = el('button', 'hpx-onboarding-primary', '儲存並繼續'); next.type = 'button'; next.setAttribute('data-next', '1'); next.addEventListener('click', function () { if (currentStep === LAST_STEP) { finish(); return; } mergeSettings(stepPatch(currentStep)).then(function () { showStep(currentStep + 1); }).catch(showError); });
    actions.appendChild(back); actions.appendChild(skip); actions.appendChild(next); main.appendChild(actions); modal.appendChild(main);
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
