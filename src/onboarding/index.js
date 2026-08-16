/** First-login setup hint. All writes merge into chrome.storage.local.hpx_settings. */
(function () {
  'use strict';
  const NS = window.__HPX;
  const SETTINGS_KEY = 'hpx_settings';
  const VERSION_FIELD = 'onboardingVersion';
  const CURRENT_VERSION = 17;
  const STEP_COUNT = 5;
  const LAST_STEP = STEP_COUNT - 1;
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

  function createTigerAvatar(className) {
    const image = el('img', className);
    image.src = chrome.runtime.getURL('assets/branding/tiger-tiger-avatar.png');
    image.alt = 'Tiger Tiger';
    image.decoding = 'async';
    image.draggable = false;
    return image;
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
      settings.addEventListener('click', openOptionsPage);
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
    currentStep = Math.max(0, Math.min(LAST_STEP, index));
    const modal = overlay.querySelector('.hpx-onboarding-modal');
    if (modal) modal.classList.toggle('hpx-onboarding-modal--guide', currentStep >= 3);
    overlay.querySelectorAll('.hpx-onboarding-step').forEach(function (step, stepIndex) {
      step.hidden = stepIndex !== currentStep;
    });
    overlay.querySelectorAll('.hpx-onboarding-dot').forEach(function (dot, dotIndex) {
      dot.classList.toggle('is-active', dotIndex === currentStep);
      dot.classList.toggle('is-done', dotIndex < currentStep);
    });
    overlay.querySelector('[data-back]').hidden = currentStep === 0;
    overlay.querySelector('[data-next]').textContent = currentStep === LAST_STEP ? '完成設定' : '儲存並繼續';
    overlay.querySelector('[data-skip]').textContent = currentStep === LAST_STEP ? '略過並完成' : '略過這一步';
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

  function guideStep() {
    const section = el('section', 'hpx-onboarding-step hpx-onboarding-guide hpx-onboarding-home-guide');
    section.appendChild(el('h2', '', '4. HaloPSA 主頁與左下設定列'));

    const shortcutItems = [
      ['mode', '◉', 'mode', '顯示模式'],
      ['color', '◆', 'color', '介面顏色'],
      ['pet', '♟', 'pet', '快捷寵物'],
      ['settings', '⚙', 'settings', '設定後台'],
    ];
    const guidePurposes = {
      mode: '切換簡單模式／預設模式。',
      color: '更換 Extension 介面配色。',
      pet: '叫出快捷寵物與 Quick Links。',
      settings: '開啟完整設定後台。',
    };

    const demo = el('div', 'hpx-onboarding-guide-demo hpx-onboarding-quickbar-demo');
    const sidebar = el('aside', 'hpx-onboarding-guide-sidebar');
    sidebar.setAttribute('aria-label', '快捷列示意');
    sidebar.appendChild(el('div', 'hpx-onboarding-guide-branddot'));
    sidebar.appendChild(el('div', 'hpx-onboarding-guide-side-label', 'HaloPSA'));
    const purpose = el('div', 'hpx-onboarding-guide-purpose');
    purpose.setAttribute('aria-live', 'polite');
    purpose.setAttribute('aria-hidden', 'true');
    sidebar.appendChild(purpose);
    const quickbar = el('div', 'hpx-onboarding-guide-quickbar');
    const guidePrompt = el('span', 'hpx-onboarding-guide-prompt');
    guidePrompt.setAttribute('aria-hidden', 'true');
    guidePrompt.appendChild(el('span', 'hpx-onboarding-guide-arrow-label hpx-onboarding-note-edit-label', '設定列'));
    guidePrompt.appendChild(el('span', 'hpx-onboarding-guide-arrow hpx-onboarding-note-edit-arrow', '↓'));
    quickbar.appendChild(guidePrompt);

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
        const sidebarRect = sidebar.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const gap = 6;
        const preferredTop = buttonRect.bottom - sidebarRect.top + gap;
        const maxTop = Math.max(8, sidebar.clientHeight - purpose.offsetHeight - 8);
        const top = preferredTop <= maxTop
          ? preferredTop
          : Math.max(8, buttonRect.top - sidebarRect.top - purpose.offsetHeight - gap);
        purpose.style.top = Math.round(top) + 'px';
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
    sidebar.appendChild(quickbar);
    demo.appendChild(sidebar);

    const homeContent = el('main', 'hpx-onboarding-guide-home-page');
    homeContent.setAttribute('aria-label', 'HaloPSA Home 主頁示意');
    const homeHeader = el('div', 'hpx-onboarding-guide-home-header');
    homeHeader.appendChild(el('strong', '', 'Home'));
    const newTicket = el('button', 'hpx-onboarding-guide-home-ticket', '＋ New Ticket'); newTicket.type = 'button';
    homeHeader.appendChild(newTicket);
    homeContent.appendChild(homeHeader);
    homeContent.appendChild(el('h3', 'hpx-onboarding-guide-home-greeting', 'Good afternoon Tiger'));
    const profile = el('div', 'hpx-onboarding-guide-home-profile');
    const homeAvatar = el('span', 'hpx-onboarding-guide-home-avatar');
    homeAvatar.appendChild(createTigerAvatar('hpx-onboarding-guide-home-avatar-image'));
    profile.appendChild(homeAvatar);
    const profileText = el('div', '');
    profileText.appendChild(el('strong', '', 'Tiger Tiger'));
    profileText.appendChild(el('small', '', 'Op. Engineer　● Available'));
    profile.appendChild(profileText);
    homeContent.appendChild(profile);
    homeContent.appendChild(el('label', 'hpx-onboarding-guide-home-period-label', 'Reporting Period'));
    const period = el('div', 'hpx-onboarding-guide-home-period', 'All　⌄');
    homeContent.appendChild(period);
    const stats = el('div', 'hpx-onboarding-guide-home-stats');
    [
      ['過去 30 天開單量最高客戶', '60', '#4b6da8', 'bar'],
      ['本年度每週案件總量', '109', '#1687d9', 'line'],
      ['服務品質－每週回應時間平均', '27.98', '#4b6da8', 'line'],
      ['案件總量', '223', '#f5a033', 'bar'],
      ['案件總量不包含等客戶及廠商', '198', '#2e91e6', 'bar'],
      ['服務品質－本年度每週結案時間平均', '3.07', '#4b6da8', 'line'],
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
    section.appendChild(demo);
    return section;
  }

  function editorStep() {
    const section = el('section', 'hpx-onboarding-step hpx-onboarding-guide');
    section.appendChild(el('h2', '', '5. HaloPSA 編輯頁使用說明'));

    const demo = el('div', 'hpx-onboarding-guide-demo hpx-onboarding-editor-demo');
    const content = el('main', 'hpx-onboarding-guide-note-page hpx-onboarding-edit-page');
    content.setAttribute('aria-label', 'HaloPSA 編輯頁示意');

    const editHeader = el('div', 'hpx-onboarding-edit-header');
    const editIdentity = el('div', 'hpx-onboarding-edit-identity');
    const editAvatar = el('span', 'hpx-onboarding-edit-avatar');
    editAvatar.appendChild(createTigerAvatar('hpx-onboarding-edit-avatar-image'));
    editIdentity.appendChild(editAvatar);
    const identityText = el('div', '');
    identityText.appendChild(el('strong', '', 'Tiger Tiger'));
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
        adjustedMinutes += Number(item[1]);
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
    const editorToolbar = el('div', 'hpx-onboarding-note-toolbar', '⛶　 A⋮　 ≡　 1.　 •　 ❝　 🔗　 ▧　 ▦　 ─　 A/　 ↶　 ↷　 …　 Ω　 <>');
    const aiStrip = el('div', 'hpx-onboarding-note-ai-strip');
    const noteStatus = el('span', 'hpx-onboarding-sr-status', '');
    noteStatus.setAttribute('aria-live', 'polite');
    const noteActions = [
      ['edit', '編輯', '點擊後開啟編輯頁示範。'],
      ['customer', '客戶版', '整理成較有禮貌、格式清楚的客戶用內容。'],
      ['ticket', '工單版', '整理處理內容、目前結果與下一步。'],
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
      if (item[0] === 'edit') {
        const prompt = el('span', 'hpx-onboarding-note-edit-prompt');
        prompt.appendChild(el('span', 'hpx-onboarding-note-edit-label', '開啟編輯頁示範'));
        prompt.appendChild(el('span', 'hpx-onboarding-note-edit-arrow', '↓'));
        button.appendChild(prompt);
      }
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
    aiStrip.insertBefore(el('span', 'hpx-onboarding-note-ai-label', 'AI'), actionButtons.customer);
    testEditor.appendChild(editorToolbar);
    testEditor.appendChild(aiStrip);
    const testBody = el('div', 'hpx-onboarding-note-body', '在這裡輸入或貼上工單處理內容…');
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
    demo.appendChild(content);

    const modalBackdrop = el('div', 'hpx-onboarding-note-modal-backdrop');
    modalBackdrop.setAttribute('aria-hidden', 'true');
    const noteModal = el('div', 'hpx-onboarding-note-modal');
    noteModal.setAttribute('role', 'dialog');
    noteModal.setAttribute('aria-modal', 'true');
    noteModal.setAttribute('aria-labelledby', 'hpx-onboarding-note-modal-title');
    const modalTitlebar = el('div', 'hpx-onboarding-note-modal-titlebar');
    modalTitlebar.appendChild(el('strong', '', 'HaloPSA — 編輯頁示範'));
    const modalClose = el('button', 'hpx-onboarding-note-modal-close', '×');
    modalClose.type = 'button'; modalClose.title = '關閉編輯頁面'; modalClose.setAttribute('aria-label', '關閉編輯頁面');
    modalTitlebar.appendChild(modalClose); noteModal.appendChild(modalTitlebar);
    const modalHead = el('div', 'hpx-onboarding-note-modal-head');
    const modalHeading = el('h3', '', 'Ticket 641844'); modalHeading.id = 'hpx-onboarding-note-modal-title';
    modalHead.appendChild(modalHeading);
    modalHead.appendChild(el('p', '', '這是編輯頁的互動示範；套用後仍需回到 HaloPSA 按下儲存。'));
    noteModal.appendChild(modalHead);

    const formatToolbar = el('div', 'hpx-onboarding-note-modal-toolbar');
    [['bold', 'B'], ['italic', 'I'], ['insertOrderedList', '1.'], ['insertUnorderedList', '•'], ['formatBlock', '❝'], ['undo', '↶'], ['redo', '↷']].forEach(function (item) {
      const button = el('button', 'hpx-onboarding-note-format', item[1]);
      button.type = 'button'; button.title = item[0]; button.setAttribute('data-note-format', item[0]);
      formatToolbar.appendChild(button);
    });
    noteModal.appendChild(formatToolbar);

    const modalAi = el('div', 'hpx-onboarding-note-modal-ai');
    modalAi.appendChild(el('span', 'hpx-onboarding-note-modal-ai-label', '試著點看看：AI 功能'));
    const modalEditor = el('div', 'hpx-onboarding-note-modal-editor');
    modalEditor.setAttribute('contenteditable', 'true'); modalEditor.setAttribute('spellcheck', 'false');
    modalEditor.setAttribute('aria-label', 'Note 編輯頁面內容');
    modalEditor.innerHTML = '<p>已確認機房網路正常。</p><p>重新啟動交換器後連線恢復。</p><p>已請客戶持續觀察，如再次發生請回覆工單。</p>';
    const modalNotice = el('div', 'hpx-onboarding-note-modal-notice', '可直接輸入文字，或使用上方按鈕試看看。');
    const modalPresetLabels = {
      customer: '客戶版', ticket: '工單版', en: '翻譯成英文', zh: '翻譯成中文',
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
    }
    function openEditor() {
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
      testBody.textContent = '在這裡輸入或貼上工單處理內容…';
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
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'hpx-onboarding-title');
    const modal = el('div', 'hpx-onboarding-modal');
    const closeButton = el('button', 'hpx-onboarding-close', '×'); closeButton.type = 'button'; closeButton.title = '略過首次登入提示'; closeButton.addEventListener('click', finish);
    const title = el('h1', '', '首次登入提示'); title.id = 'hpx-onboarding-title';
    modal.appendChild(closeButton); modal.appendChild(title);
    modal.appendChild(el('p', 'hpx-onboarding-intro', '用五個簡短步驟完成基本設定、左下設定列與編輯頁導覽；每一步都可以略過。'));
    const dots = el('div', 'hpx-onboarding-progress');
    ['團隊', 'API', '永遠 CC', '設定列', '編輯頁'].forEach(function (label) { const dot = el('span', 'hpx-onboarding-dot', label); dots.appendChild(dot); });
    modal.appendChild(dots); modal.appendChild(teamStep()); modal.appendChild(apiStep()); modal.appendChild(ccStep()); modal.appendChild(guideStep()); modal.appendChild(editorStep());
    modal.appendChild(el('p', 'hpx-onboarding-status'));
    const actions = el('div', 'hpx-onboarding-actions');
    const back = el('button', '', '上一步'); back.type = 'button'; back.setAttribute('data-back', '1'); back.addEventListener('click', function () { showStep(currentStep - 1); });
    const skip = el('button', '', '略過這一步'); skip.type = 'button'; skip.setAttribute('data-skip', '1'); skip.addEventListener('click', function () { if (currentStep === LAST_STEP) finish(); else showStep(currentStep + 1); });
    const next = el('button', 'hpx-onboarding-primary', '儲存並繼續'); next.type = 'button'; next.setAttribute('data-next', '1'); next.addEventListener('click', function () { if (currentStep === LAST_STEP) { finish(); return; } mergeSettings(stepPatch(currentStep)).then(function () { showStep(currentStep + 1); }).catch(showError); });
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
