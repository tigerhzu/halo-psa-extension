/**
 * Custom Category picker.
 *
 * The user interacts only with the Extension-owned modal. HaloPSA's native
 * rc-tree-select remains off-screen as a data/selection bridge so the final
 * choice still flows through Halo's React state and normal save behaviour.
 */
(function () {
  'use strict';

  const NS = window.__HPX;
  const cfg = NS.config.selectors.CATEGORY_PICKER;
  const BUTTON_CLASS = 'hpx-category-picker-button';
  const FIELD_CLASS = 'hpx-category-picker-field';
  const BODY_CLASS = 'hpx-category-modal-open';
  const LAYER_CLASS = 'hpx-category-modal-layer';
  const CONTROL_MARKER = 'data-hpx-category-bridge-control';
  const POPUP_MARKER = 'data-hpx-category-bridge-popup';
  const SETTINGS_KEY = 'hpx_settings';
  const FAVORITES_FIELD = 'categoryFavorites';
  const MAX_FAVORITES = 40;
  const MAX_ALIAS_LENGTH = 48;

  let started = false;
  let observer = null;
  let reconcileQueued = false;
  let openSequence = 0;
  let active = null;
  let favoritesPersistQueue = Promise.resolve();

  function safeQuery(root, selector) {
    if (!root || !root.querySelector) return null;
    try { return root.querySelector(selector); } catch (error) { return null; }
  }

  function safeQueryAll(root, selector) {
    if (!root || !root.querySelectorAll) return [];
    try { return Array.prototype.slice.call(root.querySelectorAll(selector)); } catch (error) { return []; }
  }

  function safeClosest(node, selector) {
    if (!node || !node.closest) return null;
    try { return node.closest(selector); } catch (error) { return null; }
  }

  function isTicketPath() {
    return /^\/(?:tickets|newticket)(?:\/|$)/i.test(String(window.location.pathname || ''));
  }

  function fieldForLabel(label) {
    const field = safeClosest(label, cfg.FIELD_CONTAINER_SELECTOR);
    return field && field.contains(label) ? field : null;
  }

  function favoriteKey(pathTitles) {
    return (Array.isArray(pathTitles) ? pathTitles : []).join('\u001f');
  }

  function normalizeAlias(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_ALIAS_LENGTH);
  }

  function normalizeFavorites(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).map(function (item) {
      const source = Array.isArray(item) ? { pathTitles: item } : item;
      if (!source || !Array.isArray(source.pathTitles)) return null;
      const pathTitles = source.pathTitles.map(function (title) {
        return String(title || '').replace(/\s+/g, ' ').trim();
      }).filter(Boolean);
      const key = favoriteKey(pathTitles);
      if (!key || seen.has(key)) return null;
      seen.add(key);
      const favorite = {
        pathTitles: pathTitles,
        searchOnly: source.searchOnly === true,
      };
      const alias = normalizeAlias(source.alias);
      if (alias) favorite.alias = alias;
      return favorite;
    }).filter(Boolean).slice(0, MAX_FAVORITES);
  }

  function loadFavorites() {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve([]);
        return;
      }
      chrome.storage.local.get(SETTINGS_KEY, function (data) {
        const settings = (data && data[SETTINGS_KEY]) || {};
        resolve(normalizeFavorites(settings[FAVORITES_FIELD]));
      });
    });
  }

  function persistFavorites(favorites) {
    const snapshot = normalizeFavorites(favorites);
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return Promise.resolve(snapshot);
    }
    favoritesPersistQueue = favoritesPersistQueue.then(function () {
      return new Promise(function (resolve) {
        chrome.storage.local.get(SETTINGS_KEY, function (data) {
          const merged = Object.assign({}, (data && data[SETTINGS_KEY]) || {}, {
            [FAVORITES_FIELD]: snapshot,
          });
          chrome.storage.local.set({ [SETTINGS_KEY]: merged }, function () { resolve(snapshot); });
        });
      });
    });
    return favoritesPersistQueue;
  }

  function waitFor(find, sequence, timeoutMs) {
    const deadline = Date.now() + (timeoutMs == null ? cfg.NATIVE_WAIT_MS : timeoutMs);
    return new Promise(function (resolve) {
      function check() {
        if (sequence !== openSequence || !isTicketPath()) {
          resolve(null);
          return;
        }
        const value = find();
        if (value) {
          resolve(value);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(null);
          return;
        }
        window.setTimeout(check, 16);
      }
      check();
    });
  }

  function findNativePopup() {
    const popups = safeQueryAll(document, cfg.NATIVE_POPUP_SELECTOR);
    for (let index = popups.length - 1; index >= 0; index -= 1) {
      const popup = popups[index];
      if (!popup.isConnected || !safeQuery(popup, cfg.NATIVE_TREE_SELECTOR)) continue;
      if (popup.classList.contains(cfg.NATIVE_POPUP_HIDDEN_CLASS)) continue;
      try {
        const style = window.getComputedStyle(popup);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
      } catch (error) { /* a connected native popup is still usable */ }
      return popup;
    }
    return null;
  }

  function findNativePopupWithNodes() {
    const popup = findNativePopup();
    return popup && safeQueryAll(popup, cfg.NATIVE_NODE_SELECTOR).length ? popup : null;
  }

  function dispatchMouseDown(target) {
    if (!target || !target.dispatchEvent) return;
    try {
      if (typeof window.PointerEvent === 'function') {
        target.dispatchEvent(new window.PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons: 1,
        }));
      }
      target.dispatchEvent(new window.MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        view: window,
      }));
    } catch (error) {
      // Old Chromium builds still have HTMLElement.click() as the next fallback.
    }
  }

  function dispatchArrowDown(combo) {
    if (!combo || !combo.dispatchEvent) return;
    try {
      combo.dispatchEvent(new window.KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        which: 40,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    } catch (error) { /* combo.click() remains the preceding fallback */ }
  }

  /**
   * rc-tree-select opens from mousedown on its selector, not from the input's
   * synthetic click alone. Try the real event path first, then retain click and
   * keyboard fallbacks for Halo versions with different rc-select wiring.
   */
  async function openNativePopup(control, combo, sequence) {
    let popup = findNativePopup();
    if (popup) return popup;

    try { combo.focus({ preventScroll: true }); } catch (error) { combo.focus(); }
    dispatchMouseDown(safeQuery(control, cfg.NATIVE_TRIGGER_SELECTOR) || combo);
    popup = await waitFor(findNativePopup, sequence, 600);
    if (popup) return popup;

    combo.click();
    popup = await waitFor(findNativePopup, sequence, 600);
    if (popup) return popup;

    dispatchArrowDown(combo);
    return waitFor(findNativePopup, sequence, cfg.NATIVE_WAIT_MS);
  }

  function markNativeBridge(control, popup) {
    if (control) control.setAttribute(CONTROL_MARKER, 'true');
    if (popup) {
      popup.setAttribute(POPUP_MARKER, 'true');
      popup.setAttribute('aria-hidden', 'true');
    }
  }

  function unmarkNativeBridge(control, popup) {
    if (control) control.removeAttribute(CONTROL_MARKER);
    if (popup) {
      popup.removeAttribute(POPUP_MARKER);
      popup.removeAttribute('aria-hidden');
    }
  }

  function closeNativeBridge(combo, control, popup) {
    try {
      if (combo && combo.blur) combo.blur();
    } catch (error) {
      // Halo may already have unmounted the input while the custom picker closes.
    }
    // Keep the native popup hidden until rc-tree-select has processed the blur.
    window.setTimeout(function () { unmarkNativeBridge(control, popup); }, 0);
  }

  function stopBridgeBlur(event) {
    if (active && active.shell && event.relatedTarget && active.shell.contains(event.relatedTarget)) {
      event.stopPropagation();
    }
  }

  function setNativeInputValue(input, value) {
    if (!input) return;
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(input, value);
    else input.value = value;
    try {
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: value,
        inputType: 'insertText',
      }));
    } catch (error) {
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function showError(message) {
    if (NS.ui.toast && typeof NS.ui.toast.show === 'function') {
      NS.ui.toast.show(message || '無法開啟 Category 選擇器，請再試一次。', { type: 'error' });
    }
  }

  function cleanup(options) {
    options = options || {};
    openSequence += 1;
    if (!active) return;

    const previous = active;
    active = null;
    if (previous.nativeObserver) previous.nativeObserver.disconnect();
    if (previous.refreshTimer) window.clearTimeout(previous.refreshTimer);
    if (previous.combo) {
      previous.combo.removeEventListener('blur', stopBridgeBlur, true);
      previous.combo.removeEventListener('focusout', stopBridgeBlur, true);
    }
    if (options.closeNative !== false) {
      closeNativeBridge(previous.combo, previous.control, previous.popup);
    } else {
      unmarkNativeBridge(previous.control, previous.popup);
    }
    if (previous.layer && previous.layer.parentNode) previous.layer.parentNode.removeChild(previous.layer);
    if (previous.button) {
      previous.button.disabled = false;
      previous.button.removeAttribute('aria-busy');
      previous.button.setAttribute('aria-expanded', 'false');
    }
    if (document.body) document.body.classList.remove(BODY_CLASS);
  }

  function createModal() {
    const layer = document.createElement('div');
    layer.className = LAYER_CLASS;

    const backdrop = document.createElement('div');
    backdrop.className = 'hpx-category-modal-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      cleanup();
    });
    layer.appendChild(backdrop);

    const shell = document.createElement('div');
    shell.className = 'hpx-category-shell';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-label', '選擇 Category');
    ['mousedown', 'pointerdown', 'touchstart'].forEach(function (eventName) {
      shell.addEventListener(eventName, function (event) { event.stopPropagation(); });
    });

    const favorites = document.createElement('aside');
    favorites.id = 'hpx-category-favorites';
    favorites.className = 'hpx-category-favorites';
    favorites.setAttribute('role', 'region');
    favorites.setAttribute('aria-labelledby', 'hpx-category-favorites-title');

    const favoritesHeader = document.createElement('header');
    favoritesHeader.className = 'hpx-category-favorites-header';
    const favoritesTitle = document.createElement('h3');
    favoritesTitle.id = 'hpx-category-favorites-title';
    favoritesTitle.textContent = '★ 我的最愛';
    favoritesHeader.appendChild(favoritesTitle);
    favorites.appendChild(favoritesHeader);

    const favoritesList = document.createElement('div');
    favoritesList.className = 'hpx-category-favorites-list';
    favoritesList.addEventListener('dragover', function (event) {
      if (!active || !active.favoriteDragging || safeClosest(event.target, '.hpx-category-favorite-item')) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const items = safeQueryAll(favoritesList, '.hpx-category-favorite-item');
      const last = items[items.length - 1];
      if (!last || event.clientY >= last.getBoundingClientRect().bottom) {
        if (last && active.favoriteDragging !== last) favoritesList.appendChild(active.favoriteDragging);
        clearFavoriteDragIndicators();
        if (last && active.favoriteDragging !== last) last.classList.add('hpx-category-favorite-drag-after');
      }
    });
    favoritesList.addEventListener('drop', function (event) {
      if (!active || !active.favoriteDragging) return;
      event.preventDefault();
      event.stopPropagation();
      finishFavoriteDrag();
    });
    favorites.appendChild(favoritesList);
    shell.appendChild(favorites);

    const favoritesHandle = document.createElement('button');
    favoritesHandle.type = 'button';
    favoritesHandle.className = 'hpx-category-favorites-handle';
    favoritesHandle.setAttribute('aria-controls', favorites.id);
    favoritesHandle.setAttribute('aria-expanded', 'true');
    favoritesHandle.setAttribute('aria-label', '收合我的最愛');
    favoritesHandle.title = '收合我的最愛';
    favoritesHandle.innerHTML = '<span aria-hidden="true">‹</span>';
    favoritesHandle.addEventListener('click', function () {
      const collapsed = shell.classList.toggle('hpx-category-shell--favorites-collapsed');
      favoritesHandle.setAttribute('aria-expanded', String(!collapsed));
      favoritesHandle.setAttribute('aria-label', collapsed ? '展開我的最愛' : '收合我的最愛');
      favoritesHandle.title = collapsed ? '展開我的最愛' : '收合我的最愛';
      favoritesHandle.innerHTML = collapsed
        ? '<span aria-hidden="true">★</span>'
        : '<span aria-hidden="true">‹</span>';
    });
    shell.appendChild(favoritesHandle);

    const dialog = document.createElement('section');
    dialog.className = 'hpx-category-dialog';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'hpx-category-dialog-close';
    closeButton.setAttribute('aria-label', '關閉 Category 選擇器');
    closeButton.title = '關閉';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      cleanup();
    });
    dialog.appendChild(closeButton);

    const toolbar = document.createElement('header');
    toolbar.className = 'hpx-category-toolbar';

    const searchWrap = document.createElement('label');
    searchWrap.className = 'hpx-category-search';
    const searchIcon = document.createElement('span');
    searchIcon.className = 'hpx-category-search-icon';
    searchIcon.setAttribute('aria-hidden', 'true');
    searchIcon.textContent = '⌕';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = '搜尋 Category…';
    search.setAttribute('aria-label', '搜尋 Category');
    search.setAttribute('autocomplete', 'off');
    search.setAttribute('spellcheck', 'false');
    search.disabled = true;
    const clearSearch = document.createElement('button');
    clearSearch.type = 'button';
    clearSearch.className = 'hpx-category-search-clear';
    clearSearch.setAttribute('aria-label', '清除 Category 搜尋');
    clearSearch.title = '清除搜尋';
    clearSearch.textContent = '×';
    clearSearch.hidden = true;
    searchWrap.append(searchIcon, search, clearSearch);

    const status = document.createElement('div');
    status.id = 'hpx-category-search-status';
    status.className = 'hpx-category-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    search.setAttribute('aria-describedby', status.id);
    status.textContent = '正在載入 Category…';

    function applySearch() {
      const value = search.value;
      clearSearch.hidden = !value;
      if (!active || active.search !== search || !active.combo) return;
      active.status.textContent = value.trim() ? '正在搜尋…' : '正在顯示全部分類…';
      active.entryModels = [];
      setNativeInputValue(active.combo, value);
      scheduleNativeRefresh(160);
    }

    search.addEventListener('input', applySearch);
    clearSearch.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      search.value = '';
      applySearch();
      search.focus();
    });

    toolbar.append(searchWrap, status);
    dialog.appendChild(toolbar);

    const tree = document.createElement('div');
    tree.className = 'hpx-category-tree';
    tree.setAttribute('role', 'tree');
    tree.setAttribute('aria-label', 'Category 分類');
    dialog.appendChild(tree);

    shell.appendChild(dialog);
    layer.appendChild(shell);
    document.body.appendChild(layer);
    document.body.classList.add(BODY_CLASS);
    return {
      layer: layer,
      shell: shell,
      dialog: dialog,
      search: search,
      status: status,
      clearSearch: clearSearch,
      tree: tree,
      favorites: favorites,
      favoritesList: favoritesList,
      favoritesHandle: favoritesHandle,
    };
  }

  function nativeTranslateY(element) {
    if (!element) return 0;
    const inline = String(element.style && element.style.transform || '');
    const translated = inline.match(/translateY\((-?[\d.]+)px\)/i);
    if (translated) return Number(translated[1]) || 0;
    try {
      const computed = String(window.getComputedStyle(element).transform || '');
      const matrix = computed.match(/^matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*(-?[\d.]+)\)$/);
      if (matrix) return Number(matrix[1]) || 0;
    } catch (error) { /* inline transform is enough for Halo's virtual list */ }
    return 0;
  }

  function collectVisibleNativeEntries() {
    if (!active || !active.popup) return [];
    const searching = !!active.search.value.trim();
    const inner = safeQuery(active.popup, cfg.NATIVE_SCROLL_INNER_SELECTOR);
    const translateY = nativeTranslateY(inner);
    return safeQueryAll(active.popup, cfg.NATIVE_NODE_SELECTOR).map(function (node) {
      const titleElement = safeQuery(node, cfg.NATIVE_TITLE_SELECTOR);
      const title = String(titleElement && titleElement.textContent || '').replace(/\s+/g, ' ').trim();
      if (!title) return null;
      const rawDepth = safeQueryAll(node, cfg.NATIVE_INDENT_SELECTOR).length;
      const depth = searching ? 0 : rawDepth;
      const switcher = safeQuery(node, cfg.NATIVE_SWITCHER_SELECTOR);
      const content = safeQuery(node, cfg.NATIVE_CONTENT_SELECTOR);
      const expandable = !!switcher && !switcher.classList.contains(cfg.NATIVE_SWITCHER_NOOP_CLASS);
      const expanded = expandable && switcher.classList.contains(cfg.NATIVE_SWITCHER_OPEN_CLASS);
      return {
        node: node,
        switcher: switcher,
        content: content,
        title: title,
        depth: depth,
        expandable: expandable,
        expanded: expanded,
        nativeTop: Math.max(0, Math.round(translateY + (Number(node.offsetTop) || 0))),
      };
    }).filter(Boolean);
  }

  function withNativePaths(entries) {
    const stack = [];
    return entries.sort(function (a, b) { return a.nativeTop - b.nativeTop; }).map(function (entry, index) {
      stack[entry.depth] = entry.title;
      stack.length = entry.depth + 1;
      entry.pathTitles = stack.slice();
      entry.key = favoriteKey(entry.pathTitles) + '\u001f' + entry.nativeTop + '\u001f' + index;
      return entry;
    });
  }

  function scheduleNativeRefresh(delay) {
    if (!active || active.scanningNative || active.revealingNative) return;
    if (active.refreshTimer) window.clearTimeout(active.refreshTimer);
    active.refreshTimer = window.setTimeout(function () {
      if (active) refreshNativeEntries();
    }, delay == null ? 80 : delay);
  }

  async function refreshNativeEntries() {
    if (!active || !active.popup) return [];
    const sequence = active.sequence;
    const scanToken = active.scanToken + 1;
    active.scanToken = scanToken;
    active.scanningNative = true;
    if (active.refreshTimer) window.clearTimeout(active.refreshTimer);
    active.refreshTimer = null;

    const holder = safeQuery(active.popup, cfg.NATIVE_SCROLL_HOLDER_SELECTOR);
    if (!holder) {
      active.scanningNative = false;
      active.entryModels = withNativePaths(collectVisibleNativeEntries());
      renderTree();
      return active.entryModels;
    }

    active.nativeHolder = holder;
    const restoreTop = Number(holder.scrollTop) || 0;
    const maximum = Math.max(0, holder.scrollHeight - holder.clientHeight);
    // rc-virtual-list keeps a generous overscan buffer. A near-page step still
    // overlaps mounted rows while cutting the number of render waits sharply.
    const step = Math.max(100, Math.floor(holder.clientHeight * 0.9));
    const positions = [];
    for (let top = 0; top < maximum; top += step) positions.push(top);
    positions.push(maximum);
    const seen = new Map();

    for (let index = 0; index < positions.length; index += 1) {
      if (!active || sequence !== active.sequence || active.scanToken !== scanToken) return [];
      holder.scrollTop = positions[index];
      try { holder.dispatchEvent(new Event('scroll')); } catch (error) { /* setting scrollTop normally dispatches */ }
      await new Promise(function (resolve) {
        window.setTimeout(resolve, cfg.VIRTUAL_SCAN_DELAY_MS);
      });
      collectVisibleNativeEntries().forEach(function (entry) {
        const key = entry.nativeTop + '\u001f' + entry.depth + '\u001f' + entry.title;
        seen.set(key, {
          title: entry.title,
          depth: entry.depth,
          expandable: entry.expandable,
          expanded: entry.expanded,
          nativeTop: entry.nativeTop,
        });
      });
    }

    if (!active || sequence !== active.sequence || active.scanToken !== scanToken) return [];
    holder.scrollTop = Math.min(restoreTop, Math.max(0, holder.scrollHeight - holder.clientHeight));
    try { holder.dispatchEvent(new Event('scroll')); } catch (error) { /* no-op */ }
    await new Promise(function (resolve) {
      window.setTimeout(resolve, cfg.VIRTUAL_SCAN_DELAY_MS);
    });
    if (!active || sequence !== active.sequence || active.scanToken !== scanToken) return [];
    active.entryModels = withNativePaths(Array.from(seen.values()));
    active.scanningNative = false;
    renderTree();
    return active.entryModels;
  }

  async function revealNativeEntry(entry) {
    if (!active || !entry) return null;
    const sequence = active.sequence;
    const holder = active.nativeHolder || safeQuery(active.popup, cfg.NATIVE_SCROLL_HOLDER_SELECTOR);
    if (!holder) {
      return collectVisibleNativeEntries().find(function (candidate) {
        return candidate.title === entry.title && candidate.depth === entry.depth;
      }) || null;
    }

    active.revealingNative = true;
    const targetTop = Math.max(0, entry.nativeTop - Math.floor(holder.clientHeight / 2));
    holder.scrollTop = Math.min(targetTop, Math.max(0, holder.scrollHeight - holder.clientHeight));
    try { holder.dispatchEvent(new Event('scroll')); } catch (error) { /* no-op */ }
    const current = await waitFor(function () {
      const candidates = collectVisibleNativeEntries().filter(function (candidate) {
        return candidate.title === entry.title && candidate.depth === entry.depth;
      }).sort(function (a, b) {
        return Math.abs(a.nativeTop - entry.nativeTop) - Math.abs(b.nativeTop - entry.nativeTop);
      });
      return candidates[0] || null;
    }, sequence, 900);
    if (active && sequence === active.sequence) active.revealingNative = false;
    return current;
  }

  async function refreshUntilEntry(find, sequence, attempts) {
    let value = find();
    if (value) return value;
    const maximumAttempts = attempts == null ? 4 : attempts;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      await refreshNativeEntries();
      if (!active || sequence !== active.sequence) return null;
      value = find();
      if (value) return value;
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 45 + (attempt * 35));
      });
    }
    return null;
  }

  function installNativeObserver(popup) {
    if (!active) return;
    if (active.nativeObserver) active.nativeObserver.disconnect();
    active.nativeObserver = new MutationObserver(function () { scheduleNativeRefresh(32); });
    active.nativeObserver.observe(popup, { childList: true, subtree: true });
  }

  async function ensureNativeBridge() {
    if (!active || !active.combo || !active.combo.isConnected) return false;
    const sequence = active.sequence;
    let popup = findNativePopup();
    if (active.combo.getAttribute('aria-expanded') !== 'true') {
      // Reopen at the real field position for the same reason as the initial
      // mount, then move the new popup off-screen again after it exists.
      unmarkNativeBridge(active.control, active.popup);
      popup = await openNativePopup(active.control, active.combo, sequence);
    }
    if (!popup) popup = await waitFor(findNativePopup, sequence);
    if (!active || sequence !== active.sequence || !popup) return false;
    if (popup !== active.popup) {
      unmarkNativeBridge(null, active.popup);
      active.popup = popup;
      markNativeBridge(active.control, popup);
      installNativeObserver(popup);
    }
    markNativeBridge(active.control, active.popup);
    return true;
  }

  async function toggleEntry(entry) {
    if (!active || !entry || !entry.expandable || entry.pending) return;
    const sequence = active.sequence;
    const previousExpanded = entry.expanded;
    const previousModels = active.entryModels.slice();
    entry.expanded = !previousExpanded;
    entry.pending = true;
    if (previousExpanded) {
      const entryIndex = active.entryModels.indexOf(entry);
      if (entryIndex >= 0) {
        let endIndex = entryIndex + 1;
        while (endIndex < active.entryModels.length
            && active.entryModels[endIndex].depth > entry.depth) endIndex += 1;
        active.entryModels = active.entryModels.slice(0, entryIndex + 1)
          .concat(active.entryModels.slice(endIndex));
      }
    }
    renderTree();
    if (active && sequence === active.sequence) {
      active.status.textContent = entry.expanded
        ? '正在展開「' + entry.title + '」…'
        : '正在收合「' + entry.title + '」…';
    }

    try {
      if (!(await ensureNativeBridge()) || !active || sequence !== active.sequence) throw new Error('bridge');
      const current = await revealNativeEntry(entry);
      if (!current || !current.switcher) throw new Error('switcher');
      current.switcher.click();
      await refreshNativeEntries();
    } catch (error) {
      if (!active || sequence !== active.sequence) return;
      active.entryModels = previousModels;
      entry.expanded = previousExpanded;
      entry.pending = false;
      renderTree();
      showError('Category 展開失敗，請再試一次。');
    }
  }

  async function selectEntry(entry) {
    if (!active || !(await ensureNativeBridge())) return;
    const current = await revealNativeEntry(entry);
    if (!current || !current.content) return;
    const selectedTitle = entry.pathTitles.join(' › ');
    active.status.textContent = '正在套用「' + selectedTitle + '」…';
    active.dialog.classList.add('hpx-category-dialog--applying');
    current.content.click();
    window.setTimeout(function () {
      cleanup({ closeNative: false });
      if (NS.ui.toast && typeof NS.ui.toast.show === 'function') {
        NS.ui.toast.show('Category 已套用：' + selectedTitle, { type: 'success' });
      }
    }, 0);
  }

  function findFavorite(pathTitles) {
    if (!active) return null;
    const key = favoriteKey(pathTitles);
    return active.favorites.find(function (favorite) {
      return favoriteKey(favorite.pathTitles) === key;
    }) || null;
  }

  function findEntryByPath(pathTitles) {
    const key = favoriteKey(pathTitles);
    return (active && active.entryModels || []).find(function (entry) {
      return favoriteKey(entry.pathTitles) === key;
    }) || null;
  }

  function updateFavoriteAlias(favorite, value) {
    if (!active || !favorite || !Array.isArray(favorite.pathTitles)) return;
    const key = favoriteKey(favorite.pathTitles);
    const target = active.favorites.find(function (item) {
      return favoriteKey(item.pathTitles) === key;
    });
    if (!target) return;

    const alias = normalizeAlias(value);
    if (alias) target.alias = alias;
    else delete target.alias;
    active.favorites = normalizeFavorites(active.favorites);
    renderFavorites();
    persistFavorites(active.favorites);
    if (NS.ui.toast && typeof NS.ui.toast.show === 'function') {
      NS.ui.toast.show(alias ? '已設定分類別名：' + alias : '已清除分類別名', {
        type: 'success',
      });
    }
  }

  function editFavoriteAlias(favorite, item) {
    if (!active || !favorite || !item) return;

    const editor = document.createElement('form');
    editor.className = 'hpx-category-favorite-editor';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = favorite.alias || '';
    input.maxLength = MAX_ALIAS_LENGTH;
    input.placeholder = '輸入中文或自訂別名';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', '分類別名');

    const actions = document.createElement('div');
    actions.className = 'hpx-category-favorite-editor-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'hpx-category-favorite-editor-cancel';
    cancel.textContent = '取消';

    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'hpx-category-favorite-editor-save';
    save.textContent = '儲存';

    actions.appendChild(cancel);
    actions.appendChild(save);
    editor.appendChild(input);
    editor.appendChild(actions);
    item.replaceChildren(editor);

    let closed = false;
    function closeWithoutSaving() {
      if (closed) return;
      closed = true;
      renderFavorites();
    }
    function saveAlias() {
      if (closed) return;
      closed = true;
      updateFavoriteAlias(favorite, input.value);
    }

    editor.addEventListener('submit', function (event) {
      event.preventDefault();
      event.stopPropagation();
      saveAlias();
    });
    editor.addEventListener('click', function (event) { event.stopPropagation(); });
    cancel.addEventListener('click', closeWithoutSaving);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWithoutSaving();
      }
    });
    window.setTimeout(function () {
      if (active && item.isConnected) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  function favoriteOrderSignature(favorites) {
    return (Array.isArray(favorites) ? favorites : []).map(function (favorite) {
      return favoriteKey(favorite && favorite.pathTitles);
    }).join('\u001e');
  }

  function clearFavoriteDragIndicators() {
    if (!active || !active.favoritesList) return;
    safeQueryAll(active.favoritesList, '.hpx-category-favorite-item').forEach(function (item) {
      item.classList.remove('hpx-category-favorite-drag-over');
      item.classList.remove('hpx-category-favorite-drag-after');
    });
  }

  function readFavoriteDomOrder() {
    if (!active || !active.favoritesList) return [];
    const byKey = new Map();
    active.favorites.forEach(function (favorite) {
      byKey.set(favoriteKey(favorite.pathTitles), favorite);
    });

    const ordered = [];
    const seen = new Set();
    safeQueryAll(active.favoritesList, '.hpx-category-favorite-item').forEach(function (item) {
      const key = item.getAttribute('data-hpx-category-favorite-key');
      const favorite = byKey.get(key);
      if (!favorite || seen.has(key)) return;
      seen.add(key);
      ordered.push(favorite);
    });

    // Keep any item that was not represented in the DOM, so a transient browser
    // drag event can never discard a saved favorite.
    active.favorites.forEach(function (favorite) {
      const key = favoriteKey(favorite.pathTitles);
      if (seen.has(key)) return;
      seen.add(key);
      ordered.push(favorite);
    });
    return normalizeFavorites(ordered);
  }

  function finishFavoriteDrag() {
    if (!active || !active.favoriteDragging) return;
    const startOrder = active.favoriteDragStartOrder || [];
    const nextOrder = readFavoriteDomOrder();
    const changed = favoriteOrderSignature(startOrder) !== favoriteOrderSignature(nextOrder);
    const dragged = active.favoriteDragging;
    dragged.classList.remove('hpx-category-favorite-dragging');
    dragged.setAttribute('aria-grabbed', 'false');
    clearFavoriteDragIndicators();
    active.favoriteDragging = null;
    active.favoriteDragStartOrder = null;

    if (!changed) return;
    active.favorites = nextOrder;
    persistFavorites(active.favorites);
    if (NS.ui.toast && typeof NS.ui.toast.show === 'function') {
      NS.ui.toast.show('已調整我的最愛順序', { type: 'success' });
    }
  }

  function startFavoriteDrag(item, favorite, event) {
    if (!active || !item || active.favoriteDragging) return;
    active.favoriteDragging = item;
    active.favoriteDragStartOrder = active.favorites.slice();
    item.classList.add('hpx-category-favorite-dragging');
    item.setAttribute('aria-grabbed', 'true');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', favorite.pathTitles.join(' › '));
    }
  }

  function dragOverFavorite(item, event) {
    if (!active || !active.favoriteDragging) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const dragging = active.favoriteDragging;
    if (item === dragging) {
      clearFavoriteDragIndicators();
      return;
    }

    const rect = item.getBoundingClientRect();
    const insertBefore = event.clientY < rect.top + rect.height / 2;
    const reference = insertBefore ? item : item.nextElementSibling;
    if (reference !== dragging) {
      active.favoritesList.insertBefore(dragging, reference || null);
    }
    clearFavoriteDragIndicators();
    item.classList.add(insertBefore
      ? 'hpx-category-favorite-drag-over'
      : 'hpx-category-favorite-drag-after');
  }

  function renderFavorites() {
    if (!active || !active.favoritesList) return;
    const fragment = document.createDocumentFragment();

    active.favorites.forEach(function (favorite) {
      const item = document.createElement('div');
      item.className = 'hpx-category-favorite-item';
      item.draggable = true;
      item.setAttribute('data-hpx-category-favorite-key', favoriteKey(favorite.pathTitles));
      item.setAttribute('aria-grabbed', 'false');
      item.addEventListener('dragstart', function (event) {
        startFavoriteDrag(item, favorite, event);
      });
      item.addEventListener('dragover', function (event) {
        dragOverFavorite(item, event);
      });
      item.addEventListener('dragleave', function (event) {
        if (!event.relatedTarget || !item.contains(event.relatedTarget)) {
          item.classList.remove('hpx-category-favorite-drag-over');
          item.classList.remove('hpx-category-favorite-drag-after');
        }
      });
      item.addEventListener('drop', function (event) {
        event.preventDefault();
        event.stopPropagation();
        finishFavoriteDrag();
      });
      item.addEventListener('dragend', function () {
        finishFavoriteDrag();
      });

      const dragHandle = document.createElement('span');
      dragHandle.className = 'hpx-category-favorite-drag-handle';
      dragHandle.setAttribute('role', 'img');
      dragHandle.setAttribute('aria-label', '拖曳調整「' + favorite.pathTitles.join(' › ') + '」順序');
      dragHandle.title = '上下拖曳調整順序';
      dragHandle.textContent = '⋮⋮';
      item.appendChild(dragHandle);

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'hpx-category-favorite-select';
      select.title = '套用 ' + favorite.pathTitles.join(' › ')
        + (favorite.alias ? '；別名：' + favorite.alias : '');
      const nameLine = document.createElement('div');
      nameLine.className = 'hpx-category-favorite-name-line';
      const name = document.createElement('strong');
      name.textContent = favorite.pathTitles[favorite.pathTitles.length - 1];
      nameLine.appendChild(name);
      if (favorite.alias) {
        const alias = document.createElement('span');
        alias.className = 'hpx-category-favorite-alias';
        alias.textContent = '（' + favorite.alias + '）';
        nameLine.appendChild(alias);
      }
      const path = document.createElement('span');
      path.className = 'hpx-category-favorite-path';
      path.textContent = favorite.pathTitles.length > 1
        ? favorite.pathTitles.slice(0, -1).join(' › ')
        : 'Category';
      select.appendChild(nameLine);
      select.appendChild(path);
      select.addEventListener('click', function () { selectFavorite(favorite); });
      item.appendChild(select);

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'hpx-category-favorite-edit';
      edit.setAttribute('aria-label', '編輯 ' + name.textContent + ' 的別名');
      edit.title = favorite.alias ? '編輯別名：' + favorite.alias : '新增別名';
      edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
        + '<path d="M4 16.75V20h3.25L18.81 8.44l-3.25-3.25L4 16.75Z"/>'
        + '<path d="m14.88 5.12 1.5-1.5a1.5 1.5 0 0 1 2.12 0l1.88 1.88a1.5 1.5 0 0 1 0 2.12l-1.5 1.5"/>'
        + '</svg>';
      edit.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        editFavoriteAlias(favorite, item);
      });
      item.appendChild(edit);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'hpx-category-favorite-remove';
      remove.setAttribute('aria-label', '從我的最愛移除 ' + name.textContent);
      remove.title = '從我的最愛移除';
      remove.textContent = '★';
      remove.addEventListener('click', function () {
        toggleFavorite({ pathTitles: favorite.pathTitles, searchOnly: favorite.searchOnly });
      });
      item.appendChild(remove);
      fragment.appendChild(item);
    });

    active.favoritesList.replaceChildren(fragment);
    if (!active.favorites.length) {
      const empty = document.createElement('div');
      empty.className = 'hpx-category-favorites-empty';
      empty.innerHTML = '<span aria-hidden="true">☆</span><strong>尚未加入最愛</strong><small>展開右側分類，再點選星號</small>';
      active.favoritesList.appendChild(empty);
    }
  }

  function toggleFavorite(entry) {
    if (!active || !entry || !Array.isArray(entry.pathTitles)) return;
    const existing = findFavorite(entry.pathTitles);
    const label = entry.pathTitles.join(' › ');
    if (existing) {
      const key = favoriteKey(existing.pathTitles);
      active.favorites = active.favorites.filter(function (favorite) {
        return favoriteKey(favorite.pathTitles) !== key;
      });
    } else {
      active.favorites.unshift({
        pathTitles: entry.pathTitles.slice(),
        searchOnly: entry.searchOnly === true || !!active.search.value.trim(),
      });
      active.favorites = normalizeFavorites(active.favorites);
    }
    renderFavorites();
    renderTree();
    persistFavorites(active.favorites);
    if (NS.ui.toast && typeof NS.ui.toast.show === 'function') {
      NS.ui.toast.show(existing ? '已從我的最愛移除：' + label : '已加入我的最愛：' + label, {
        type: 'success',
      });
    }
  }

  async function selectFavorite(favorite) {
    if (!active || active.favoriteSelecting || !favorite || !favorite.pathTitles.length) return;
    const sequence = active.sequence;
    active.favoriteSelecting = true;
    active.status.textContent = '正在開啟最愛分類「' + favorite.pathTitles.join(' › ') + '」…';

    try {
      if (!(await ensureNativeBridge()) || !active || sequence !== active.sequence) return;

      if (favorite.searchOnly) {
        const title = favorite.pathTitles[favorite.pathTitles.length - 1];
        active.search.value = title;
        setNativeInputValue(active.combo, title);
        active.entryModels = [];
        const searched = await refreshUntilEntry(function () {
          return (active && active.entryModels || []).find(function (entry) {
            return entry.title === title;
          }) || null;
        }, sequence, 5);
        if (!active || sequence !== active.sequence) return;
        if (!searched) throw new Error('favorite-search-miss');
        await selectEntry(searched);
        return;
      }

      if (active.search.value) {
        active.search.value = '';
        setNativeInputValue(active.combo, '');
        active.entryModels = [];
        if (!active || sequence !== active.sequence) return;
      }

      let current = null;
      for (let depth = 0; depth < favorite.pathTitles.length; depth += 1) {
        const wantedPath = favorite.pathTitles.slice(0, depth + 1);
        current = await refreshUntilEntry(function () { return findEntryByPath(wantedPath); }, sequence, 5);
        if (!active || sequence !== active.sequence) return;
        if (!current) throw new Error('favorite-path-miss');
        if (depth < favorite.pathTitles.length - 1 && !current.expanded) {
          if (!current.expandable) throw new Error('favorite-path-blocked');
          const visible = await revealNativeEntry(current);
          if (!visible || !visible.switcher) throw new Error('favorite-path-blocked');
          const previousHeight = active.nativeHolder ? active.nativeHolder.scrollHeight : 0;
          visible.switcher.click();
          current.expanded = true;
          renderTree();
          await waitFor(function () {
            if (!active || !visible.node || !visible.node.isConnected) return true;
            if (visible.switcher.classList.contains(cfg.NATIVE_SWITCHER_OPEN_CLASS)) return true;
            return !!active.nativeHolder && active.nativeHolder.scrollHeight !== previousHeight;
          }, sequence, 700);
        }
      }

      if (!current) throw new Error('favorite-empty');
      await selectEntry(current);
    } catch (error) {
      if (active && sequence === active.sequence) {
        active.status.textContent = '找不到這個最愛分類，可能已被 Halo 管理員移動或更名。';
        showError('找不到最愛分類，請重新展開分類並加入一次。');
      }
    } finally {
      if (active && sequence === active.sequence) active.favoriteSelecting = false;
    }
  }

  function renderTree() {
    if (!active) return;
    const entries = active.entryModels || [];
    const fragment = document.createDocumentFragment();

    entries.forEach(function (entry) {
      const row = document.createElement('div');
      row.className = 'hpx-category-row';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(entry.depth + 1));
      row.style.setProperty('--hpx-category-depth', String(entry.depth));
      row.title = entry.pathTitles.join(' › ');
      if (entry.expandable) row.setAttribute('aria-expanded', String(entry.expanded));
      if (entry.pending) row.classList.add('hpx-category-row--pending');

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'hpx-category-toggle';
      toggle.disabled = !entry.expandable;
      if (entry.pending) toggle.setAttribute('aria-busy', 'true');
      toggle.setAttribute('aria-label', (entry.expanded ? '收合 ' : '展開 ') + entry.title);
      toggle.textContent = entry.expandable ? (entry.expanded ? '−' : '+') : '•';
      toggle.addEventListener('click', function (event) {
        event.stopPropagation();
        toggleEntry(entry);
      });
      row.appendChild(toggle);

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'hpx-category-option';
      select.textContent = entry.title;
      select.addEventListener('click', function () { selectEntry(entry); });
      row.appendChild(select);

      const favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = 'hpx-category-star';
      const saved = !!findFavorite(entry.pathTitles);
      if (saved) favorite.classList.add('hpx-category-star--active');
      favorite.setAttribute('aria-pressed', String(saved));
      favorite.setAttribute('aria-label', (saved ? '從我的最愛移除 ' : '加入我的最愛 ') + entry.title);
      favorite.title = saved ? '從我的最愛移除' : '加入我的最愛';
      favorite.textContent = saved ? '★' : '☆';
      favorite.addEventListener('click', function (event) {
        event.stopPropagation();
        toggleFavorite(entry);
      });
      row.appendChild(favorite);
      fragment.appendChild(row);
    });

    active.tree.replaceChildren(fragment);
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'hpx-category-empty';
      empty.textContent = active.search.value.trim() ? '找不到符合的 Category' : '目前沒有可選擇的 Category';
      active.tree.appendChild(empty);
    }
    if (!active.favoriteSelecting) {
      active.status.textContent = active.search.value.trim()
        ? '搜尋結果：' + entries.length + ' 個分類'
        : '顯示 ' + entries.length + ' 個分類；使用 ＋ 展開下一層';
    }
  }

  async function openForField(field, button) {
    cleanup();
    const sequence = openSequence;
    const readValue = safeQuery(field, cfg.READ_VALUE_SELECTOR);
    const modal = createModal();

    active = {
      sequence: sequence,
      field: field,
      button: button,
      layer: modal.layer,
      shell: modal.shell,
      dialog: modal.dialog,
      search: modal.search,
      status: modal.status,
      tree: modal.tree,
      favoritesList: modal.favoritesList,
      favoritesHandle: modal.favoritesHandle,
      favorites: [],
      favoriteDragging: null,
      favoriteDragStartOrder: null,
      favoriteSelecting: false,
      combo: null,
      control: null,
      popup: null,
      nativeHolder: null,
      nativeObserver: null,
      entryModels: [],
      scanToken: 0,
      scanningNative: false,
      revealingNative: false,
      refreshTimer: null,
    };
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-expanded', 'true');

    active.favorites = await loadFavorites();
    if (!active || sequence !== active.sequence) return;
    renderFavorites();

    let combo = safeQuery(field, cfg.NATIVE_COMBOBOX_SELECTOR);
    if (!combo) {
      if (!readValue) {
        cleanup();
        showError();
        return;
      }
      readValue.click();
      combo = await waitFor(function () { return safeQuery(field, cfg.NATIVE_COMBOBOX_SELECTOR); }, sequence);
    }
    if (!active || sequence !== active.sequence) return;
    if (!combo) {
      cleanup();
      showError();
      return;
    }

    active.combo = combo;
    active.control = safeClosest(combo, cfg.NATIVE_CONTROL_SELECTOR);
    combo.addEventListener('blur', stopBridgeBlur, true);
    combo.addEventListener('focusout', stopBridgeBlur, true);
    // Halo must first calculate and mount its popup at the real field position.
    // Moving the control off-screen before this point prevents rc-trigger from
    // producing a usable tree. The custom modal already covers the native UI.
    const popup = await openNativePopup(active.control, combo, sequence);
    if (!active || sequence !== active.sequence) return;
    if (!popup) {
      cleanup();
      showError('Halo 沒有開啟原生 Category 清單，請再試一次。');
      return;
    }

    active.status.textContent = '正在載入 Category 項目…';
    const populatedPopup = await waitFor(findNativePopupWithNodes, sequence);
    if (!active || sequence !== active.sequence) return;
    if (!populatedPopup) {
      cleanup();
      showError('Halo 已開啟 Category，但沒有回傳任何分類項目。');
      return;
    }

    active.popup = populatedPopup;
    // Only after the native tree exists do we hide both native surfaces and
    // expose their data/events through the Extension-owned modal.
    markNativeBridge(active.control, populatedPopup);
    installNativeObserver(populatedPopup);
    await refreshNativeEntries();
    if (!active || sequence !== active.sequence) return;
    active.search.disabled = false;
    try { active.search.focus({ preventScroll: true }); } catch (error) { active.search.focus(); }
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }

  function mountButton(field) {
    field.classList.add(FIELD_CLASS);
    const existing = safeQuery(field, '.' + BUTTON_CLASS);
    if (existing) return existing;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.title = '開啟大型 Category 選擇器';
    button.setAttribute('aria-label', '開啟大型 Category 選擇器');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span aria-hidden="true">▦</span><span>選擇</span>';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openForField(field, button);
    });
    field.appendChild(button);
    return button;
  }

  function reconcileNow() {
    reconcileQueued = false;
    if (!isTicketPath()) {
      cleanup();
      return;
    }
    safeQueryAll(document, cfg.FIELD_LABEL_SELECTOR).forEach(function (label) {
      const field = fieldForLabel(label);
      if (field) mountButton(field);
    });
    if (active && (!active.field.isConnected || !active.dialog.isConnected)) cleanup();
    if (active && active.combo && active.combo.getAttribute('aria-expanded') === 'true') {
      const popup = findNativePopup();
      if (popup && popup !== active.popup) {
        unmarkNativeBridge(null, active.popup);
        active.popup = popup;
        markNativeBridge(active.control, popup);
        installNativeObserver(popup);
        scheduleNativeRefresh(20);
      }
    }
  }

  function reconcile() {
    if (reconcileQueued) return;
    reconcileQueued = true;
    window.requestAnimationFrame(reconcileNow);
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && active) {
      if (safeClosest(event.target, '.hpx-category-favorite-editor')) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      cleanup();
    }
  }

  NS.ui.categoryPicker = {
    start: function () {
      if (started) return;
      started = true;
      document.addEventListener('keydown', onKeydown, true);
      observer = new MutationObserver(reconcile);
      observer.observe(document.body, { childList: true, subtree: true });
      reconcile();
    },
    stop: function () {
      if (!started) return;
      started = false;
      if (observer) observer.disconnect();
      observer = null;
      document.removeEventListener('keydown', onKeydown, true);
      cleanup();
      safeQueryAll(document, '.' + BUTTON_CLASS).forEach(function (button) { button.remove(); });
      safeQueryAll(document, '.' + FIELD_CLASS).forEach(function (field) { field.classList.remove(FIELD_CLASS); });
    },
    reconcile: reconcile,
    close: cleanup,
  };
})();
