/**
 * settings-panel.js
 * 浮動設定面板（寵物 + 跟隨定位面板）：快捷按鈕快速切換。
 * 模式、外觀與 PET 控制固定在主畫面左下角橫向工具列；點寵物 → 面板在寵物左右側自動定位。
 * 拖曳寵物可移動；所有外觀變更立即套用並保存。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const STORAGE_KEY = 'hpx_settings';
  const SHORTCUTS_FIELD = 'shortcutLinks';
  const MAX_SHORTCUTS = 8;

  const DEFAULTS = {
    theme: 'cute-ios',
    accent: '#0c2d55',
    opacity: 100,
    pet: 'claude-crab',
    petPosition: { right: 16, bottom: 16 },
    petHidden: false,
    sidebarCollapsed: false,
    shortcutLinks: [],
    ultimateMode: false,
  };
  const ACCENT_LIST = [
    { name: 'Blue', hex: '#0c2d55' },
    { name: 'Orange', hex: '#ff7a1a' },
    { name: 'Amber', hex: '#f5b82e' },
    { name: 'Red', hex: '#ef4444' },
    { name: 'Pink', hex: '#ff6fa5' },
    { name: 'Purple', hex: '#9b6bff' },
    { name: 'Indigo', hex: '#6366f1' },
    { name: 'Blue', hex: '#3a82f7' },
    { name: 'Cyan', hex: '#06b6d4' },
    { name: 'Teal', hex: '#14b8a6' },
    { name: 'Green', hex: '#2fb968' },
    { name: 'Lime', hex: '#84cc16' },
    { name: 'Slate', hex: '#64748b' },
  ];

  function normalizeAccent(value) {
    const hex = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : DEFAULTS.accent;
  }

  let panelEl = null;
  let petEl = null;
  let petHidden = false;
  let activePetId = 'claude-crab';
  let petIdleTimer = null;
  let petActionTimer = null;
  let petSpritePlayback = null;
  let dragAtlasAnimation = '';
  let lastIdleAction = '';
  let idleListenersBound = false;
  let viewportListenersBound = false;
  let persistQueue = Promise.resolve();
  let outsideClickHandler = null;
  let outsideClickBindTimer = null;
  let sidebarControlsEl = null;
  let sidebarPopoverEl = null;
  let sidebarSettings = null;
  let sidebarPositionFrame = null;
  let sidebarObserver = null;
  const petImageUrls = {};
  let PET_DEFS = NS.core.petRegistry.builtIns();

  function getExtUrl(path) {
    try { return chrome.runtime.getURL(path); } catch (e) { return ''; }
  }

  function openOptionsPage() {
    try {
      chrome.runtime.sendMessage({ type: 'HPX_OPEN_OPTIONS' }, function (response) {
        const lastError = chrome.runtime.lastError;
        if (lastError || !response || response.ok === false) {
          const url = getExtUrl('src/options/options.html');
          if (url) window.open(url, '_blank');
        }
      });
    } catch (error) {
      const url = getExtUrl('src/options/options.html');
      if (url) window.open(url, '_blank');
    }
  }

  function loadSettings(cb) {
    chrome.storage.local.get(STORAGE_KEY, function (data) {
      const settings = Object.assign({}, DEFAULTS, (data && data[STORAGE_KEY]) || {});
      if (settings.theme !== 'cute-ios' && settings.theme !== 'default') settings.theme = DEFAULTS.theme;
      settings.accent = normalizeAccent(settings.accent);
      settings.pet = petDefinition(settings.pet).id;
      settings.petHidden = settings.petHidden === true;
      settings.sidebarCollapsed = settings.sidebarCollapsed === true;
      settings[SHORTCUTS_FIELD] = normalizeShortcutLinks(settings[SHORTCUTS_FIELD]);
      settings.ultimateMode = settings.ultimateMode === true;
      cb(settings);
    });
  }

  function persistSettings(patch) {
    const update = Object.assign({}, patch || {});
    persistQueue = persistQueue.then(function () {
      return new Promise(function (resolve) {
        chrome.storage.local.get(STORAGE_KEY, function (data) {
          const merged = Object.assign({}, (data && data[STORAGE_KEY]) || {}, update);
          chrome.storage.local.set({ [STORAGE_KEY]: merged }, function () { resolve(merged); });
        });
      });
    });
    return persistQueue;
  }

  function unbindOutsideClick() {
    if (outsideClickBindTimer) {
      clearTimeout(outsideClickBindTimer);
      outsideClickBindTimer = null;
    }
    if (outsideClickHandler) {
      document.removeEventListener('pointerdown', outsideClickHandler, true);
      outsideClickHandler = null;
    }
  }

  function bindOutsideClick() {
    unbindOutsideClick();
    outsideClickBindTimer = setTimeout(function () {
      outsideClickBindTimer = null;
      if (!panelEl && !sidebarPopoverEl) return;
      outsideClickHandler = function (event) {
        if (!panelEl && !sidebarPopoverEl) return;
        const target = event && event.target;
        if (
          (target && panelEl && panelEl.contains(target)) ||
          (target && petEl && petEl.contains(target)) ||
          (target && sidebarControlsEl && sidebarControlsEl.contains(target)) ||
          (target && sidebarPopoverEl && sidebarPopoverEl.contains(target))
        ) return;
        const hadPanel = !!panelEl;
        if (sidebarPopoverEl) closeSidebarPopover();
        if (hadPanel) SettingsPanel.close();
        else unbindOutsideClick();
      };
      document.addEventListener('pointerdown', outsideClickHandler, true);
    }, 0);
  }

  function normalizeShortcutUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || /[\u0000-\u001f]/.test(raw)) return '';
    try {
      const parsed = new URL(raw, window.location.origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return parsed.href;
    } catch (e) {
      return '';
    }
  }

  function normalizeShortcutLinks(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_SHORTCUTS).map(function (item) {
      const name = String(item && item.name || '').trim().slice(0, 32);
      const url = normalizeShortcutUrl(item && item.url);
      return name && url ? { name: name, url: url } : null;
    }).filter(Boolean);
  }

  function validateShortcutLinks(value) {
    const entries = Array.isArray(value) ? value : [];
    const links = [];
    for (const item of entries) {
      const name = String(item && item.name || '').trim().slice(0, 32);
      const rawUrl = String(item && item.url || '').trim();
      if (!name && !rawUrl) continue;
      const url = normalizeShortcutUrl(rawUrl);
      if (!name || !url) {
        return { valid: false, links: [], error: '每個快捷按鈕都需要名稱與有效的 URL。' };
      }
      links.push({ name: name, url: url });
    }
    return { valid: true, links: links.slice(0, MAX_SHORTCUTS), error: '' };
  }

  function openShortcut(url) {
    const safeUrl = normalizeShortcutUrl(url);
    if (!safeUrl) return false;
    window.location.assign(safeUrl);
    return true;
  }

  // ── 面板建構 ────────────────────────────────────────────────

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function petDefinition(id) {
    return PET_DEFS.find(function (pet) { return pet.id === id; }) || PET_DEFS[0];
  }

  function petUrls(id) {
    return petImageUrls[id] || petImageUrls[PET_DEFS[0].id] || { image: '', wink: '', atlas: '' };
  }

  function hydratePetUrls() {
    Object.keys(petImageUrls).forEach(function (id) { delete petImageUrls[id]; });
    PET_DEFS.forEach(function (definition) {
      petImageUrls[definition.id] = {
        image: definition.image ? getExtUrl(definition.image) : '',
        wink: definition.wink ? getExtUrl(definition.wink) : '',
        atlas: definition.atlas ? getExtUrl(definition.atlas) : '',
      };
    });
  }

  function refreshPetDefinitions() {
    if (!NS.core.petRegistry || typeof NS.core.petRegistry.discover !== 'function') {
      hydratePetUrls();
      return Promise.resolve(PET_DEFS);
    }
    return NS.core.petRegistry.discover().then(function (definitions) {
      PET_DEFS = definitions;
      hydratePetUrls();
      return PET_DEFS;
    });
  }

  function isAtlasPet(id) {
    return !!petDefinition(id).atlas;
  }

  function stopPetSpritePlayback() {
    if (petSpritePlayback && typeof petSpritePlayback.stop === 'function') petSpritePlayback.stop();
    petSpritePlayback = null;
  }

  function createPetVisual(id, picker) {
    const definition = petDefinition(id);
    const urls = petUrls(definition.id);
    if (definition.atlas && NS.ui.petAnimator) {
      const classes = picker
        ? 'hpx-sp-pet-choice-atlas hpx-sp-pet-atlas'
        : 'hpx-sp-pet-img hpx-sp-pet-atlas';
      return NS.ui.petAnimator.createVisual(urls.atlas, classes, { rows: definition.atlasRows });
    }

    const image = document.createElement('img');
    image.src = urls.image;
    image.alt = '';
    image.draggable = false;
    if (!picker) image.className = 'hpx-sp-pet-img';
    return image;
  }

  function startAtlasAnimation(animationName, options) {
    if (!petEl || !NS.ui.petAnimator) return null;
    const visual = petEl.querySelector('.hpx-sp-pet-atlas');
    if (!visual) return null;
    stopPetSpritePlayback();
    petSpritePlayback = NS.ui.petAnimator.play(visual, animationName, options);
    return petSpritePlayback;
  }

  function setPetAppearance(id) {
    const definition = petDefinition(id);
    activePetId = definition.id;
    if (!petEl) return;
    stopPetSpritePlayback();
    const currentVisual = petEl.querySelector('.hpx-sp-pet-img');
    const visual = createPetVisual(activePetId, false);
    if (currentVisual) currentVisual.replaceWith(visual);
    else petEl.appendChild(visual);
    petEl.setAttribute('data-pet', activePetId);
    petEl.setAttribute('aria-label', '開啟 Quick Links；目前寵物：' + definition.name + '；可拖曳移動');
    if (definition.atlas && !petHidden) startAtlasAnimation('idle');
  }

  /**
   * Pet 的顯示狀態由這裡統一套用到 DOM，避免只改 JS 設定卻留下可聚焦、
   * 仍在執行 idle timer 的「隱形 Pet」。側邊控制列不隨 Pet 隱藏，作為恢復入口。
   */
  function applyPetVisibility(hidden) {
    petHidden = hidden === true;
    if (!petEl) return;

    petEl.toggleAttribute('hidden', petHidden);
    petEl.setAttribute('data-hpx-pet-hidden', petHidden ? 'true' : 'false');
    petEl.setAttribute('aria-hidden', petHidden ? 'true' : 'false');
    petEl.tabIndex = petHidden ? -1 : 0;

    if (petHidden) {
      stopPetIdleAction();
      petEl.classList.remove('hpx-sp-pet-active');
      petEl.setAttribute('aria-expanded', 'false');
    } else {
      schedulePetIdleAction(1200);
    }
    refreshSidebarControls();
  }

  function setPetVisibility(hidden, persist) {
    const next = hidden === true;
    petHidden = next;
    if (sidebarSettings) sidebarSettings.petHidden = next;
    applyPetVisibility(next);
    if (next && panelEl) SettingsPanel.close();
    if (persist) persistSettings({ petHidden: next });
  }

  function stopPetIdleAction() {
    if (petIdleTimer) clearTimeout(petIdleTimer);
    if (petActionTimer) clearTimeout(petActionTimer);
    petIdleTimer = null;
    petActionTimer = null;
    stopPetSpritePlayback();
    dragAtlasAnimation = '';
    if (!petEl) return;
    petEl.classList.remove('hpx-sp-pet-act-wink', 'hpx-sp-pet-act-shake', 'hpx-sp-pet-act-hop', 'hpx-sp-pet-is-acting');
    petEl.removeAttribute('data-idle-action');
    const hint = petEl.querySelector('.hpx-sp-pet-hint');
    if (hint) hint.textContent = 'Quick Links';
    const image = petEl.querySelector('img.hpx-sp-pet-img');
    const urls = petUrls(activePetId);
    if (image && urls.image && image.src !== urls.image) image.src = urls.image;
    const atlas = petEl.querySelector('.hpx-sp-pet-atlas');
    if (atlas && NS.ui.petAnimator) NS.ui.petAnimator.paint(atlas, 'idle', 0);
  }

  function schedulePetIdleAction(delay) {
    if (petIdleTimer) clearTimeout(petIdleTimer);
    petIdleTimer = null;
    if (petHidden || !petEl || !petEl.isConnected || document.hidden) return;
    if (isAtlasPet(activePetId) && !petSpritePlayback) startAtlasAnimation('idle');
    const wait = typeof delay === 'number' ? delay : 2800 + Math.round(Math.random() * 3200);
    petIdleTimer = setTimeout(function () {
      if (petHidden || !petEl || !petEl.isConnected || document.hidden || petEl.classList.contains('hpx-sp-pet-dragging')) {
        if (!petHidden) schedulePetIdleAction(1600);
        return;
      }

      const definition = petDefinition(activePetId);
      const urls = petUrls(activePetId);
      const actions = definition.atlas
        ? definition.actions
        : (urls.wink ? ['wink', 'shake', 'hop'] : ['shake', 'hop']);
      let available = actions.filter(function (action) { return action !== lastIdleAction; });
      if (!available.length) available = actions;
      const action = available[Math.floor(Math.random() * available.length)];
      lastIdleAction = action;
      petEl.classList.add('hpx-sp-pet-act-' + action);
      petEl.classList.add('hpx-sp-pet-is-acting');
      petEl.setAttribute('data-idle-action', action);

      const image = petEl.querySelector('.hpx-sp-pet-img');
      const hint = petEl.querySelector('.hpx-sp-pet-hint');
      const actionHints = {
        wink: '😉',
        shake: '⚡',
        hop: '↑',
        waving: '👋',
        waiting: '💭',
        review: '🔎',
        jumping: '↑',
        running: '💨',
        failed: '💥',
      };
      if (hint) hint.textContent = actionHints[action] || 'Quick Links';
      if (definition.atlas) {
        startAtlasAnimation(action, {
          mode: 'once',
          onComplete: function () {
            if (petEl) {
              petEl.classList.remove('hpx-sp-pet-is-acting');
              petEl.removeAttribute('data-idle-action');
            }
            if (hint) hint.textContent = 'Quick Links';
            petSpritePlayback = null;
            schedulePetIdleAction();
          },
        });
        return;
      }
      if (action === 'wink' && image && urls.wink) image.src = urls.wink;
      const duration = action === 'hop' ? 1400 : 1200;
      petActionTimer = setTimeout(function () {
        if (petEl) {
          petEl.classList.remove('hpx-sp-pet-act-' + action, 'hpx-sp-pet-is-acting');
          petEl.removeAttribute('data-idle-action');
        }
        if (hint) hint.textContent = 'Quick Links';
        if (image && urls.image) image.src = urls.image;
        petActionTimer = null;
        schedulePetIdleAction();
      }, duration);
    }, wait);
  }

  function refreshThemeUi(draft) {
    [panelEl, sidebarPopoverEl].filter(Boolean).forEach(function (root) {
      root.querySelectorAll('.hpx-sp-thumb').forEach(function (button) {
        button.classList.toggle('hpx-sp-on', button.getAttribute('data-t') === draft.theme);
      });
    });
  }

  function buildThemeSection(draft) {
    const section = el('div', 'hpx-sp-section');
    const lbl = el('div', 'hpx-sp-label');
    lbl.textContent = '介面配色';
    section.appendChild(lbl);

    const row = el('div', 'hpx-sp-theme-row');

    const themes = [
      { id: 'cute-ios', name: '輕透', bg: '#edf2fb' },
      { id: 'default',  name: '原生配色', bg: '#e6ebe6' },
    ];

    themes.forEach(function (t) {
      const thumb = el('button', 'hpx-sp-thumb' + (draft.theme === t.id ? ' hpx-sp-on' : ''));
      thumb.type = 'button';
      thumb.setAttribute('data-t', t.id);

      const bg = el('span', 'hpx-sp-thumb-bg');
      bg.style.background = t.bg;
      const name = el('span', 'hpx-sp-thumb-name');
      name.textContent = t.name;

      thumb.appendChild(bg);
      thumb.appendChild(name);
      thumb.addEventListener('click', function () {
        draft.theme = t.id;
        refreshThemeUi(draft);
        NS.ui.theme.applyAppearance(draft);
        persistSettings({ theme: draft.theme });
      });
      row.appendChild(thumb);
    });

    section.appendChild(row);
    return section;
  }

  function buildColorSection(draft) {
    const section = el('div', 'hpx-sp-section');
    const lbl = el('div', 'hpx-sp-label');
    lbl.textContent = '重點色';
    section.appendChild(lbl);

    const row = el('div', 'hpx-sp-color-row');

    const custom = el('div', 'hpx-sp-custom-color');
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'hpx-sp-color-picker';
    picker.value = normalizeAccent(draft.accent);
    picker.setAttribute('aria-label', '自訂 Accent 顏色');
    picker.title = '自訂顏色';
    const customLabel = el('span', 'hpx-sp-custom-color-label');
    const customValue = el('code', 'hpx-sp-custom-color-value');

    function refreshColorUi() {
      const accent = normalizeAccent(draft.accent);
      draft.accent = accent;
      row.querySelectorAll('.hpx-sp-swatch').forEach(function (button) {
        button.classList.toggle('hpx-sp-on', button.getAttribute('data-a') === accent);
      });
      picker.value = accent;
      customValue.textContent = accent.toUpperCase();
      custom.classList.toggle('hpx-sp-custom-color-active', !ACCENT_LIST.some(function (item) { return item.hex === accent; }));
    }

    customLabel.textContent = '自訂';
    custom.appendChild(picker);
    custom.appendChild(customLabel);
    custom.appendChild(customValue);
    picker.addEventListener('input', function () {
      draft.accent = normalizeAccent(picker.value);
      refreshColorUi();
      NS.ui.theme.applyAppearance(draft);
    });
    picker.addEventListener('change', function () {
      draft.accent = normalizeAccent(picker.value);
      refreshColorUi();
      NS.ui.theme.applyAppearance(draft);
      persistSettings({ accent: draft.accent });
    });

    ACCENT_LIST.forEach(function (accent) {
      const hex = accent.hex;
      const sw = el('button', 'hpx-sp-swatch' + (draft.accent === hex ? ' hpx-sp-on' : ''));
      sw.type = 'button';
      sw.style.setProperty('--sw', hex);
      sw.setAttribute('data-a', hex);
      sw.setAttribute('aria-label', accent.name);
      sw.title = accent.name;
      sw.addEventListener('click', function () {
        draft.accent = hex;
        refreshColorUi();
        NS.ui.theme.applyAppearance(draft);
        persistSettings({ accent: draft.accent });
      });
      row.appendChild(sw);
    });

    section.appendChild(row);
    section.appendChild(custom);
    refreshColorUi();
    return section;
  }

  function buildPetSection(draft) {
    const section = el('div', 'hpx-sp-section');
    const label = el('div', 'hpx-sp-label');
    label.textContent = '工作夥伴';
    section.appendChild(label);

    const row = el('div', 'hpx-sp-pet-choice-row');
    PET_DEFS.forEach(function (definition) {
      const button = el('button', 'hpx-sp-pet-choice' + (draft.pet === definition.id ? ' hpx-sp-on' : ''));
      button.type = 'button';
      button.setAttribute('data-pet-choice', definition.id);
      button.setAttribute('aria-label', '選擇 ' + definition.name + ' 寵物');

      const image = createPetVisual(definition.id, true);
      const name = el('span', 'hpx-sp-pet-choice-name');
      name.textContent = definition.name;
      button.appendChild(image);
      button.appendChild(name);

      button.addEventListener('click', function () {
        row.querySelectorAll('.hpx-sp-pet-choice').forEach(function (item) { item.classList.remove('hpx-sp-on'); });
        button.classList.add('hpx-sp-on');
        draft.pet = definition.id;
        stopPetIdleAction();
        setPetAppearance(definition.id);
        schedulePetIdleAction(900);
        persistSettings({ pet: draft.pet });
        refreshSidebarControls();
        closeSidebarPopover();
        unbindOutsideClick();
      });
      row.appendChild(button);
    });

    section.appendChild(row);
    return section;
  }

  function buildPetVisibilitySection(draft) {
    const section = el('div', 'hpx-sp-section hpx-sp-pet-visibility');
    const copy = el('div', 'hpx-sp-pet-visibility-copy');
    const title = el('div', 'hpx-sp-pet-visibility-title', 'Pet 顯示');
    const description = el(
      'div',
      'hpx-sp-pet-visibility-description',
      '不想看到浮動 Pet 時可以隱藏，之後可從側邊 pet 選單恢復。'
    );
    const toggle = el('button', 'hpx-sp-pet-visibility-toggle');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', '顯示浮動 Pet');

    function refresh() {
      const hidden = draft.petHidden === true;
      toggle.classList.toggle('hpx-sp-on', !hidden);
      toggle.setAttribute('aria-checked', hidden ? 'false' : 'true');
      toggle.textContent = hidden ? '顯示 Pet' : '隱藏 Pet';
    }

    toggle.addEventListener('click', function () {
      draft.petHidden = draft.petHidden !== true;
      setPetVisibility(draft.petHidden, true);
      refreshSidebarControls();
      if (draft.petHidden) {
        closeSidebarPopover();
        unbindOutsideClick();
      }
    });

    copy.appendChild(title);
    copy.appendChild(description);
    section.appendChild(copy);
    section.appendChild(toggle);
    refresh();
    return section;
  }

  function buildShortcutSection(draft) {
    const section = el('div', 'hpx-sp-section hpx-sp-shortcuts');
    const launcher = el('div', 'hpx-sp-shortcut-launcher');
    const editor = el('div', 'hpx-sp-shortcut-editor');
    let draggingIndex = -1;
    let suppressCardOpen = false;
    const pendingNewLinks = new Set();

    draft[SHORTCUTS_FIELD] = Array.isArray(draft[SHORTCUTS_FIELD])
      ? draft[SHORTCUTS_FIELD].map(function (item) {
        return { name: String(item && item.name || ''), url: String(item && item.url || '') };
      })
      : [];

    function persistShortcutLinks() {
      const validation = validateShortcutLinks(draft[SHORTCUTS_FIELD]);
      if (!validation.valid) return Promise.resolve(false);
      return persistSettings({ shortcutLinks: validation.links }).then(function () { return true; });
    }

    function render() {
      launcher.replaceChildren();
      editor.replaceChildren();
      const links = draft[SHORTCUTS_FIELD];

      links.forEach(function (link, index) {
        let editing = pendingNewLinks.has(link);
        const original = { name: link.name, url: link.url };
        const shortcutWrap = el('div', 'hpx-sp-shortcut-launcher-item hpx-sp-shortcut-card');
        shortcutWrap.setAttribute('data-shortcut-index', String(index));
        shortcutWrap.setAttribute('aria-label', '拖曳以重新排序 ' + (link.name.trim() || '未命名'));
        shortcutWrap.addEventListener('click', function (event) {
          if (suppressCardOpen || event.defaultPrevented) return;
          const target = event.target;
          if (target && target.closest && target.closest('button, input, select, textarea')) return;
          if (normalizeShortcutUrl(link.url)) openShortcut(link.url);
        });
        shortcutWrap.addEventListener('dragstart', function (event) {
          suppressCardOpen = true;
          draggingIndex = index;
          shortcutWrap.classList.add('hpx-sp-shortcut-dragging');
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(index));
          }
        });
        shortcutWrap.addEventListener('dragover', function (event) {
          if (draggingIndex < 0 || draggingIndex === index) return;
          event.preventDefault();
          shortcutWrap.classList.add('hpx-sp-shortcut-drag-over');
          shortcutWrap.classList.toggle(
            'hpx-sp-shortcut-drag-after',
            event.clientY > shortcutWrap.getBoundingClientRect().top + shortcutWrap.offsetHeight / 2
          );
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });
        shortcutWrap.addEventListener('dragleave', function (event) {
          if (event.relatedTarget && shortcutWrap.contains(event.relatedTarget)) return;
          shortcutWrap.classList.remove('hpx-sp-shortcut-drag-over', 'hpx-sp-shortcut-drag-after');
        });
        shortcutWrap.addEventListener('drop', function (event) {
          if (draggingIndex < 0 || draggingIndex === index) return;
          event.preventDefault();
          const rect = shortcutWrap.getBoundingClientRect();
          let targetIndex = index + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
          const sourceIndex = draggingIndex;
          if (sourceIndex < targetIndex) targetIndex -= 1;
          draggingIndex = -1;
          if (sourceIndex !== targetIndex) {
            const moved = links.splice(sourceIndex, 1)[0];
            links.splice(targetIndex, 0, moved);
            render();
            persistShortcutLinks();
          }
        });
        shortcutWrap.addEventListener('dragend', function () {
          draggingIndex = -1;
          shortcutWrap.classList.remove('hpx-sp-shortcut-dragging', 'hpx-sp-shortcut-drag-over', 'hpx-sp-shortcut-drag-after');
          setTimeout(function () { suppressCardOpen = false; }, 0);
        });
        const cardMain = el('div', 'hpx-sp-shortcut-card-main');
        const info = el('div', 'hpx-sp-shortcut-info');
        const quickButton = el('button', 'hpx-sp-shortcut-button');
        quickButton.type = 'button';
        quickButton.textContent = link.name.trim() || '未命名';
        quickButton.title = link.url ? '開啟 ' + (link.name.trim() || '快速連結') : '請設定 URL';
        quickButton.disabled = !normalizeShortcutUrl(link.url);
        quickButton.addEventListener('click', function () { openShortcut(link.url); });
        info.appendChild(quickButton);

        const actions = el('div', 'hpx-sp-shortcut-actions');
        const edit = el('button', 'hpx-sp-shortcut-edit');
        edit.type = 'button';
        edit.textContent = '✎';
        edit.title = '編輯 Link';
        edit.setAttribute('aria-label', '編輯 Link');

        const row = el('div', 'hpx-sp-shortcut-row');
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.maxLength = 32;
        nameInput.placeholder = '按鈕名稱';
        nameInput.value = link.name;
        nameInput.setAttribute('aria-label', '快捷按鈕名稱');
        nameInput.addEventListener('input', function () {
          syncEditorState();
        });
        nameInput.addEventListener('focus', function () {
          keepShortcutEditorVisible(nameInput);
        });

        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.placeholder = '/tickets 或 https://…';
        urlInput.value = link.url;
        urlInput.setAttribute('aria-label', '快捷按鈕 URL');
        urlInput.addEventListener('input', function () {
          syncEditorState();
        });
        urlInput.addEventListener('focus', function () {
          keepShortcutEditorVisible(urlInput);
        });

        const remove = el('button', 'hpx-sp-shortcut-remove');
        remove.type = 'button';
        remove.textContent = '刪除';
        remove.title = '刪除快速連結';
        remove.setAttribute('aria-label', '刪除快速連結');
        remove.addEventListener('click', function () {
          pendingNewLinks.delete(link);
          links.splice(index, 1);
          render();
          persistShortcutLinks();
        });

        const editorActions = el('div', 'hpx-sp-shortcut-edit-actions');
        const confirm = el('button', 'hpx-sp-shortcut-confirm', '確認');
        confirm.type = 'button';
        const cancel = el('button', 'hpx-sp-shortcut-cancel', '取消');
        cancel.type = 'button';
        const error = el('div', 'hpx-sp-shortcut-error');
        error.setAttribute('role', 'status');

        function setEditing(next) {
          editing = next === true;
          row.hidden = !editing;
          edit.hidden = editing;
          remove.hidden = editing;
          shortcutWrap.draggable = !editing;
          quickButton.disabled = editing || !normalizeShortcutUrl(link.url);
          edit.setAttribute('aria-pressed', editing ? 'true' : 'false');
          edit.setAttribute('aria-expanded', editing ? 'true' : 'false');
          if (!editing) error.textContent = '';
        }

        function syncEditorState() {
          const nameReady = !!nameInput.value.trim();
          const urlReady = !!normalizeShortcutUrl(urlInput.value);
          confirm.disabled = !nameReady || !urlReady;
          nameInput.setAttribute('aria-invalid', nameReady ? 'false' : 'true');
          urlInput.setAttribute('aria-invalid', urlReady ? 'false' : 'true');
          error.textContent = '';
        }

        edit.addEventListener('click', function () {
          setEditing(true);
          syncEditorState();
          nameInput.focus();
          keepShortcutEditorVisible(nameInput);
        });

        confirm.addEventListener('click', function () {
          const name = nameInput.value.trim().slice(0, 32);
          const url = normalizeShortcutUrl(urlInput.value);
          if (!name || !url) {
            syncEditorState();
            error.textContent = '請輸入名稱與有效網址。';
            (!name ? nameInput : urlInput).focus();
            return;
          }

          link.name = name;
          link.url = url;
          pendingNewLinks.delete(link);
          persistShortcutLinks().then(function (saved) {
            if (saved) {
              render();
              return;
            }
            link.name = original.name;
            link.url = original.url;
            error.textContent = '尚有其他未完成的快捷連結。';
          });
        });

        cancel.addEventListener('click', function () {
          if (pendingNewLinks.has(link)) {
            pendingNewLinks.delete(link);
            links.splice(index, 1);
            render();
            return;
          }
          nameInput.value = original.name;
          urlInput.value = original.url;
          setEditing(false);
          syncEditorState();
        });

        function handleEditorKeydown(event) {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel.click();
          } else if (event.key === 'Enter' && !confirm.disabled) {
            event.preventDefault();
            confirm.click();
          }
        }
        nameInput.addEventListener('keydown', handleEditorKeydown);
        urlInput.addEventListener('keydown', handleEditorKeydown);

        actions.appendChild(edit);
        actions.appendChild(remove);
        cardMain.appendChild(info);
        cardMain.appendChild(actions);
        shortcutWrap.appendChild(cardMain);
        row.appendChild(nameInput);
        row.appendChild(urlInput);
        editorActions.appendChild(confirm);
        editorActions.appendChild(cancel);
        row.appendChild(editorActions);
        row.appendChild(error);
        shortcutWrap.appendChild(row);
        launcher.appendChild(shortcutWrap);
        setEditing(editing);
        syncEditorState();
      });

      const addRow = el('div', 'hpx-sp-shortcut-add-row');
      const add = el('button', 'hpx-sp-shortcut-add');
      add.type = 'button';
      add.textContent = '+ 新增快速連結';
      add.disabled = links.length >= MAX_SHORTCUTS || pendingNewLinks.size > 0;
      add.addEventListener('click', function () {
        const link = { name: '', url: '' };
        pendingNewLinks.add(link);
        links.push(link);
        render();
        const inputs = launcher.querySelectorAll('.hpx-sp-shortcut-row input');
        const newNameInput = inputs[inputs.length - 2];
        if (newNameInput) {
          newNameInput.focus();
          keepShortcutEditorVisible(newNameInput);
        }
      });
      const count = el('span', 'hpx-sp-shortcut-count', links.length + '/' + MAX_SHORTCUTS);
      addRow.appendChild(add);
      addRow.appendChild(count);
      editor.appendChild(addRow);
    }

    section.appendChild(launcher);
    section.appendChild(editor);
    render();
    return section;
  }

  function buildUltimateModeSection(draft) {
    const section = el('div', 'hpx-sp-section hpx-sp-ultimate');
    const header = el('div', 'hpx-sp-ultimate-header');
    const copy = el('div', 'hpx-sp-ultimate-copy');
    const label = el('div', 'hpx-sp-ultimate-title');
    label.textContent = '簡單模式';

    const toggle = el('button', 'hpx-sp-toggle' + (draft.ultimateMode ? ' hpx-sp-on' : ''));
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', '簡單模式');
    toggle.setAttribute('aria-checked', draft.ultimateMode ? 'true' : 'false');
    const knob = el('span', 'hpx-sp-toggle-knob');
    const state = el('span', 'hpx-sp-toggle-state');

    function refresh() {
      toggle.classList.toggle('hpx-sp-on', draft.ultimateMode);
      toggle.setAttribute('aria-checked', draft.ultimateMode ? 'true' : 'false');
      state.textContent = draft.ultimateMode ? 'ON' : 'OFF';
    }

    toggle.appendChild(knob);
    toggle.appendChild(state);
    toggle.addEventListener('click', function () {
      draft.ultimateMode = !draft.ultimateMode;
      refresh();
      if (NS.features.ultimateMode) NS.features.ultimateMode.setEnabled(draft.ultimateMode);
      persistSettings({ ultimateMode: draft.ultimateMode });
    });

    copy.appendChild(label);
    header.appendChild(copy);
    header.appendChild(toggle);
    section.appendChild(header);
    refresh();
    return section;
  }

  function buildPanel(initialSettings) {
    const draft = Object.assign({}, initialSettings);
    draft.pet = petDefinition(draft.pet).id;

    const panel = el('div', 'hpx-sp');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '快捷連結');

    // Header：Quick Links 之外提供 Pet 顯示控制；隱藏後仍可由側邊 pet 選單恢復。
    const header = el('div', 'hpx-sp-header');
    header.appendChild(el('strong', 'hpx-sp-title', '快捷連結'));
    const headerActions = el('div', 'hpx-sp-header-actions');
    const hidePetBtn = el('button', 'hpx-sp-hide-pet', '隱藏 Pet');
    hidePetBtn.type = 'button';
    hidePetBtn.setAttribute('aria-label', '隱藏浮動 Pet');
    hidePetBtn.title = '隱藏浮動 Pet（可從側邊 pet 選單恢復）';
    hidePetBtn.addEventListener('click', function () {
      setPetVisibility(true, true);
    });
    const closeBtn = el('button', 'hpx-sp-close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', '關閉');
    closeBtn.addEventListener('click', function () { SettingsPanel.close(); });
    headerActions.appendChild(hidePetBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(headerActions);
    panel.appendChild(header);

    // Body
    const body = el('div', 'hpx-sp-body');
    body.appendChild(buildShortcutSection(draft));
    panel.appendChild(body);

    return panel;
  }

  // ── 主畫面左下角橫向控制列 ────────────────────────────────────

  function applySidebarCollapsed() {
    if (!sidebarControlsEl || !sidebarSettings) return;
    const collapsed = sidebarSettings.sidebarCollapsed === true;
    sidebarControlsEl.classList.toggle('hpx-sidebar-controls--collapsed', collapsed);
    sidebarControlsEl.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
    const collapseButton = sidebarControlsEl.querySelector('[data-hpx-sidebar-control="collapse"]');
    if (collapseButton) {
      collapseButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      collapseButton.setAttribute('aria-label', collapsed ? '展開設定列' : '收束設定列');
      collapseButton.title = collapsed ? '展開設定列' : '收束設定列';
    }
  }

  function refreshSidebarControls() {
    if (!sidebarControlsEl || !sidebarSettings) return;
    const modeButton = sidebarControlsEl.querySelector('[data-hpx-sidebar-control="mode"]');
    const modeState = sidebarControlsEl.querySelector('[data-hpx-sidebar-state="mode"]');
    const colorState = sidebarControlsEl.querySelector('[data-hpx-sidebar-state="color"]');
    const petButton = sidebarControlsEl.querySelector('[data-hpx-sidebar-control="pet"]');
    const petState = sidebarControlsEl.querySelector('[data-hpx-sidebar-state="pet"]');
    const hidden = sidebarSettings.petHidden === true;
    petHidden = hidden;
    if (modeButton) {
      modeButton.classList.toggle('hpx-sidebar-control--active', sidebarSettings.ultimateMode === true);
      modeButton.setAttribute('aria-pressed', sidebarSettings.ultimateMode ? 'true' : 'false');
      modeButton.setAttribute('aria-label', '簡單模式，' + (sidebarSettings.ultimateMode ? '已開啟' : '已關閉'));
      modeButton.title = sidebarSettings.ultimateMode ? '關閉簡單模式' : '開啟簡單模式';
    }
    if (modeState) modeState.textContent = sidebarSettings.ultimateMode ? 'ON' : 'OFF';
    if (colorState) {
      colorState.textContent = '';
      colorState.style.setProperty('--hpx-sidebar-color', normalizeAccent(sidebarSettings.accent));
    }
    const colorButton = sidebarControlsEl.querySelector('[data-hpx-sidebar-control="color"]');
    if (colorButton) {
      const color = normalizeAccent(sidebarSettings.accent).toUpperCase();
      colorButton.setAttribute('aria-label', '主題色：' + color);
      colorButton.title = '主題色：' + color;
    }
    if (petButton) {
      petButton.setAttribute('data-pet-hidden', hidden ? 'true' : 'false');
      const petName = petDefinition(sidebarSettings.pet).name;
      petButton.setAttribute('aria-label', '寵物：' + petName + (hidden ? '（目前已隱藏）' : ''));
      petButton.title = hidden ? '寵物目前已隱藏，點此調整' : '選擇寵物或調整顯示';
    }
    if (petState) petState.textContent = hidden ? '隱藏' : petDefinition(sidebarSettings.pet).name;
    applySidebarCollapsed();
  }

  function positionSidebarPopover() {
    if (!sidebarPopoverEl || !sidebarControlsEl) return;
    const kind = sidebarPopoverEl.getAttribute('data-kind');
    const anchorButton = kind
      ? sidebarControlsEl.querySelector('[data-hpx-sidebar-control="' + kind + '"]')
      : null;
    const anchor = (anchorButton || sidebarControlsEl).getBoundingClientRect();
    const width = sidebarPopoverEl.offsetWidth || 320;
    const height = sidebarPopoverEl.offsetHeight || 240;
    const viewportWidth = Math.max(0, window.innerWidth);
    const viewportHeight = Math.max(0, window.innerHeight);
    const margin = 8;
    const gap = 8;
    let left = anchor.left;
    const maxLeft = Math.max(margin, viewportWidth - width - margin);
    const maxTop = Math.max(margin, viewportHeight - height - margin);
    let top = anchor.top - height - gap;
    if (top < margin) top = anchor.bottom + gap;
    sidebarPopoverEl.style.left = Math.round(clamp(left, margin, maxLeft)) + 'px';
    sidebarPopoverEl.style.top = Math.round(clamp(top, margin, maxTop)) + 'px';
  }

  function positionSidebarControls() {
    if (!sidebarControlsEl || !sidebarControlsEl.parentNode) return;
    const collapsed = sidebarSettings && sidebarSettings.sidebarCollapsed === true;
    sidebarControlsEl.style.width = collapsed ? '44px' : 'auto';
    // Detached utility dock stays clear of the viewport edge and native navigation.
    sidebarControlsEl.style.left = '16px';
    sidebarControlsEl.style.top = 'auto';
    sidebarControlsEl.style.bottom = '16px';
    positionSidebarPopover();
  }

  function scheduleSidebarPosition() {
    if (!sidebarControlsEl || sidebarPositionFrame !== null) return;
    const raf = window.requestAnimationFrame || function (callback) { return setTimeout(callback, 0); };
    sidebarPositionFrame = raf(function () {
      sidebarPositionFrame = null;
      positionSidebarControls();
    });
  }

  function startSidebarObserver() {
    if (sidebarObserver || typeof MutationObserver !== 'function' || !document.body) return;
    sidebarObserver = new MutationObserver(function () { scheduleSidebarPosition(); });
    sidebarObserver.observe(document.body, { childList: true, subtree: true });
  }

  function toggleSidebarCollapse() {
    if (!sidebarSettings) return;
    sidebarSettings.sidebarCollapsed = sidebarSettings.sidebarCollapsed !== true;
    applySidebarCollapsed();
    if (sidebarSettings.sidebarCollapsed) {
      closeSidebarPopover();
      unbindOutsideClick();
    }
    persistSettings({ sidebarCollapsed: sidebarSettings.sidebarCollapsed });
    scheduleSidebarPosition();
  }

  function toggleSidebarUltimateMode() {
    if (!sidebarSettings) return;
    sidebarSettings.ultimateMode = sidebarSettings.ultimateMode !== true;
    if (NS.features.ultimateMode) NS.features.ultimateMode.setEnabled(sidebarSettings.ultimateMode);
    persistSettings({ ultimateMode: sidebarSettings.ultimateMode });
    refreshSidebarControls();
  }

  function makeSidebarControl(label, key, onClick) {
    const button = el('button', 'hpx-sidebar-control');
    button.type = 'button';
    button.setAttribute('data-hpx-sidebar-control', key);
    button.setAttribute('aria-label', label);
    const icon = el('span', 'hpx-sidebar-control-icon');
    icon.setAttribute('data-icon', key);
    icon.setAttribute('aria-hidden', 'true');
    const text = el('span', 'hpx-sidebar-control-label', label);
    const state = el('span', 'hpx-sidebar-control-state');
    state.setAttribute('data-hpx-sidebar-state', key);
    button.appendChild(icon);
    button.appendChild(text);
    button.appendChild(state);
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function mountSidebarControls(settings) {
    sidebarSettings = Object.assign({}, settings || DEFAULTS);
    if (sidebarControlsEl && sidebarControlsEl.parentNode) {
      refreshSidebarControls();
      scheduleSidebarPosition();
      return;
    }

    sidebarControlsEl = el('div', 'hpx-sidebar-controls');
    sidebarControlsEl.setAttribute('role', 'toolbar');
    sidebarControlsEl.setAttribute('aria-label', 'Halopsa 工作台控制');
    sidebarControlsEl.appendChild(makeSidebarControl('收合', 'collapse', toggleSidebarCollapse));
    sidebarControlsEl.appendChild(makeSidebarControl('快捷連結', 'links', function () {
      openSidebarPopover('links');
    }));
    sidebarControlsEl.appendChild(makeSidebarControl('簡單模式', 'mode', toggleSidebarUltimateMode));
    sidebarControlsEl.appendChild(makeSidebarControl('主題色', 'color', function () {
      openSidebarPopover('color');
    }));
    sidebarControlsEl.appendChild(makeSidebarControl('寵物', 'pet', function () {
      openSidebarPopover('pet');
    }));
    sidebarControlsEl.appendChild(makeSidebarControl('設定', 'settings', function () {
      closeSidebarPopover();
      if (panelEl) SettingsPanel.close();
      openOptionsPage();
    }));
    document.body.appendChild(sidebarControlsEl);
    refreshSidebarControls();
    startSidebarObserver();
    scheduleSidebarPosition();
  }

  function closeSidebarPopover() {
    if (sidebarControlsEl) sidebarControlsEl.querySelectorAll('[aria-expanded="true"]').forEach(function (button) {
      if (button.getAttribute('data-hpx-sidebar-control') !== 'collapse') button.setAttribute('aria-expanded', 'false');
    });
    if (sidebarPopoverEl && sidebarPopoverEl.parentNode) sidebarPopoverEl.parentNode.removeChild(sidebarPopoverEl);
    sidebarPopoverEl = null;
  }

  function openSidebarPopover(kind) {
    if (sidebarPopoverEl && sidebarPopoverEl.getAttribute('data-kind') === kind) {
      closeSidebarPopover();
      unbindOutsideClick();
      return;
    }
    closeSidebarPopover();
    if (panelEl) SettingsPanel.close();

    const draft = Object.assign({}, sidebarSettings || DEFAULTS);
    sidebarSettings = draft;
    const popover = el('div', 'hpx-sidebar-popover');
    const title = kind === 'pet' ? '寵物' : kind === 'links' ? '快捷連結' : '外觀與主題色';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', title);
    popover.setAttribute('data-kind', kind);

    const header = el('div', 'hpx-sidebar-popover-header');
    header.appendChild(el('span', 'hpx-sidebar-popover-title', title));
    const close = el('button', 'hpx-sidebar-popover-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '關閉');
    close.addEventListener('click', function () {
      closeSidebarPopover();
      unbindOutsideClick();
    });
    header.appendChild(close);
    popover.appendChild(header);

    const body = el('div', 'hpx-sidebar-popover-body');
    if (kind === 'links') {
      body.appendChild(buildShortcutSection(draft));
    } else if (kind === 'pet') {
      body.appendChild(buildPetSection(draft));
      body.appendChild(buildPetVisibilitySection(draft));
    } else {
      body.appendChild(buildThemeSection(draft));
      body.appendChild(buildColorSection(draft));
    }
    popover.appendChild(body);
    sidebarPopoverEl = popover;
    document.body.appendChild(popover);
    const trigger = sidebarControlsEl && sidebarControlsEl.querySelector('[data-hpx-sidebar-control="' + kind + '"]');
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    popover.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSidebarPopover();
        unbindOutsideClick();
        if (trigger) trigger.focus();
      }
    });
    positionSidebarControls();
    bindOutsideClick();
    const raf = window.requestAnimationFrame || function (callback) { return setTimeout(callback, 0); };
    raf(function () {
      if (sidebarPopoverEl === popover) {
        positionSidebarPopover();
        popover.classList.add('hpx-sidebar-popover--open');
        close.focus({ preventScroll: true });
      }
    });
  }

  // ── 浮動寵物 ───────────────────────────────────────────────

  function numberOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function applyPetPosition(pet, position) {
    const width = pet.offsetWidth || 96;
    const height = pet.offsetHeight || 104;
    const right = clamp(numberOr(position && position.right, 16), 8, window.innerWidth - width - 8);
    const bottom = clamp(numberOr(position && position.bottom, 16), 8, window.innerHeight - height - 8);
    pet.style.left = '';
    pet.style.top = '';
    pet.style.right = Math.round(right) + 'px';
    pet.style.bottom = Math.round(bottom) + 'px';
  }

  function currentPetPosition(pet) {
    const rect = pet.getBoundingClientRect();
    return {
      right: Math.round(Math.max(8, window.innerWidth - rect.right)),
      bottom: Math.round(Math.max(8, window.innerHeight - rect.bottom)),
    };
  }

  function overlayViewport() {
    const visual = window.visualViewport;
    const width = visual && Number.isFinite(visual.width) && visual.width > 0
      ? visual.width
      : window.innerWidth;
    const height = visual && Number.isFinite(visual.height) && visual.height > 0
      ? visual.height
      : window.innerHeight;
    return {
      left: 0,
      top: 0,
      right: Math.max(0, width),
      bottom: Math.max(0, height),
      width: Math.max(0, width),
      height: Math.max(0, height),
    };
  }

  function keepPanelInsideViewport(panel) {
    if (!panel || !panel.isConnected) return;
    const viewport = overlayViewport();
    const rect = panel.getBoundingClientRect();
    let left = Number.parseFloat(panel.style.left);
    let top = Number.parseFloat(panel.style.top);
    if (!Number.isFinite(left)) left = rect.left;
    if (!Number.isFinite(top)) top = rect.top;

    if (rect.left < viewport.left) left += viewport.left - rect.left;
    if (rect.right > viewport.right) left -= rect.right - viewport.right;
    if (rect.top < viewport.top) top += viewport.top - rect.top;
    if (rect.bottom > viewport.bottom) top -= rect.bottom - viewport.bottom;

    const maxLeft = Math.max(8, viewport.width - rect.width - 8);
    const maxTop = Math.max(8, viewport.height - rect.height - 8);
    panel.style.left = Math.round(clamp(left, 8, maxLeft)) + 'px';
    panel.style.top = Math.round(clamp(top, 8, maxTop)) + 'px';
  }

  function keepShortcutEditorVisible(input) {
    if (!input || !panelEl || !panelEl.isConnected || !panelEl.contains(input)) return;
    const panel = panelEl;
    const frame = window.requestAnimationFrame || function (callback) { return setTimeout(callback, 0); };
    frame(function () {
      if (!panelEl || panelEl !== panel || !input.isConnected) return;
      positionPanelAroundPet(panel);
      const panelRect = panel.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const padding = 12;
      if (inputRect.bottom > panelRect.bottom - padding) {
        panel.scrollTop += inputRect.bottom - (panelRect.bottom - padding);
      } else if (inputRect.top < panelRect.top + padding) {
        panel.scrollTop -= (panelRect.top + padding) - inputRect.top;
      }
      keepPanelInsideViewport(panel);
    });
  }

  function repositionFloatingUi() {
    if (petEl && petEl.isConnected && !petHidden) applyPetPosition(petEl, currentPetPosition(petEl));
    if (panelEl) positionPanelAroundPet(panelEl);
    scheduleSidebarPosition();
  }

  function bindViewportListeners() {
    if (viewportListenersBound) return;
    viewportListenersBound = true;
    window.addEventListener('resize', repositionFloatingUi);
    // 某些 Halo 版面會在內層容器捲動；用 capture 才能同步校正浮動面板。
    window.addEventListener('scroll', repositionFloatingUi, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', repositionFloatingUi);
      window.visualViewport.addEventListener('scroll', repositionFloatingUi);
    }
  }

  /**
   * 將面板放在 pet 旁邊；優先選擇能完整容納面板的一側，兩側都可用時選空間較大者。
   * 面板過寬或 viewport 太窄時仍會夾在 viewport 內，避免被裁切。
   */
  function positionPanelAroundPet(panel) {
    if (!panel || petHidden || !petEl || !petEl.isConnected) return;

    const petRect = petEl.getBoundingClientRect();
    const viewport = overlayViewport();
    const margin = 8;
    const gap = 12;
    // Quick Links 內容可能因編輯列變高；先把可用高度寫入 inline style，
    // 再量測高度，才能確保面板本身而不是只有內容被限制在視窗內。
    panel.style.setProperty('max-height', Math.max(120, Math.floor(viewport.height - margin * 2)) + 'px', 'important');
    panel.style.setProperty('overflow-y', 'auto', 'important');
    panel.style.setProperty('overscroll-behavior', 'contain');
    const panelWidth = panel.offsetWidth || 304;
    const panelHeight = panel.offsetHeight || 0;
    const viewportWidth = viewport.width;
    const viewportHeight = viewport.height;
    const maxLeft = Math.max(margin, viewportWidth - panelWidth - margin);
    const maxTop = Math.max(margin, viewportHeight - panelHeight - margin);
    const leftSpace = Math.max(0, petRect.left - margin);
    const rightSpace = Math.max(0, viewportWidth - petRect.right - margin);
    const fitsLeft = leftSpace >= panelWidth + gap;
    const fitsRight = rightSpace >= panelWidth + gap;

    let side;
    if (fitsLeft && !fitsRight) side = 'left';
    else if (fitsRight && !fitsLeft) side = 'right';
    else if (fitsLeft && fitsRight) side = leftSpace > rightSpace ? 'left' : 'right';
    else side = leftSpace > rightSpace ? 'left' : 'right';

    const desiredLeft = side === 'left'
      ? petRect.left - gap - panelWidth
      : petRect.right + gap;
    const desiredTop = petRect.top + (petRect.height - panelHeight) / 2;
    panel.style.right = '';
    panel.style.left = Math.round(clamp(desiredLeft, margin, maxLeft)) + 'px';
    panel.style.top = Math.round(clamp(desiredTop, margin, maxTop)) + 'px';
    panel.setAttribute('data-side', side);
    keepPanelInsideViewport(panel);
  }

  function buildPet(settings) {
    const pet = el('button', 'hpx-sp-pet');
    pet.type = 'button';
    pet.style.setProperty('border', '0', 'important');
    pet.style.setProperty('box-shadow', 'none', 'important');
    pet.setAttribute('aria-label', '開啟 Quick Links；可拖曳移動');
    pet.setAttribute('aria-expanded', 'false');
    pet.title = '點一下開啟 Quick Links，拖曳可移動';

    const shadow = el('span', 'hpx-sp-pet-shadow');
    activePetId = petDefinition(settings.pet).id;
    const img = createPetVisual(activePetId, false);
    const hint = el('span', 'hpx-sp-pet-hint');
    hint.textContent = 'Quick Links';
    pet.appendChild(shadow);
    pet.appendChild(img);
    pet.appendChild(hint);
    pet.setAttribute('data-pet', activePetId);

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragged = false;
    let suppressClick = false;

    pet.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || pointerId !== null) return;
      stopPetIdleAction();
      const rect = pet.getBoundingClientRect();
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      dragged = false;
      dragAtlasAnimation = '';
      pet.setPointerCapture(pointerId);
    });

    pet.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragged && Math.hypot(dx, dy) < 6) return;
      dragged = true;
      pet.classList.add('hpx-sp-pet-dragging');

      const maxLeft = window.innerWidth - pet.offsetWidth - 8;
      const maxTop = window.innerHeight - pet.offsetHeight - 8;
      pet.style.right = '';
      pet.style.bottom = '';
      pet.style.left = Math.round(clamp(startLeft + dx, 8, maxLeft)) + 'px';
      pet.style.top = Math.round(clamp(startTop + dy, 8, maxTop)) + 'px';
      if (panelEl) positionPanelAroundPet(panelEl);

      if (isAtlasPet(activePetId) && Math.hypot(dx, dy) >= 16) {
        const horizontal = Math.abs(dx) > Math.abs(dy) * 1.12;
        const vertical = Math.abs(dy) > Math.abs(dx) * 1.12;
        let animationName = 'running';
        if (horizontal) animationName = dx < 0 ? 'running-left' : 'running-right';
        else if (vertical) animationName = dy < 0 ? 'jumping' : 'waving';
        if (animationName !== dragAtlasAnimation) {
          dragAtlasAnimation = animationName;
          startAtlasAnimation(animationName);
        }
      }
    });

    function finishDrag(e) {
      if (e.pointerId !== pointerId) return;
      if (pet.hasPointerCapture(pointerId)) pet.releasePointerCapture(pointerId);
      pointerId = null;
      pet.classList.remove('hpx-sp-pet-dragging');
      dragAtlasAnimation = '';
      if (!dragged) {
        schedulePetIdleAction();
        return;
      }

      const position = currentPetPosition(pet);
      applyPetPosition(pet, position);
      if (panelEl) positionPanelAroundPet(panelEl);
      persistSettings({ petPosition: position });
      schedulePetIdleAction();
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);
    }

    pet.addEventListener('pointerup', finishDrag);
    pet.addEventListener('pointercancel', finishDrag);
    pet.addEventListener('click', function (e) {
      if (suppressClick) {
        e.preventDefault();
        suppressClick = false;
        return;
      }
      pet.classList.remove('hpx-sp-pet-poked');
      void pet.offsetWidth;
      pet.classList.add('hpx-sp-pet-poked');
      setTimeout(function () { pet.classList.remove('hpx-sp-pet-poked'); }, 520);
      SettingsPanel.toggle();
    });

    pet.addEventListener('pointerenter', function () {
      stopPetIdleAction();
      schedulePetIdleAction(1200);
    });
    pet.addEventListener('pointerleave', function () {
      if (pointerId === null) schedulePetIdleAction(900);
    });

    applyPetPosition(pet, settings.petPosition);
    if (img.tagName === 'IMG') {
      img.addEventListener('load', function () {
        if (!petHidden) applyPetPosition(pet, currentPetPosition(pet));
      });
    }
    return pet;
  }

  // ── 公開介面 ──────────────────────────────────────────────

  const SettingsPanel = {
    start: function () {
      if (petEl && petEl.isConnected) return;
      refreshPetDefinitions().then(function () {
        loadSettings(function (settings) {
          if (petEl && petEl.isConnected) return;
          petHidden = settings.petHidden === true;
          petEl = buildPet(settings);
          applyPetVisibility(petHidden);
          document.body.appendChild(petEl);
          applyPetPosition(petEl, settings.petPosition);
          setPetAppearance(settings.pet);
          mountSidebarControls(settings);
          bindViewportListeners();
          schedulePetIdleAction();
          if (!idleListenersBound) {
            idleListenersBound = true;
            document.addEventListener('visibilitychange', function () {
              if (document.hidden) stopPetIdleAction();
              else schedulePetIdleAction(1800);
            });
          }
        });
      });
    },

    open: function () {
      if (petHidden) return;
      unbindOutsideClick();
      closeSidebarPopover();
      if (panelEl && panelEl.parentNode) {
        panelEl.parentNode.removeChild(panelEl);
        panelEl = null;
      }
      refreshPetDefinitions().then(function () {
        loadSettings(function (s) {
          if (petHidden || s.petHidden === true) return;
          const panel = buildPanel(s);
          panelEl = panel;
          document.body.appendChild(panel);
          positionPanelAroundPet(panel);
          bindOutsideClick();
          requestAnimationFrame(function () {
            if (panelEl !== panel) return;
            panel.classList.add('hpx-sp-open');
            // 開啟動畫的 transform 會改變實際 rect，再校正一次避免底部溢出。
            positionPanelAroundPet(panel);
            if (petEl) {
              petEl.classList.add('hpx-sp-pet-active');
              petEl.setAttribute('aria-expanded', 'true');
            }
            schedulePetIdleAction(1200);
            requestAnimationFrame(function () {
              if (panelEl === panel) positionPanelAroundPet(panel);
            });
          });
        });
      });
    },

    close: function () {
      closeSidebarPopover();
      if (!panelEl) {
        unbindOutsideClick();
        return;
      }
      unbindOutsideClick();
      panelEl.classList.remove('hpx-sp-open');
      var p = panelEl;
      setTimeout(function () {
        if (p && p.parentNode && !p.classList.contains('hpx-sp-open')) {
          p.parentNode.removeChild(p);
        }
      }, 320);
      panelEl = null;
      if (petEl) {
        petEl.classList.remove('hpx-sp-pet-active');
        petEl.setAttribute('aria-expanded', 'false');
      }
      schedulePetIdleAction(1800);
    },

    toggle: function () {
      if (!panelEl) {
        SettingsPanel.open();
      } else {
        SettingsPanel.close();
      }
    },
  };

  NS.ui.settingsPanel = SettingsPanel;
})();
