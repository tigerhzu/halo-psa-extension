/**
 * toolbar.js
 * 浮動工具列：為每個編輯器插入一條工具列，貼著編輯器（置於其上方同層）。
 * 分兩組：AI 潤稿 / 快速範本（下拉）。
 *
 * 工具列與其對應編輯器以 Map 追蹤，編輯器被移除時一併清除（見 content.js）。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const PREFIX = NS.PREFIX;

  // editorEl -> toolbarEl
  const toolbars = new Map();

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

    const toggle = makeButton('快速範本 ▾', '插入常用範本', function () {
      menu.classList.toggle('hpx-tb-dropdown-menu--open');
    });
    toggle.classList.add('hpx-tb-btn--template');

    const menu = document.createElement('div');
    menu.className = 'hpx-tb-dropdown-menu';

    NS.features.templates.list().forEach(function (tpl) {
      const item = makeButton(tpl.label, tpl.content, function () {
        NS.features.templates.insert(tpl.id, editorEl);
        menu.classList.remove('hpx-tb-dropdown-menu--open');
      });
      item.classList.add('hpx-tb-dropdown-item');
      menu.appendChild(item);
    });

    // 點擊外部關閉
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) {
        menu.classList.remove('hpx-tb-dropdown-menu--open');
      }
    });

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

  function buildToolbar(editorEl) {
    const bar = document.createElement('div');
    bar.className = 'hpx-toolbar';
    bar.setAttribute('data-' + PREFIX + '-toolbar', '1');
    if (isNewTicketEditor(editorEl)) {
      bar.classList.add('hpx-new-ticket-hidden');
      bar.setAttribute('data-hpx-new-ticket-toolbar', 'hidden');
    }

    // ── 組0：獨立編輯視窗 ──
    // 放在最前面：長內容編輯是進入點，其餘動作在獨立視窗裡也都有。
    const windowGroup = makeGroup('');
    windowGroup.appendChild(
      makeButton('編輯', '在獨立視窗中編輯這則 Note（HaloPSA 頁面維持可捲動）', function () {
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
    tplGroup.appendChild(makeTemplateDropdown(editorEl));
    bar.appendChild(tplGroup);

    return bar;
  }

  function syncNewTicketVisibility(editorEl, bar) {
    if (!bar || !bar.classList) return;
    const hidden = isNewTicketEditor(editorEl);
    bar.classList.toggle('hpx-new-ticket-hidden', hidden);
    if (hidden) bar.setAttribute('data-hpx-new-ticket-toolbar', 'hidden');
    else bar.removeAttribute('data-hpx-new-ticket-toolbar');
  }

  /** 找到適合放工具列的容器，並把工具列插在編輯器前面 */
  function attachToolbar(editorEl, bar) {
    // iframe 編輯器：插在 iframe 外層之前；一般：插在編輯器之前
    const anchor =
      editorEl.tagName.toLowerCase() === 'iframe'
        ? editorEl
        : editorEl;
    const parent = anchor.parentElement;
    if (!parent) {
      document.body.appendChild(bar);
      return;
    }
    parent.insertBefore(bar, anchor);
  }

  const Toolbar = {
    /** 為編輯器建立並掛上工具列 */
    mount: function (editorEl) {
      if (toolbars.has(editorEl)) return;
      const bar = buildToolbar(editorEl);
      attachToolbar(editorEl, bar);
      toolbars.set(editorEl, bar);
      NS.log('工具列已掛上', editorEl);
    },

    /** SPA 導覽後同一個 editor 被重用時，同步 New Ticket 可見性。 */
    refresh: function () {
      toolbars.forEach(function (bar, editorEl) {
        syncNewTicketVisibility(editorEl, bar);
      });
    },

    /** 移除編輯器的工具列 */
    unmount: function (editorEl) {
      const bar = toolbars.get(editorEl);
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
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
