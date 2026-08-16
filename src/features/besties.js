/**
 * besties.js
 * 「聯絡人名單 / CC 快速加入」邏輯（不呼叫 AI，全本地）。
 *
 * 對外提供：
 *  - getGroups(): Promise<groups>            讀取使用者名單（storage → 回退 config 預設）
 *  - addGroupToCC(windowEl, group)           把整個群組成員加入 CC（去重、不覆蓋）
 *  - addMemberToCC(windowEl, member)         只加入單一成員
 *  - openManager()                           開啟設定頁（由背景 openOptionsPage）
 *
 * CC 欄位的尋找 / 寫入是「最依賴實際 DOM」的部分：採用可在 besties-config.js
 * 調整的 selector + label 啟發式，找不到時回報明確錯誤。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  function cfg() {
    return NS.config.besties;
  }

  // ── 名單讀取 ──────────────────────────────────────────────

  /** 讀取使用者維護的群組；沒有就回退 config 的 defaultGroups。 */
  function getGroups() {
    return new Promise(function (resolve) {
      const c = cfg();
      const fallback = (c.defaultGroups || []).slice();
      if (!chrome || !chrome.storage || !chrome.storage.local) {
        resolve(fallback);
        return;
      }
      chrome.storage.local.get(c.STORAGE_KEY, function (data) {
        const s = (data && data[c.STORAGE_KEY]) || {};
        const groups = s[c.GROUPS_FIELD];
        if (Array.isArray(groups) && groups.length) {
          resolve(normalizeGroups(groups));
        } else {
          resolve(fallback);
        }
      });
    });
  }

  function getDefaultCcRecipients() {
    return new Promise(function (resolve) {
      const c = cfg();
      chrome.storage.local.get(c.STORAGE_KEY, function (data) {
        const settings = (data && data[c.STORAGE_KEY]) || {};
        const members = Array.isArray(settings[c.DEFAULT_CC_FIELD])
          ? settings[c.DEFAULT_CC_FIELD]
          : [];
        resolve(members.filter(function (member) {
          return member && typeof member.email === 'string' && member.email.indexOf('@') > 0;
        }).map(function (member) {
          return { name: String(member.name || '').trim(), email: member.email.trim() };
        }));
      });
    });
  }

  /** 過濾出結構正確、且至少有一位有效 email 的群組。 */
  function normalizeGroups(groups) {
    return groups
      .filter(function (g) {
        return g && typeof g.name === 'string' && Array.isArray(g.members);
      })
      .map(function (g) {
        return {
          name: g.name.trim() || '（未命名群組）',
          members: g.members
            .filter(function (m) {
              return m && typeof m.email === 'string' && m.email.indexOf('@') !== -1;
            })
            .map(function (m) {
              return { name: (m.name || '').trim(), email: m.email.trim() };
            }),
        };
      })
      .filter(function (g) {
        return g.members.length > 0;
      });
  }

  // ── CC 欄位尋找 ──────────────────────────────────────────

  /** 把目標元素往上找到「像寄信視窗」的容器（找不到就回退到原本的 root）。 */
  function findWindowContainer(el) {
    const c = cfg();
    let node = el;
    for (let i = 0; i < c.lookupDepth && node; i++) {
      if (node.matches) {
        for (let s = 0; s < c.EMAIL_WINDOW_SELECTORS.length; s++) {
          try {
            // 工具列要跟著 CC 欄位所在的小容器，不要提升到包住 To / CC 的
            // 外層 composer，否則會被插到 To 上方並改變整個寄信區版面。
            if (node.matches(c.EMAIL_WINDOW_SELECTORS[s])) return node;
          } catch (e) {
            /* selector 無效就略過 */
          }
        }
      }
      node = node.parentElement;
    }
    return el;
  }

  /** 在某根節點內尋找 CC 欄位輸入元素。找不到回傳 null。 */
  function findCcField(root) {
    const c = cfg();
    if (!root) return null;

    // 1. 直接用候選 selector
    for (let i = 0; i < c.CC_FIELD_SELECTORS.length; i++) {
      let node;
      try {
        node = root.querySelector(c.CC_FIELD_SELECTORS[i]);
      } catch (e) {
        node = null;
      }
      if (node) return node;
    }

    // 2. 後援：用鄰近 label 文字尋找
    const kws = c.CC_LABEL_KEYWORDS.map(function (k) {
      return k.toLowerCase();
    });
    const labelish = root.querySelectorAll('label, span, div, th, td, legend');
    for (let i = 0; i < labelish.length; i++) {
      const node = labelish[i];
      const text = (node.textContent || '').trim().toLowerCase();
      // 短文字才視為 label，避免把整個容器文字誤判
      if (text.length > 8) continue;
      const hit = kws.some(function (k) {
        return text === k || text === k + ':' || text === k + '：';
      });
      if (!hit) continue;
      const input = inputNear(node, root);
      if (input) return input;
    }
    return null;
  }

  /** 從 label 節點找關聯的輸入元素：for 屬性 → 內部 → 兄弟 → 父層。 */
  function inputNear(labelNode, root) {
    // label[for]
    const forId = labelNode.getAttribute && labelNode.getAttribute('for');
    if (forId) {
      const byId = (root.querySelector
        ? root.querySelector('#' + cssEscape(forId))
        : null) || document.getElementById(forId);
      if (byId && isInput(byId)) return byId;
    }
    // 內部
    const inside = labelNode.querySelector && labelNode.querySelector('input, textarea');
    if (inside) return inside;
    // 兄弟與父層（往上幾層，找該層內第一個 input）
    let node = labelNode;
    for (let i = 0; i < 4 && node; i++) {
      let sib = node.nextElementSibling;
      while (sib) {
        if (isInput(sib)) return sib;
        const inner = sib.querySelector && sib.querySelector('input, textarea');
        if (inner) return inner;
        sib = sib.nextElementSibling;
      }
      node = node.parentElement;
      const inParent = node && node.querySelector && node.querySelector('input, textarea');
      if (inParent) return inParent;
    }
    return null;
  }

  function isInput(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea';
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  // ── 既有收件人 / 寫入 ─────────────────────────────────────

  /** 取某元素的文字，但排除「本擴充自己注入的工具列 / toast」，避免把我們顯示的 email 誤判為已存在。 */
  function textExcludingHpx(el) {
    const clone = el.cloneNode(true);
    clone
      .querySelectorAll(
        '.hpx-toolbar, .hpx-besties-toolbar, .hpx-toast-container, [data-hpx-toolbar], [data-hpx-besties-toolbar]'
      )
      .forEach(function (n) {
        n.remove();
      });
    return clone.textContent || '';
  }

  /** 蒐集 CC 欄位目前已有的內容（輸入框值 + 周邊 chip 文字），用於去重。 */
  function collectExisting(ccField) {
    let txt = ccField.value ? ' ' + ccField.value : '';
    // 往上取一個合理的「欄位範圍」容器，涵蓋 chip / token 形式已加入的 email；
    // 但排除我們自己注入的工具列，否則會把名單按鈕上顯示的 email 當成已存在。
    let scope = ccField;
    for (let i = 0; i < 3 && scope.parentElement; i++) {
      scope = scope.parentElement;
    }
    txt += ' ' + textExcludingHpx(scope);
    return txt.toLowerCase();
  }

  /** 觸發框架（Angular 等）能感知的輸入事件。 */
  function fireInput(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** 模擬在 token/chip 輸入框中送出 Enter。 */
  function pressEnter(el) {
    ['keydown', 'keyup'].forEach(function (type) {
      el.dispatchEvent(
        new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })
      );
    });
  }

  /** 看起來像 token / chip 輸入框？（父層已有 chip 樣式節點或 value 通常為空的多選輸入） */
  function looksLikeToken(ccField) {
    const parent = ccField.parentElement;
    if (!parent) return false;
    return !!parent.querySelector(
      '[class*="chip" i], [class*="tag" i], [class*="token" i], [class*="pill" i]'
    );
  }

  // ── react-select 支援（HaloPSA 的 CC 是 react-select）─────────

  function isReactSelectInput(el) {
    if (!el || !el.matches) return false;
    try {
      return el.matches('input[id^="react-select"], input[role="combobox"]');
    } catch (e) {
      return false;
    }
  }

  /** 從 CC 欄位（可能是隱藏的 emailcc）找出 react-select 的可見打字框。 */
  function findReactSelectInput(ccField) {
    if (isReactSelectInput(ccField)) return ccField;
    let node = ccField.parentElement;
    for (let i = 0; i < cfg().lookupDepth && node; i++) {
      let inp = null;
      try {
        inp = node.querySelector('input[id^="react-select"], input[role="combobox"]');
      } catch (e) {
        inp = null;
      }
      if (inp) return inp;
      node = node.parentElement;
    }
    return null;
  }

  /** 用原生 value setter 設值，React 的 onChange 才會被觸發。 */
  function setNativeValue(input, value) {
    const proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(input, value);
    else input.value = value;
  }

  /** 逐一在 react-select 打字框輸入 email → 等選單渲染 → 送 Enter 建立/選取。 */
  function addViaReactSelect(input, emails) {
    let i = 0;
    function step() {
      if (i >= emails.length) return;
      const email = emails[i++];
      input.focus();
      setNativeValue(input, email);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // 等 react-select 把「建立 email」選項渲染出來，再送 Enter
      setTimeout(function () {
        pressEnter(input);
        setTimeout(step, 150);
      }, 150);
    }
    step();
  }

  /** 把多個 email 寫入 CC 欄位。回傳是否成功。 */
  function writeEmails(ccField, emails) {
    if (!emails.length) return true;
    const mode = cfg().ccInputMode || 'auto';

    // 1) react-select 路徑（HaloPSA）：auto 模式下若找得到打字框就用它
    if (mode === 'auto' || mode === 'reactselect') {
      const rsInput = findReactSelectInput(ccField);
      if (rsInput) {
        addViaReactSelect(rsInput, emails);
        return true;
      }
      if (mode === 'reactselect') return false; // 指定 react-select 卻找不到打字框
    }

    // 2) token / chip 輸入框
    if (mode === 'token' || (mode === 'auto' && looksLikeToken(ccField))) {
      ccField.focus();
      emails.forEach(function (email) {
        ccField.value = email;
        fireInput(ccField);
        pressEnter(ccField);
        ccField.value = '';
        fireInput(ccField);
      });
      return true;
    }

    // 3) 一般文字輸入框：逗號分隔接在現有值之後（隱藏欄位無法輸入則失敗）
    if (ccField.type === 'hidden') return false;
    ccField.focus();
    const cur = (ccField.value || '').trim();
    const needsSep = cur.length > 0 && !/[,;]\s*$/.test(cur);
    ccField.value = cur + (needsSep ? ', ' : cur ? ' ' : '') + emails.join(', ');
    fireInput(ccField);
    return true;
  }

  // ── 對外動作 ─────────────────────────────────────────────

  /**
   * 把一組成員加入 CC（去重、不覆蓋既有）。
   * @param {Element} windowEl  寄信視窗容器
   * @param {Array}   members   [{name,email}]
   * @param {string}  [label]   來源群組名稱（用於提示文字）
   */
  function addMembersToCC(windowEl, members, label, options) {
    const silent = options && options.silent === true;
    const root = findWindowContainer(windowEl);
    const ccField = findCcField(root) || findCcField(document);
    if (!ccField) {
      if (!silent) NS.ui.toast.show('找不到 CC 欄位，請協助確認 HaloPSA Email 視窗結構', { type: 'error' });
      return false;
    }

    const existing = collectExisting(ccField);
    const toAdd = members.filter(function (m) {
      return existing.indexOf(m.email.toLowerCase()) === -1;
    });

    if (toAdd.length === 0) {
      const who = label ? '「' + label + '」' : '名單';
      if (!silent) NS.ui.toast.show(who + '已在 CC 中，未重複新增', { type: 'info' });
      return true;
    }

    const ok = writeEmails(ccField, toAdd.map(function (m) {
      return m.email;
    }));
    if (!ok) {
      if (!silent) NS.ui.toast.show('找不到可輸入的 CC 欄位，請協助確認 HaloPSA Email 視窗結構', { type: 'error' });
      return false;
    }

    const msg = label
      ? '已加入「' + label + '」（' + toAdd.length + ' 位）到 CC'
      : '已加入 ' + toAdd.length + ' 位到 CC';
    if (!silent) NS.ui.toast.show(msg, { type: 'success' });
    return true;
  }

  const Besties = {
    getGroups: getGroups,
    getDefaultCcRecipients: getDefaultCcRecipients,

    applyDefaultCc: function (windowEl) {
      if (!windowEl || windowEl.getAttribute('data-hpx-default-cc') === '1') return Promise.resolve(false);
      windowEl.setAttribute('data-hpx-default-cc', '1');
      return getDefaultCcRecipients().then(function (members) {
        if (!members.length) return false;
        return addMembersToCC(windowEl, members, 'Default CC', { silent: true });
      });
    },

    /** 加入整個群組 */
    addGroupToCC: function (windowEl, group) {
      if (!group || !Array.isArray(group.members)) return;
      addMembersToCC(windowEl, group.members, group.name);
    },

    /** 只加入單一成員 */
    addMemberToCC: function (windowEl, member) {
      if (!member || !member.email) return;
      addMembersToCC(windowEl, [member], member.name || member.email);
    },

    /** 開啟設定頁（管理名單）—— content script 不能直接 openOptionsPage，改由背景處理。 */
    openManager: function () {
      try {
        chrome.runtime.sendMessage({ type: 'HPX_OPEN_OPTIONS' });
      } catch (e) {
        NS.warn('無法開啟設定頁', e);
      }
    },

    // 匯出供測試 / 微調
    _findCcField: findCcField,
    _findWindowContainer: findWindowContainer,
  };

  NS.features.besties = Besties;
})();
