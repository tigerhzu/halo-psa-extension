/**
 * settings-panel.js
 * 浮動設定面板（寵物 + 右側滑入面板）：主題 / 顏色快速切換。
 * 點寵物 → 面板從右側滑出；拖曳可移動；選色立即預覽；Save Settings 才真正寫入 storage。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const STORAGE_KEY = 'hpx_settings';

  const DEFAULTS = {
    theme: 'cute-ios',
    accent: '#3a82f7',
    opacity: 100,
    pet: 'soyo',
    petPosition: { right: 16, bottom: 16 },
  };
  const ACCENT_LIST = [
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

  let panelEl = null;
  let petEl = null;
  let activePetId = 'soyo';
  let petIdleTimer = null;
  let petActionTimer = null;
  let petSpritePlayback = null;
  let dragAtlasAnimation = '';
  let lastIdleAction = '';
  let idleListenersBound = false;
  const petImageUrls = {};
  let PET_DEFS = NS.core.petRegistry.builtIns();

  function getExtUrl(path) {
    try { return chrome.runtime.getURL(path); } catch (e) { return ''; }
  }

  function loadSettings(cb) {
    chrome.storage.local.get(STORAGE_KEY, function (data) {
      const settings = Object.assign({}, DEFAULTS, (data && data[STORAGE_KEY]) || {});
      if (settings.theme !== 'cute-ios' && settings.theme !== 'default') settings.theme = DEFAULTS.theme;
      settings.pet = petDefinition(settings.pet).id;
      cb(settings);
    });
  }

  function persistSettings(patch) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEY, function (data) {
        const merged = Object.assign({}, (data && data[STORAGE_KEY]) || {}, patch);
        chrome.storage.local.set({ [STORAGE_KEY]: merged }, function () { resolve(merged); });
      });
    });
  }

  // ── 面板建構 ────────────────────────────────────────────────

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
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
    petEl.setAttribute('aria-label', '開啟 Writing Helper 設定；目前寵物：' + definition.name + '；可拖曳移動');
    if (definition.atlas) startAtlasAnimation('idle');
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
    if (hint) hint.textContent = '設定';
    const image = petEl.querySelector('img.hpx-sp-pet-img');
    const urls = petUrls(activePetId);
    if (image && urls.image && image.src !== urls.image) image.src = urls.image;
    const atlas = petEl.querySelector('.hpx-sp-pet-atlas');
    if (atlas && NS.ui.petAnimator) NS.ui.petAnimator.paint(atlas, 'idle', 0);
  }

  function schedulePetIdleAction(delay) {
    if (petIdleTimer) clearTimeout(petIdleTimer);
    petIdleTimer = null;
    if (!petEl || !petEl.isConnected || document.hidden) return;
    if (isAtlasPet(activePetId) && !petSpritePlayback) startAtlasAnimation('idle');
    const wait = typeof delay === 'number' ? delay : 2800 + Math.round(Math.random() * 3200);
    petIdleTimer = setTimeout(function () {
      if (!petEl || !petEl.isConnected || document.hidden || petEl.classList.contains('hpx-sp-pet-dragging')) {
        schedulePetIdleAction(1600);
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
      if (hint) hint.textContent = actionHints[action] || '設定';
      if (definition.atlas) {
        startAtlasAnimation(action, {
          mode: 'once',
          onComplete: function () {
            if (petEl) {
              petEl.classList.remove('hpx-sp-pet-is-acting');
              petEl.removeAttribute('data-idle-action');
            }
            if (hint) hint.textContent = '設定';
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
        if (hint) hint.textContent = '設定';
        if (image && urls.image) image.src = urls.image;
        petActionTimer = null;
        schedulePetIdleAction();
      }, duration);
    }, wait);
  }

  function refreshThemeUi(draft) {
    if (!panelEl) return;
    panelEl.querySelectorAll('.hpx-sp-thumb').forEach(function (button) {
      button.classList.toggle('hpx-sp-on', button.getAttribute('data-t') === draft.theme);
    });
  }

  function buildThemeSection(draft) {
    const section = el('div', 'hpx-sp-section');
    const lbl = el('div', 'hpx-sp-label');
    lbl.textContent = 'Theme';
    section.appendChild(lbl);

    const row = el('div', 'hpx-sp-theme-row');

    const themes = [
      { id: 'cute-ios', name: 'Cute', bg: 'linear-gradient(135deg,#dbeafe,#ede9fe)' },
      { id: 'default',  name: 'Default', bg: '#e5e7eb' },
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
      });
      row.appendChild(thumb);
    });

    section.appendChild(row);
    return section;
  }

  function buildColorSection(draft) {
    const section = el('div', 'hpx-sp-section');
    const lbl = el('div', 'hpx-sp-label');
    lbl.textContent = 'Color';
    section.appendChild(lbl);

    const row = el('div', 'hpx-sp-color-row');

    ACCENT_LIST.forEach(function (accent) {
      const hex = accent.hex;
      const sw = el('button', 'hpx-sp-swatch' + (draft.accent === hex ? ' hpx-sp-on' : ''));
      sw.type = 'button';
      sw.style.setProperty('--sw', hex);
      sw.setAttribute('data-a', hex);
      sw.setAttribute('aria-label', accent.name);
      sw.title = accent.name;
      sw.addEventListener('click', function () {
        row.querySelectorAll('.hpx-sp-swatch').forEach(function (b) { b.classList.remove('hpx-sp-on'); });
        sw.classList.add('hpx-sp-on');
        draft.accent = hex;
        NS.ui.theme.applyAppearance(draft);
      });
      row.appendChild(sw);
    });

    section.appendChild(row);
    return section;
  }

  function buildPetSection(draft) {
    const section = el('div', 'hpx-sp-section');
    const label = el('div', 'hpx-sp-label');
    label.textContent = 'Pet';
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
      });
      row.appendChild(button);
    });

    section.appendChild(row);
    return section;
  }

  function buildPanel(initialSettings) {
    const draft = Object.assign({}, initialSettings);
    draft.pet = petDefinition(draft.pet).id;

    const panel = el('div', 'hpx-sp');

    // Header
    const header = el('div', 'hpx-sp-header');
    const title = el('span', 'hpx-sp-title');
    title.textContent = 'Writing Helper';
    const closeBtn = el('button', 'hpx-sp-close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', '關閉');
    closeBtn.addEventListener('click', function () { SettingsPanel.close(); });
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Body
    const body = el('div', 'hpx-sp-body');
    body.appendChild(buildThemeSection(draft));
    body.appendChild(buildColorSection(draft));
    body.appendChild(buildPetSection(draft));

    // Save
    const actions = el('div', 'hpx-sp-actions');
    const saveBtn = el('button', 'hpx-sp-save');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save Settings';
    const statusEl = el('span', 'hpx-sp-status');

    saveBtn.addEventListener('click', function () {
      persistSettings(draft).then(function () {
        SettingsPanel.close();
      });
    });

    actions.appendChild(saveBtn);
    actions.appendChild(statusEl);
    body.appendChild(actions);
    panel.appendChild(body);

    return panel;
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

  function buildPet(settings) {
    const pet = el('button', 'hpx-sp-pet');
    pet.type = 'button';
    pet.style.setProperty('border', '0', 'important');
    pet.style.setProperty('outline', '0', 'important');
    pet.style.setProperty('box-shadow', 'none', 'important');
    pet.setAttribute('aria-label', '開啟 Writing Helper 設定；可拖曳移動');
    pet.setAttribute('aria-expanded', 'false');
    pet.title = '點一下開啟設定，拖曳可移動';

    const shadow = el('span', 'hpx-sp-pet-shadow');
    activePetId = petDefinition(settings.pet).id;
    const img = createPetVisual(activePetId, false);
    const hint = el('span', 'hpx-sp-pet-hint');
    hint.textContent = '設定';
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
      img.addEventListener('load', function () { applyPetPosition(pet, currentPetPosition(pet)); });
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
          petEl = buildPet(settings);
          document.body.appendChild(petEl);
          applyPetPosition(petEl, settings.petPosition);
          setPetAppearance(settings.pet);
          schedulePetIdleAction();
          window.addEventListener('resize', function () {
            if (petEl && petEl.isConnected) applyPetPosition(petEl, currentPetPosition(petEl));
          });
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
      if (panelEl && panelEl.parentNode) {
        panelEl.parentNode.removeChild(panelEl);
        panelEl = null;
      }
      refreshPetDefinitions().then(function () {
        loadSettings(function (s) {
          panelEl = buildPanel(s);
          document.body.appendChild(panelEl);
          requestAnimationFrame(function () {
            panelEl.classList.add('hpx-sp-open');
            if (petEl) {
              petEl.classList.add('hpx-sp-pet-active');
              petEl.setAttribute('aria-expanded', 'true');
            }
            schedulePetIdleAction(1200);
          });
        });
      });
    },

    close: function () {
      if (!panelEl) return;
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
