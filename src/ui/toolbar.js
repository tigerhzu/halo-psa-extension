/**
 * toolbar.js
 * 浮動工具列：為每個編輯器插入一條工具列，貼著編輯器（置於其上方同層）。
 * 分三組：AI 潤稿 / 整理格式 / 快速範本（下拉）。
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

  function buildToolbar(editorEl) {
    const bar = document.createElement('div');
    bar.className = 'hpx-toolbar';
    bar.setAttribute('data-' + PREFIX + '-toolbar', '1');

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

    // ── 組2：整理格式 ──
    const fmtGroup = makeGroup('');
    fmtGroup.appendChild(
      makeButton('整理格式', '修正錯字、統一標點、自動換行、條列化', function () {
        runFormatCleanup(editorEl);
      }, 'hpx-tb-btn--format')
    );
    bar.appendChild(fmtGroup);

    // ── 組3：快速範本 ──
    const tplGroup = makeGroup('');
    tplGroup.appendChild(makeTemplateDropdown(editorEl));
    bar.appendChild(tplGroup);

    return bar;
  }

  /** 功能3 入口：整理格式 → 預覽 → 覆蓋 */
  function runFormatCleanup(editorEl) {
    const text = NS.core.adapter.getText(editorEl);
    if (!text.trim()) {
      NS.ui.toast.show('編輯器內沒有文字可以整理', { type: 'error' });
      return;
    }
    // 視覺回饋：小老虎 loading（整理是本機運算、很快，稍微延後讓動畫看得到）
    NS.ui.loader.show('正在整理格式…');
    setTimeout(function () {
      const result = NS.features.formatCleanup.clean(text);
      NS.ui.loader.done();
      NS.ui.previewModal
        .open({
          title: '整理格式',
          original: text,
          result: result,
          note: '本地規則整理（中英補空格、IT 名詞標準化、修正錯字、統一標點、條列化），完全在本機執行、不呼叫 AI。可在右側微調後再套用。',
          showDiff: true,
        })
        .then(function (finalText) {
          if (finalText == null) return;
          NS.core.adapter.setText(editorEl, finalText);
          NS.ui.toast.show('已套用整理結果', { type: 'success' });
        });
    }, 350);
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

    /** 移除編輯器的工具列 */
    unmount: function (editorEl) {
      const bar = toolbars.get(editorEl);
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      toolbars.delete(editorEl);
    },
  };

  NS.ui.toolbar = Toolbar;
})();
