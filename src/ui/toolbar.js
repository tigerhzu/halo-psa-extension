/**
 * toolbar.js
 * Extension 工具列：掛在富文字編輯器 DOM「之外」的正常 document flow。
 * 分兩組：AI 潤稿 / 快速範本（下拉）。
 *
 * 掛載策略（selector 集中於 config.selectors.TOOLBAR_MOUNT）：
 *  - detectActionType()：由 editor 往上找 Email 欄位判斷 Action 類型。
 *  - Activity Note 與 Email User 都插在「editor 欄位 label + editor root」
 *    的正上方（Email 的 label 即 Service Status Note，因此工具列自然位於
 *    To / Cc / 聯絡人工具列之下、label 之上），是 Action 容器內的普通
 *    document flow sibling，不掛 body / overlay、不用座標定位。
 *  - Email User 另加 hpx-toolbar--email class：主題 CSS 以此取消 z-index
 *    提升，確保 Halo 原生收件人 autocomplete 永遠蓋得過 Extension UI。
 *
 * 工具列與其對應 editor instance 以 Map 追蹤，editor 被移除時一併清除（見
 * content.js）。Map 只保存 instance state；每次 ensureEditorToolbar() 仍會以
 * DOM 實況確認工具列是否存在、是否位於正確的 host / anchor，不把舊 reference
 * 當作「已掛載」證據。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const PREFIX = NS.PREFIX;

  const EXTENSION_TOOLBAR_ATTR = 'data-' + PREFIX + '-extension-toolbar';
  const TOOLBAR_OWNER_ATTR = 'data-' + PREFIX + '-toolbar-owner';

  // editorEl -> { editorEl, bar, ownerToken, actionType, mountParent, mountBefore }
  const toolbars = new Map();
  let toolbarSequence = 0;

  function makeButton(label, title, onClick, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hpx-tb-btn' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = label;
    if (title) btn.title = title;
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
    });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    });
    return btn;
  }

  function makeGroup(labelText) {
    const group = document.createElement('div');
    group.className = 'hpx-tb-group';
    if (labelText) {
      const lbl = document.createElement('span');
      lbl.className = 'hpx-tb-group-label';
      lbl.textContent = labelText;
      group.appendChild(lbl);
    }
    return group;
  }

  /** 建立範本下拉 */
  function makeTemplateDropdown(editorEl) {
    const wrap = document.createElement('div');
    wrap.className = 'hpx-tb-dropdown';

    function setOpen(open, focusItem) {
      menu.classList.toggle('hpx-tb-dropdown-menu--open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open && focusItem && menu.firstElementChild) menu.firstElementChild.focus();
    }
    const toggle = makeButton('插入範本', '在游標位置插入常用範本', function () {
      setOpen(!menu.classList.contains('hpx-tb-dropdown-menu--open'));
    });
    toggle.classList.add('hpx-tb-btn--template');
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'hpx-tb-dropdown-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '快速範本');

    NS.features.templates.list().forEach(function (tpl) {
      const item = makeButton(tpl.label, tpl.content, function () {
        NS.features.templates.insert(tpl.id, editorEl);
        setOpen(false);
      });
      item.classList.add('hpx-tb-dropdown-item');
      item.setAttribute('role', 'menuitem');
      menu.appendChild(item);
    });

    // 點擊外部關閉
    const outsideClick = function (e) {
      if (!wrap.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', outsideClick);
    wrap.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        setOpen(false);
        toggle.focus();
        event.stopPropagation();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = Array.from(menu.querySelectorAll('button'));
        const index = items.indexOf(document.activeElement);
        setOpen(true);
        if (items.length) items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length].focus();
      } else if (event.key === 'Tab') setOpen(false);
    });
    wrap.__hpxCleanup = function () {
      document.removeEventListener('click', outsideClick);
    };

    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    return wrap;
  }

  function isNewTicketEditor(editorEl) {
    // Route 判斷是最穩定的訊號；closest selector 讓同一個 SPA route
    // 在 Halo 改成 modal / nested screen 時仍能辨識。找不到 selector
    // 時保持顯示，避免把 Activity Note 或其他既有編輯器誤隱藏。
    try {
      if (/\/newticket(?:\/|$)/i.test(window.location.pathname || '')) return true;
    } catch (error) {
      // Keep the structural check below as a fail-safe fallback.
    }
    const selectors = NS.config && NS.config.selectors && NS.config.selectors.ULTIMATE_MODE
      ? NS.config.selectors.ULTIMATE_MODE.NEW_TICKET_ROOT_SELECTORS
      : [];
    return (Array.isArray(selectors) ? selectors : [selectors]).some(function (selector) {
      if (!selector || !editorEl || !editorEl.closest) return false;
      try { return !!editorEl.closest(selector); } catch (error) { return false; }
    });
  }

  function buildToolbar(editorEl, ownerToken) {
    const bar = document.createElement('div');
    bar.className = 'hpx-toolbar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Halopsa 撰寫工具');
    bar.setAttribute('data-' + PREFIX + '-toolbar', '1');
    bar.setAttribute(EXTENSION_TOOLBAR_ATTR, 'true');
    bar.setAttribute(TOOLBAR_OWNER_ATTR, ownerToken);
    if (isNewTicketEditor(editorEl)) {
      bar.classList.add('hpx-new-ticket-hidden');
      bar.setAttribute('data-hpx-new-ticket-toolbar', 'hidden');
    }

    // ── 組0：獨立編輯視窗 ──
    // 放在最前面：長內容編輯是進入點，其餘動作在獨立視窗裡也都有。
    const windowGroup = makeGroup('');
    windowGroup.appendChild(
      makeButton('編輯器', '在獨立視窗編輯', function () {
        NS.features.noteWindow.open(editorEl);
      }, 'hpx-tb-btn--window')
    );
    bar.appendChild(windowGroup);

    // ── 組1：AI 潤稿 ──
    const aiGroup = makeGroup('AI');
    const ai = NS.features.aiRewrite.ACTIONS;
    Object.keys(ai).forEach(function (key) {
      aiGroup.appendChild(
        makeButton(ai[key].label, ai[key].title, function () {
          NS.features.aiRewrite.run(key, editorEl);
        }, 'hpx-tb-btn--ai')
      );
    });
    bar.appendChild(aiGroup);

    // ── 組2：快速範本 ──
    const tplGroup = makeGroup('');
    const templateDropdown = makeTemplateDropdown(editorEl);
    tplGroup.appendChild(templateDropdown);
    bar.appendChild(tplGroup);
    bar.__hpxCleanup = function () {
      if (templateDropdown.__hpxCleanup) templateDropdown.__hpxCleanup();
    };

    return bar;
  }

  function syncNewTicketVisibility(editorEl, bar) {
    if (!bar || !bar.classList) return;
    const hidden = isNewTicketEditor(editorEl);
    bar.classList.toggle('hpx-new-ticket-hidden', hidden);
    if (hidden) bar.setAttribute('data-hpx-new-ticket-toolbar', 'hidden');
    else bar.removeAttribute('data-hpx-new-ticket-toolbar');
  }

  // ── 掛載策略（Mount Strategy）───────────────────────────────
  // selector 全部集中在 config.selectors.TOOLBAR_MOUNT，避免散落 hack。

  function mountCfg() {
    return NS.config.selectors.TOOLBAR_MOUNT;
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /** 找出編輯器最外層 wrapper（Froala .fr-box 等）。工具列必須掛在它之外。 */
  function findEditorRoot(editorEl) {
    if (!editorEl || !editorEl.closest) return editorEl;
    try {
      const root = editorEl.closest(mountCfg().EDITOR_ROOT_SELECTORS.join(','));
      if (root) return root;
    } catch (e) {
      /* selector 無效就退回 editor 本身 */
    }
    return editorEl;
  }

  /**
   * 由 editor root 往上回溯，第一個包含 Email 欄位（emailto / emailcc…）的
   * 祖先即為 Email action 容器。找不到回傳 null（→ 視為 Note 類 Action）。
   */
  function findActionContainer(editorEl) {
    const cfg = mountCfg();
    const emailSel = cfg.EMAIL_FIELD_SELECTORS.join(',');
    let node = findEditorRoot(editorEl).parentElement;
    for (let i = 0; i < cfg.ACTION_LOOKUP_DEPTH && node && node !== document.body; i++) {
      try {
        if (node.querySelector(emailSel)) return node;
      } catch (e) {
        return null;
      }
      node = node.parentElement;
    }
    return null;
  }

  /** 判斷目前 Action 類型：'email'（Email User 等寄信類）或 'note'。 */
  function detectActionType(editorEl) {
    return findActionContainer(editorEl) ? 'email' : 'note';
  }

  /** 短文字且命中欄位關鍵字（或本身是 label）→ 視為 editor 欄位 label。 */
  function isNoteFieldLabel(el) {
    if (!el) return false;
    const text = normalizeText(el.textContent);
    if (!text || text.length > mountCfg().NOTE_LABEL_MAX_LENGTH) return false;
    if (el.tagName && el.tagName.toLowerCase() === 'label') return true;
    const keywords = NS.config.selectors.FIELD_KEYWORDS;
    return keywords.some(function (k) {
      return text.indexOf(k.toLowerCase()) !== -1;
    });
  }

  /**
   * 找插入 anchor。優先插在 editor 欄位 label（Note 的「note」、Email 的
   * 「Service Status Note」）之上，讓工具列位於「label + editor」整組欄位
   * 的正上方；找不到 label 就插在 editor root 之前。
   * 只穿過「除了 editor 外沒有其他內容」的薄 wrapper。
   */
  function findNoteAnchor(editorRoot) {
    const cfg = mountCfg();
    let anchor = editorRoot;
    for (let i = 0; i < cfg.NOTE_LABEL_LOOKUP_DEPTH; i++) {
      const prev = anchor.previousElementSibling;
      if (prev && isNoteFieldLabel(prev)) return prev;
      const parent = anchor.parentElement;
      if (!parent || parent === document.body || parent.childElementCount > 1) break;
      anchor = parent;
    }
    return anchor;
  }

  /**
   * 統一的掛載點解析：Note 與 Email 都插在 editor 欄位（label + editor root）
   * 正上方，是 Action 容器自己的普通 sibling。Email User 因此自然落在
   * To / Cc / 聯絡人工具列之下、Service Status Note label 之上。
   * 回傳 { parent, before }：insertBefore(bar, before)。
   */
  function findToolbarMountTarget(actionType, editorEl) {
    const editorRoot = findEditorRoot(editorEl);
    const anchor = findNoteAnchor(editorRoot);
    if (anchor && anchor.parentElement) {
      return { parent: anchor.parentElement, before: anchor };
    }
    // 不掛 body / global overlay：editor 暫時 detached 時先不掛，
    // 由下一次掃描的 ensureAttached() 重試。
    return null;
  }

  function findOwnedToolbars(ownerToken) {
    const found = [];
    let nodes;
    try {
      nodes = document.querySelectorAll('[' + EXTENSION_TOOLBAR_ATTR + '="true"]');
    } catch (e) {
      return found;
    }
    nodes.forEach(function (el) {
      if (el.getAttribute(TOOLBAR_OWNER_ATTR) === ownerToken) found.push(el);
    });
    return found;
  }

  function removeToolbarNode(bar) {
    if (!bar) return;
    if (bar.__hpxCleanup) {
      try { bar.__hpxCleanup(); } catch (e) { /* cleanup 失敗不應中斷 lifecycle */ }
      bar.__hpxCleanup = null;
    }
    if (bar.parentNode) bar.parentNode.removeChild(bar);
  }

  /** 清掉同一掛載點下已無主的舊工具列（避免 SPA 過渡期重複）。 */
  function removeOrphanToolbars(parent, currentBar) {
    const known = new Set();
    toolbars.forEach(function (state) {
      if (state && state.bar) known.add(state.bar);
    });
    parent
      .querySelectorAll(':scope > [' + EXTENSION_TOOLBAR_ATTR + '="true"]')
      .forEach(function (el) {
        if (el === currentBar || known.has(el)) return;
        removeToolbarNode(el);
      });
  }

  /**
   * 統一的 editor toolbar lifecycle reconcile。
   *
   * - editor 尚在 DOM，但 toolbar 被 Halo 拿掉 → 使用同一 instance 的 bar 重新
   *   掛到目前解析出的 target。
   * - editor root / label / action host 被替換 → 重新解析 parent + before，必要時
   *   移動既有 bar；不依賴舊 parent reference。
   * - 同一 owner token 的殘留節點 → 只保留 state 所有的那一條。
   */
  function mountExtensionToolbar(editorEl, state) {
    const actionType = detectActionType(editorEl);
    const target = findToolbarMountTarget(actionType, editorEl);
    if (!target || !target.parent || !document.contains(target.parent)) return false;

    const bar = state.bar;
    state.actionType = actionType;
    state.mountParent = target.parent;
    state.mountBefore = target.before || null;
    bar.__hpxActionType = actionType;
    bar.__hpxEditor = editorEl;
    bar.setAttribute(EXTENSION_TOOLBAR_ATTR, 'true');
    bar.setAttribute(TOOLBAR_OWNER_ATTR, state.ownerToken);
    // Email action：主題 CSS 以此 class 取消 z-index / position 提升，
    // 讓 Halo 原生收件人 autocomplete 展開時能蓋過工具列。
    bar.classList.toggle('hpx-toolbar--email', actionType === 'email');
    syncNewTicketVisibility(editorEl, bar);

    // 只清理同一個 owner 的 duplicate；不同 editor 的工具列即使共用同一
    // action host，也必須保持彼此獨立。
    findOwnedToolbars(state.ownerToken).forEach(function (owned) {
      if (owned !== bar) removeToolbarNode(owned);
    });
    removeOrphanToolbars(target.parent, bar);

    const alreadyAtTarget = bar.parentNode === target.parent &&
      bar.nextElementSibling === (target.before || null);
    if (!alreadyAtTarget) target.parent.insertBefore(bar, target.before || null);
    return true;
  }

  function createState(editorEl) {
    toolbarSequence += 1;
    const ownerToken = 'editor-' + Date.now().toString(36) + '-' + toolbarSequence;
    const state = {
      editorEl: editorEl,
      ownerToken: ownerToken,
      bar: buildToolbar(editorEl, ownerToken),
      actionType: null,
      mountParent: null,
      mountBefore: null,
    };
    toolbars.set(editorEl, state);
    return state;
  }

  /** 以 DOM 實況確保某個 editor instance 有且只有一條 toolbar。 */
  function ensureEditorToolbar(editorEl) {
    if (!editorEl || !document.contains(editorEl)) return false;
    const state = toolbars.get(editorEl) || createState(editorEl);
    return mountExtensionToolbar(editorEl, state);
  }

  const Toolbar = {
    /** 為 editor instance 建立並掛上工具列；重複呼叫是安全的 reconcile。 */
    mount: function (editorEl) {
      if (ensureEditorToolbar(editorEl)) NS.log('工具列已掛上／確認掛載', editorEl);
    },

    /** SPA 導覽後同一個 editor 被重用時，重新 reconcile 目前 DOM。 */
    refresh: function () {
      Toolbar.ensureAttached();
    },

    /**
     * Editor rerender / Action 類型切換後，把每個 editor instance 的工具列
     * reconcile 到正確掛載點。
     * 由 editor-detector 每次掃描結尾呼叫（見 content.js）。
     */
    ensureAttached: function () {
      toolbars.forEach(function (state, editorEl) {
        if (!editorEl.isConnected) return; // 交給 detector 的 onEditorRemoved
        ensureEditorToolbar(editorEl);
      });
    },

    /** 移除編輯器的工具列 */
    unmount: function (editorEl) {
      const state = toolbars.get(editorEl);
      if (!state) return;
      // 用 owner token 清理所有殘留 duplicate，即使 Halo 曾把其中一條
      // 移到另一個 parent，也不會把它留在下一個 Ticket。
      findOwnedToolbars(state.ownerToken).forEach(function (bar) {
        removeToolbarNode(bar);
      });
      removeToolbarNode(state.bar);
      toolbars.delete(editorEl);
    },
  };

  // Halo 以 history / Navigation API 切換頁面時，editor 不一定會重建。
  // 只在導覽事件同步既有工具列，不建立額外高頻 DOM observer。
  ['popstate', 'hashchange'].forEach(function (eventName) {
    window.addEventListener(eventName, Toolbar.refresh);
  });
  if (window.navigation && window.navigation.addEventListener) {
    window.navigation.addEventListener('navigate', Toolbar.refresh);
  }

  NS.ui.toolbar = Toolbar;
})();
