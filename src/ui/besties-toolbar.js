/**
 * besties-toolbar.js
 * 在偵測到的寄信視窗內掛上「聯絡人名單」工具列。
 *
 * 結構（資料驅動，群組來自設定頁；新增 主管 / 同事 / 專案經理 不用改程式）：
 *   [摯友名單 ▾]   →  ✚ 全部加入 CC（N 位）
 *                     ───────────
 *                     Criss Sim
 *                     Purple Liu
 *                     ───────────
 *                     ⚙ 管理名單…
 *   [主管 ▾] …（其餘群組同理）
 *
 * 名單變更時（chrome.storage.onChanged）自動重建所有已掛上的工具列。
 * 重用既有 .hpx-toolbar / .hpx-tb-* 樣式。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const PREFIX = NS.PREFIX;

  // windowEl -> toolbarEl
  const toolbars = new Map();

  function makeButton(label, title, onClick, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hpx-tb-btn' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = label;
    if (title) btn.title = title;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    });
    return btn;
  }

  function divider() {
    const d = document.createElement('div');
    d.className = 'hpx-tb-dropdown-divider';
    return d;
  }

  /** 建立單一群組的下拉。 */
  function makeGroupDropdown(windowEl, group) {
    const wrap = document.createElement('div');
    wrap.className = 'hpx-tb-dropdown';

    const toggle = makeButton(group.name + ' ▾', '加入 ' + group.name + ' 到 CC', function () {
      // 開啟前先關掉其它已開的選單
      closeAllMenus(wrap);
      menu.classList.toggle('hpx-tb-dropdown-menu--open');
    }, 'hpx-tb-btn--besties');

    const menu = document.createElement('div');
    menu.className = 'hpx-tb-dropdown-menu';

    // 全部加入
    const addAll = makeButton(
      '✚ 全部加入 CC（' + group.members.length + ' 位）',
      '把整個群組加入 CC',
      function () {
        NS.features.besties.addGroupToCC(windowEl, group);
        menu.classList.remove('hpx-tb-dropdown-menu--open');
      }
    );
    addAll.classList.add('hpx-tb-dropdown-item', 'hpx-tb-dropdown-item--strong');
    menu.appendChild(addAll);
    menu.appendChild(divider());

    // 個別成員
    group.members.forEach(function (m) {
      const label = m.name ? m.name + '（' + m.email + '）' : m.email;
      const item = makeButton(label, '只加入這一位', function () {
        NS.features.besties.addMemberToCC(windowEl, m);
        menu.classList.remove('hpx-tb-dropdown-menu--open');
      });
      item.classList.add('hpx-tb-dropdown-item');
      menu.appendChild(item);
    });

    // 管理名單
    menu.appendChild(divider());
    const manage = makeButton('⚙ 管理名單…', '開啟設定頁編輯名單', function () {
      NS.features.besties.openManager();
      menu.classList.remove('hpx-tb-dropdown-menu--open');
    });
    manage.classList.add('hpx-tb-dropdown-item', 'hpx-tb-dropdown-item--manage');
    menu.appendChild(manage);

    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    return wrap;
  }

  function closeAllMenus(except) {
    document
      .querySelectorAll('.hpx-tb-dropdown-menu--open')
      .forEach(function (m) {
        if (!except || !except.contains(m)) {
          m.classList.remove('hpx-tb-dropdown-menu--open');
        }
      });
  }

  /** 用目前名單重建一條工具列的內容。 */
  function renderInto(bar, windowEl, groups) {
    bar.textContent = '';

    if (!groups.length) {
      const empty = makeButton('尚無名單，點此管理…', '開啟設定頁新增名單', function () {
        NS.features.besties.openManager();
      });
      empty.classList.add('hpx-tb-btn--besties');
      bar.appendChild(empty);
      return;
    }

    groups.forEach(function (group) {
      bar.appendChild(makeGroupDropdown(windowEl, group));
    });
  }

  function buildToolbar(windowEl) {
    const bar = document.createElement('div');
    bar.className = 'hpx-toolbar hpx-besties-toolbar';
    bar.setAttribute('data-' + PREFIX + '-besties-toolbar', '1');

    NS.features.besties.getGroups().then(function (groups) {
      renderInto(bar, windowEl, groups);
    });

    return bar;
  }

  /** 把工具列插在 CC 欄位附近（找不到就插在容器最前面）。 */
  function attach(windowEl, bar) {
    const cc = NS.features.besties._findCcField(windowEl);
    if (cc) {
      // 找 CC 欄位所在「列」，把工具列插在它前面
      let row = cc;
      for (let i = 0; i < 4 && row.parentElement && row.parentElement !== windowEl; i++) {
        row = row.parentElement;
      }
      const anchor = row && row.parentElement ? row : cc;
      if (anchor.parentElement) {
        const host = anchor.parentElement;
        host.classList.add('hpx-besties-layer-host');
        bar.__hpxLayerHost = host;
        host.insertBefore(bar, anchor);
        return;
      }
    }
    windowEl.insertBefore(bar, windowEl.firstChild);
  }

  // 點擊工具列外部關閉所有下拉
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.hpx-besties-toolbar')) {
      closeAllMenus(null);
    }
  });

  // 名單變更 → 重建所有已掛上的工具列
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      const key = NS.config.besties.STORAGE_KEY;
      if (!changes[key]) return;
      NS.features.besties.getGroups().then(function (groups) {
        toolbars.forEach(function (bar, windowEl) {
          renderInto(bar, windowEl, groups);
        });
      });
    });
  }

  const BestiesToolbar = {
    mount: function (windowEl) {
      if (toolbars.has(windowEl)) return;
      const bar = buildToolbar(windowEl);
      attach(windowEl, bar);
      toolbars.set(windowEl, bar);
      NS.log('聯絡人名單工具列已掛上', windowEl);
    },

    unmount: function (windowEl) {
      const bar = toolbars.get(windowEl);
      const host = bar && bar.__hpxLayerHost;
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      if (host && !host.querySelector('.hpx-besties-toolbar')) host.classList.remove('hpx-besties-layer-host');
      toolbars.delete(windowEl);
    },
  };

  NS.ui.bestiesToolbar = BestiesToolbar;
})();
