/**
 * time-adjuster.js
 * 「Time Taken 快速調整」：在 HaloPSA 原生 Time Taken（時／分／秒）欄位下方
 * 插入一組快速調整工具列。
 *
 * 範圍限制：
 *  - 只操作目前頁面的 DOM，不呼叫任何 HaloPSA API。
 *  - 不自動儲存、不送出 Action，也不碰 Action 內容編輯器或 Job Code。
 *  - 所有按鈕都直接寫回 HaloPSA 原生的三個欄位，不是只改自己顯示的數字。
 *
 * 框架相容性：
 *  HaloPSA 由前端框架控管欄位狀態，單純 `element.value = x` 可能不會被框架看見。
 *  因此寫入時使用 HTMLInputElement.prototype 的原生 value setter，再依序派發
 *  input / change / blur / focusout 事件，確保框架內部狀態真的收到新值。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const cfg = NS.config.timeAdjuster;
  const core = NS.features.timeAdjusterCore;

  const TOOLBAR_CLASS = 'hpx-tta';
  const UNIT_ORDER = ['hours', 'minutes', 'seconds'];
  /** 可能承載 Time Taken 標籤文字的元素；不比對 class，只比對文字。 */
  const LABEL_TAGS = 'label, span, div, td, th, legend, p, strong, b, h1, h2, h3, h4, h5, h6';

  let observer = null;
  let scanTimer = null;
  let started = false;
  /** container 元素 → group 狀態 */
  const groups = new Map();

  // ── 共用小工具 ──────────────────────────────────────────────

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(text, className, handler) {
    const node = el('button', className, text);
    node.type = 'button'; // 絕對不能是 submit，否則會意外送出 Action
    if (handler) node.addEventListener('click', handler);
    return node;
  }

  /**
   * 只取「本節點自己的文字子節點」，不遞迴子樹。
   *
   * 這不只是精確度考量，也是效能考量：掃描時會走過整頁的 div/span，
   * 若改用 textContent 會把整個子樹序列化一次，在 HaloPSA 這種大型 SPA 上
   * 每次 DOM 變動都重算會非常昂貴。標籤文字本來就是節點自己的文字節點。
   */
  function ownText(node) {
    if (!node || !node.childNodes) return '';
    let text = '';
    for (let i = 0; i < node.childNodes.length; i += 1) {
      const child = node.childNodes[i];
      if (child.nodeType === 3) text += child.nodeValue || ''; // 3 = TEXT_NODE
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function isHaloPage() {
    const list = (NS.config.selectors && NS.config.selectors.HALO_SIGNATURE_SELECTORS) || [];
    return list.some(function (selector) {
      try {
        return document.querySelector(selector) !== null;
      } catch (e) {
        return false;
      }
    });
  }

  // ── 框架安全的欄位寫入 ──────────────────────────────────────

  /**
   * 取得原生的 value setter。
   * 框架（例如 React）會在元素實例上覆寫 value 的存取器並記錄「上次的值」；
   * 直接走 prototype 上的原生 setter 可以繞過那層追蹤，讓後續事件被視為真正的變更。
   */
  function nativeValueSetter() {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      return descriptor && descriptor.set ? descriptor.set : null;
    } catch (e) {
      return null;
    }
  }

  function dispatch(input, type, EventCtor, options) {
    try {
      input.dispatchEvent(new EventCtor(type, options));
    } catch (e) {
      // 極舊環境的保底：至少讓事件流程不中斷。
      try {
        const legacy = document.createEvent('Event');
        legacy.initEvent(type, !!(options && options.bubbles), true);
        input.dispatchEvent(legacy);
      } catch (inner) {
        NS.warn('無法派發事件 ' + type, inner);
      }
    }
  }

  /**
   * 寫入單一欄位並通知框架。
   * 事件順序刻意固定：input（框架 onChange）→ change（原生表單／Angular）
   * → blur / focusout（部分欄位在失焦時才提交）。
   */
  function setFieldValue(input, value) {
    if (!input) return;
    const setter = nativeValueSetter();
    if (setter) setter.call(input, value);
    else input.value = value;

    const InputEventCtor = typeof InputEvent === 'function' ? InputEvent : Event;
    const FocusEventCtor = typeof FocusEvent === 'function' ? FocusEvent : Event;
    dispatch(input, 'input', InputEventCtor, { bubbles: true });
    dispatch(input, 'change', Event, { bubbles: true });
    dispatch(input, 'blur', FocusEventCtor, { bubbles: false });
    dispatch(input, 'focusout', FocusEventCtor, { bubbles: true });
  }

  // ── Time Taken 欄位偵測 ─────────────────────────────────────

  /** 我們自己的工具列輸入框不可被當成 Halo 原生欄位。 */
  function isOwnUi(node) {
    return !!(node && node.closest && node.closest('.' + TOOLBAR_CLASS));
  }

  function attributeHintText(input) {
    const parts = [
      input.getAttribute('aria-label'),
      input.getAttribute('placeholder'),
      input.getAttribute('name'),
      input.getAttribute('id'),
      input.getAttribute('title'),
      input.getAttribute('data-unit'),
    ];
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  /**
   * 是否像時間輸入框。
   * 不比對 class 名稱（Halo 的 class 會變動），只看型別與「小的數字欄位」特徵。
   */
  function isTimeInput(input) {
    if (!input || input.tagName !== 'INPUT') return false;
    if (isOwnUi(input)) return false;
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    if (['number', 'text', 'tel'].indexOf(type) === -1) return false;
    if (input.disabled || input.readOnly) return false;
    if (input.hidden) return false;

    const maxLength = Number(input.getAttribute('maxlength'));
    if (Number.isFinite(maxLength) && maxLength > 0 && maxLength <= 3) return true;

    const max = Number(input.getAttribute('max'));
    if (Number.isFinite(max) && max > 0 && max <= 99) return true;

    const hint = attributeHintText(input);
    const hinted = UNIT_ORDER.some(function (unit) {
      return cfg.UNIT_HINTS[unit].some(function (keyword) {
        return hint.indexOf(keyword) !== -1;
      });
    });
    if (hinted) return true;

    // 保底：目前值看起來就是兩三位數的時間欄位。
    return /^\s*\d{0,3}\s*$/.test(input.value || '');
  }

  function matchesLabelText(text) {
    if (!text || text.length > cfg.LABEL_MAX_LENGTH) return false;
    return cfg.LABEL_PATTERNS.some(function (pattern) {
      return pattern.test(text);
    });
  }

  /**
   * 標籤候選：本節點自己的文字短、且開頭就是 Time Taken 之類的字樣。
   * 有些畫面把標籤放在 aria-label / title 而沒有可見文字，一併比對。
   */
  function isLabelCandidate(node) {
    if (matchesLabelText(ownText(node))) return true;
    if (!node || typeof node.getAttribute !== 'function') return false;
    const aria = (node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (matchesLabelText(aria)) return true;
    const title = (node.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    return matchesLabelText(title);
  }

  /** 單一欄位形式：整格就是 `00:19:40` 或 `00:19`。 */
  function isCombinedTimeInput(input) {
    if (!input || input.tagName !== 'INPUT') return false;
    if (isOwnUi(input)) return false;
    if (input.disabled || input.readOnly || input.hidden) return false;
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    if (['text', 'tel', 'time'].indexOf(type) === -1) return false;
    return cfg.COMBINED_PATTERN.test(input.value || '');
  }

  /**
   * 時間欄位幾乎一定是同一層的兄弟節點；優先取同一個父層的組合。
   * 接受三格（時分秒）或兩格（時分）—— 不同動作型別的 Time Taken 格數不一定相同。
   */
  function pickTriplet(candidates) {
    if (candidates.length < cfg.MIN_FIELDS) return null;
    const byParent = new Map();
    candidates.forEach(function (input) {
      const parent = input.parentElement;
      if (!parent) return;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(input);
    });

    // 先找同層剛好三格的，再退而求其次找同層兩格的。
    let best = null;
    byParent.forEach(function (list) {
      if (list.length >= 3 && (!best || list.length < best.length)) best = list;
    });
    if (best) return best.slice(0, 3);

    byParent.forEach(function (list) {
      if (list.length === 2 && !best) best = list;
    });
    if (best) return best.slice(0, 2);

    return candidates.length >= 3 ? candidates.slice(0, 3) : candidates.slice(0, 2);
  }

  /**
   * 依提示文字判斷時／分／秒；提示不完整時退回文件順序。
   * 只有兩格時視為「時、分」，沒有秒欄位。
   */
  function assignUnits(inputs) {
    const assigned = { hours: null, minutes: null, seconds: null };
    const used = new Set();

    UNIT_ORDER.forEach(function (unit) {
      const keywords = cfg.UNIT_HINTS[unit];
      const match = inputs.find(function (input) {
        if (used.has(input)) return false;
        const hint = attributeHintText(input);
        return keywords.some(function (keyword) { return hint.indexOf(keyword) !== -1; });
      });
      if (match) {
        assigned[unit] = match;
        used.add(match);
      }
    });

    const needed = inputs.length >= 3 ? UNIT_ORDER : ['hours', 'minutes'];
    const complete = needed.every(function (unit) { return assigned[unit]; });
    if (complete && (inputs.length >= 3 || !assigned.seconds)) return assigned;

    // 提示不完整就不要半猜半信，一律改用文件順序：時、分、（秒）。
    return { hours: inputs[0], minutes: inputs[1], seconds: inputs[2] || null };
  }

  function findGroupFromLabel(labelEl) {
    let node = labelEl;
    let combinedFallback = null;

    for (let depth = 0; node && depth <= cfg.CONTAINER_LOOKUP_DEPTH; depth += 1) {
      let inputs;
      try {
        inputs = Array.prototype.slice.call(node.querySelectorAll('input'));
      } catch (e) {
        inputs = [];
      }

      const triplet = pickTriplet(inputs.filter(isTimeInput));
      if (triplet && triplet.length >= cfg.MIN_FIELDS) {
        return { container: node, fields: assignUnits(triplet), mode: triplet.length >= 3 ? 'triple' : 'pair' };
      }

      // 多格找不到時，記下最靠近的「單一 00:19:40 欄位」當備案，
      // 但先繼續往上找多格，多格才是主要形狀。
      if (!combinedFallback) {
        const combined = inputs.find(isCombinedTimeInput);
        if (combined) combinedFallback = { container: node, fields: { combined: combined }, mode: 'combined' };
      }

      node = node.parentElement;
    }

    return combinedFallback;
  }

  /** 掃出目前頁面所有 Time Taken 區塊（可能同時有多個 Action 編輯中）。 */
  function findTimeTakenGroups() {
    const found = [];
    const seenContainers = new Set();
    const seenInputs = new Set();
    let nodes;
    try {
      nodes = document.querySelectorAll(LABEL_TAGS);
    } catch (e) {
      return found;
    }

    Array.prototype.forEach.call(nodes, function (node) {
      if (isOwnUi(node) || !isLabelCandidate(node)) return;
      const group = findGroupFromLabel(node);
      if (!group) return;
      if (seenContainers.has(group.container)) return;
      // 同一組欄位可能被外層與內層各命中一次，用欄位本身去重。
      const keyInput = primaryField(group.fields);
      if (!keyInput || seenInputs.has(keyInput)) return;
      seenContainers.add(group.container);
      seenInputs.add(keyInput);
      found.push(group);
    });

    return found;
  }

  // ── 單一 Time Taken 區塊的控制器 ────────────────────────────

  /** 這一組欄位的代表節點，用於去重與存在性檢查。 */
  function primaryField(fields) {
    return (fields && (fields.hours || fields.combined)) || null;
  }

  function fieldList(fields) {
    return [fields.combined, fields.hours, fields.minutes, fields.seconds].filter(Boolean);
  }

  function readTotalSeconds(fields) {
    if (fields.combined) {
      const match = cfg.COMBINED_PATTERN.exec(fields.combined.value || '');
      if (!match) return 0;
      return core.toTotalSeconds({ hours: match[1], minutes: match[2], seconds: match[3] || 0 });
    }
    return core.toTotalSeconds({
      hours: fields.hours ? fields.hours.value : 0,
      minutes: fields.minutes ? fields.minutes.value : 0,
      // 只有時、分兩格時沒有秒欄位，一律視為 0。
      seconds: fields.seconds ? fields.seconds.value : 0,
    });
  }

  function writeTotalSeconds(fields, totalSeconds) {
    const parts = core.toParts(totalSeconds);

    if (fields.combined) {
      // 保留原本是 HH:MM 還是 HH:MM:SS 的格式，不擅自改變欄位樣式。
      const hadSeconds = /^\s*\d{1,3}:[0-5]\d:[0-5]\d\s*$/.test(fields.combined.value || '');
      const text = hadSeconds
        ? parts.hours + ':' + parts.minutes + ':' + parts.seconds
        : parts.hours + ':' + parts.minutes;
      setFieldValue(fields.combined, text);
      return parts.totalSeconds;
    }

    setFieldValue(fields.hours, parts.hours);
    setFieldValue(fields.minutes, parts.minutes);
    if (fields.seconds) setFieldValue(fields.seconds, parts.seconds);
    return parts.totalSeconds;
  }

  /** 項目之間的細分隔線，讓整條工具列讀起來像 `目前 15 分鐘｜-5 分｜…`。 */
  function separator() {
    const node = el('span', 'hpx-tta-sep');
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  /**
   * 單一橫向長條：所有項目都是 root 的直接子節點，不再包 buttons / manual 兩層。
   * 巢狀容器會讓它在窄版面被折成多行、看起來像一塊面板，這裡刻意攤平。
   */
  function buildToolbar(state) {
    const root = el('div', TOOLBAR_CLASS);
    root.setAttribute(cfg.MARK_ATTR, 'true');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Time Taken 快速調整');

    const summary = el('span', 'hpx-tta-summary');
    root.appendChild(summary);

    cfg.PRESETS.forEach(function (preset) {
      root.appendChild(separator());
      root.appendChild(button(preset.label, 'hpx-tta-btn', function () {
        state.apply(core.addMinutes(state.read(), preset.deltaMinutes));
      }));
    });

    root.appendChild(separator());
    root.appendChild(button('歸零', 'hpx-tta-btn hpx-tta-btn--reset', function () {
      state.apply(core.reset());
    }));

    root.appendChild(separator());
    const minutesInput = document.createElement('input');
    minutesInput.type = 'number';
    minutesInput.min = '0';
    minutesInput.step = '1';
    minutesInput.className = 'hpx-tta-input';
    minutesInput.placeholder = '分鐘數';
    minutesInput.setAttribute('aria-label', '輸入分鐘數');

    const applyMinutes = function () {
      const minutes = core.parseMinutesInput(minutesInput.value);
      if (minutes === null) {
        minutesInput.classList.add('is-invalid');
        summary.classList.add('is-invalid');
        summary.textContent = '請輸入 0 以上的分鐘數';
        return;
      }
      minutesInput.classList.remove('is-invalid');
      summary.classList.remove('is-invalid');
      state.apply(core.fromMinutes(minutes));
    };

    minutesInput.addEventListener('keydown', function (event) {
      // 在 Action 表單內按 Enter 很可能觸發送出，這裡必須擋掉。
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        applyMinutes();
      }
    });
    minutesInput.addEventListener('input', function () {
      minutesInput.classList.remove('is-invalid');
    });

    root.appendChild(minutesInput);
    root.appendChild(separator());
    root.appendChild(button('套用', 'hpx-tta-btn hpx-tta-btn--apply', applyMinutes));

    return { root: root, summary: summary, minutesInput: minutesInput };
  }

  /** 三個欄位共同的最近祖先，也就是「Time Taken 那一列」本身。 */
  function commonAncestor(nodes) {
    const list = nodes.filter(Boolean);
    if (!list.length) return null;
    let current = list[0].parentElement;
    while (current) {
      const holdsAll = list.every(function (node) { return current.contains(node); });
      if (holdsAll) return current;
      current = current.parentElement;
    }
    return list[0].parentElement;
  }

  /**
   * 把工具列掛上去。
   *
   * 'beside'（預設）：放進「Time Taken 欄位所在的那一列」的最後面，
   *   也就是緊接在原生時／分／秒欄位旁邊，而不是整個 Action 區塊的下方。
   * 'below'：維持舊行為，插在整個 Time Taken 區塊之後獨立成一行。
   */
  /**
   * 這個容器是不是「剛好只包住時間欄位」的窄框
   * （例如 `<div><input>:<input>:<input></div>` 這種 time widget）。
   *
   * 是的話工具列要掛在它外面 —— 仍然是同一行，但不會被塞進小方框裡擠爆。
   * 只有欄位本身、包住欄位的節點，以及 1~2 個字的分隔符（":"）才算「窄框內容」。
   */
  function isTightTimeWrapper(row, inputs) {
    const children = Array.prototype.slice.call(row.children || []);
    if (!children.length) return false;
    return children.every(function (child) {
      if (inputs.indexOf(child) !== -1) return true;
      if (inputs.some(function (input) { return child.contains && child.contains(input); })) return true;
      const text = ownText(child);
      return text.length >= 1 && text.length <= 2;
    });
  }

  /** 這個父節點會不會把子節點排成同一行（flex row / grid）。取不到樣式時保守當作 block。 */
  function placesChildrenInline(parent) {
    try {
      const style = window.getComputedStyle(parent);
      if (!style) return false;
      const display = String(style.display || '');
      if (display === 'grid' || display === 'inline-grid') return true;
      if (display === 'flex' || display === 'inline-flex') {
        return String(style.flexDirection || 'row').indexOf('row') === 0;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 找出「插在它後面就會落到下一行、且靠左」的節點。
   *
   * 直接插在欄位容器後面不一定會換行 —— Halo 的欄位列常是 flex row，
   * 那樣只會被排到右邊。因此往上走出 flex/grid 容器，直到父層是一般 block 版面為止。
   */
  function blockAnchor(row) {
    let anchor = row;
    for (let depth = 0; depth < cfg.BLOCK_ANCHOR_DEPTH && anchor.parentElement; depth += 1) {
      if (!placesChildrenInline(anchor.parentElement)) return anchor;
      anchor = anchor.parentElement;
    }
    return anchor;
  }

  function mountToolbar(container, fields, toolbar) {
    const allFields = fieldList(fields);

    // 預設：放在完整的時：分：秒欄位「正下方」，絕不插進欄位之間。
    if (cfg.INSERT_MODE !== 'beside') {
      const fieldsRow = commonAncestor(allFields);
      const anchor = fieldsRow ? blockAnchor(fieldsRow) : null;
      if (anchor && anchor.parentElement) {
        toolbar.classList.add('hpx-tta--block');
        anchor.insertAdjacentElement('afterend', toolbar);
        return;
      }
    }

    if (cfg.INSERT_MODE === 'beside') {
      const inputs = allFields;
      const row = commonAncestor(inputs);
      const lastField = inputs[inputs.length - 1];
      if (row && lastField) {
        // 預設掛在「包住最後一個時間欄位的那個直接子節點」正後方，
        // 而不是 appendChild()：容器尾端可能還有驗證訊息或其他欄位，
        // append 進去就會被擠到下一行、看起來變成一塊面板。
        let host = row;
        let anchor = lastField;
        if (isTightTimeWrapper(row, inputs) && row.parentElement) {
          host = row.parentElement;
          anchor = row;
        }
        while (anchor.parentElement && anchor.parentElement !== host) {
          anchor = anchor.parentElement;
        }
        toolbar.classList.add('hpx-tta--inline');
        if (anchor.parentElement === host) anchor.insertAdjacentElement('afterend', toolbar);
        else host.appendChild(toolbar);
        return;
      }
    }
    if (container.parentElement) container.insertAdjacentElement('afterend', toolbar);
    else container.appendChild(toolbar);
  }

  function createGroup(descriptor) {
    const fields = descriptor.fields;
    const container = descriptor.container;
    const listeners = [];
    let attributeObserver = null;
    let ui = null;

    const state = {
      read: function () {
        return readTotalSeconds(fields);
      },
      apply: function (totalSeconds) {
        writeTotalSeconds(fields, totalSeconds);
        state.refresh();
      },
      refresh: function () {
        if (!ui) return;
        const total = readTotalSeconds(fields);
        ui.summary.classList.remove('is-invalid');
        ui.summary.textContent = '目前 ' + core.formatSummary(total);
        ui.summary.title = 'Time Taken ' + core.toClock(total);
      },
    };

    ui = buildToolbar(state);

    const inputs = fieldList(fields);

    // 使用者手動修改原生欄位時，工具列顯示要同步更新。
    inputs.forEach(function (input) {
      ['input', 'change', 'blur'].forEach(function (type) {
        const handler = function () { state.refresh(); };
        input.addEventListener(type, handler);
        listeners.push({ input: input, type: type, handler: handler });
      });
    });

    // 框架重新渲染而改寫 value 屬性時也要同步（不靠輪詢）。
    try {
      attributeObserver = new MutationObserver(function () { state.refresh(); });
      inputs.forEach(function (input) {
        attributeObserver.observe(input, { attributes: true, attributeFilter: ['value'] });
      });
    } catch (e) {
      attributeObserver = null;
    }

    mountToolbar(container, fields, ui.root);
    container.setAttribute(cfg.MARK_ATTR, 'true');
    state.refresh();

    return {
      container: container,
      fields: fields,
      root: ui.root,
      refresh: state.refresh,
      destroy: function () {
        listeners.forEach(function (entry) {
          entry.input.removeEventListener(entry.type, entry.handler);
        });
        listeners.length = 0;
        if (attributeObserver) attributeObserver.disconnect();
        if (ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
        try {
          container.removeAttribute(cfg.MARK_ATTR);
        } catch (e) {
          /* 節點可能已被框架移除，忽略 */
        }
      },
    };
  }

  // ── 掃描與生命週期 ──────────────────────────────────────────

  function isStillMounted(group) {
    if (!document.contains(group.container)) return false;
    const inputs = fieldList(group.fields);
    return inputs.length > 0 && inputs.every(function (input) { return document.contains(input); });
  }

  /**
   * 找出這個區塊殘留的舊工具列。
   * 'beside' 模式在容器內部，'below' 模式是容器的下一個兄弟節點，兩種都要檢查。
   */
  function findExistingToolbar(container) {
    let inside = null;
    try {
      inside = container.querySelector('.' + TOOLBAR_CLASS);
    } catch (e) {
      inside = null;
    }
    if (inside) return inside;
    const next = container.nextElementSibling;
    return next && next.classList && next.classList.contains(TOOLBAR_CLASS) ? next : null;
  }

  function scan() {
    scanTimer = null;
    if (!isHaloPage()) return;

    // 先清掉已被 SPA 移除的區塊（關閉 Action 後再開啟不會殘留或重複）。
    Array.from(groups.keys()).forEach(function (container) {
      const group = groups.get(container);
      if (!isStillMounted(group)) {
        group.destroy();
        groups.delete(container);
      }
    });

    findTimeTakenGroups().forEach(function (descriptor) {
      // 已由控制器管理中 → 絕不重複插入。
      if (groups.has(descriptor.container)) return;

      // 走到這裡代表沒有對應的控制器。若仍留著上一輪的工具列
      // （例如框架把容器搬移／重建，導致舊控制器已被清掉），
      // 先移除殘留節點再重建，確保同一區塊永遠只有一組工具列。
      const stale = findExistingToolbar(descriptor.container);
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
      descriptor.container.removeAttribute(cfg.MARK_ATTR);

      try {
        groups.set(descriptor.container, createGroup(descriptor));
        NS.log('Time Taken 快速調整已掛載');
      } catch (error) {
        NS.warn('Time Taken 工具列掛載失敗', error);
      }
    });
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(scan, cfg.SCAN_DEBOUNCE_MS);
  }

  /** 只有節點增減才可能出現／消失 Time Taken 區塊；純屬性變動不必重掃。 */
  function onMutations(records) {
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      if (record.addedNodes.length || record.removedNodes.length) {
        scheduleScan();
        return;
      }
    }
  }

  function start() {
    if (started) return;
    started = true;
    scan();
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true });
    NS.log('Time Taken 快速調整偵測器已啟動');
  }

  function stop() {
    started = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    groups.forEach(function (group) { group.destroy(); });
    groups.clear();
  }

  /**
   * 診斷用：在 DevTools Console 執行 `__HPX.features.timeAdjuster.debug()`。
   *
   * 用途：某個動作（例如 On Hold）沒有出現工具列時，可以直接看出是
   * 「找不到標籤」還是「找到標籤但認不出欄位」，不必猜。
   */
  function debug() {
    const report = { labels: [], mounted: groups.size, insertMode: cfg.INSERT_MODE };
    let nodes = [];
    try {
      nodes = Array.prototype.slice.call(document.querySelectorAll(LABEL_TAGS));
    } catch (e) {
      nodes = [];
    }

    nodes.forEach(function (node) {
      if (isOwnUi(node) || !isLabelCandidate(node)) return;
      const group = findGroupFromLabel(node);
      const nearby = [];
      let scope = node;
      for (let depth = 0; scope && depth <= cfg.CONTAINER_LOOKUP_DEPTH && nearby.length === 0; depth += 1) {
        try {
          Array.prototype.forEach.call(scope.querySelectorAll('input'), function (input) {
            nearby.push({
              type: input.getAttribute('type') || 'text',
              value: input.value,
              maxlength: input.getAttribute('maxlength'),
              max: input.getAttribute('max'),
              name: input.getAttribute('name'),
              id: input.getAttribute('id'),
              ariaLabel: input.getAttribute('aria-label'),
              placeholder: input.getAttribute('placeholder'),
              disabled: !!input.disabled,
              readOnly: !!input.readOnly,
              acceptedAsTimeField: isTimeInput(input),
              acceptedAsCombined: isCombinedTimeInput(input),
            });
          });
        } catch (e) {
          /* 忽略無法查詢的節點 */
        }
        scope = scope.parentElement;
      }

      report.labels.push({
        labelText: ownText(node) || node.getAttribute('aria-label') || node.getAttribute('title') || '',
        labelTag: node.tagName,
        resolved: !!group,
        mode: group ? group.mode : null,
        alreadyMounted: !!(group && groups.has(group.container)),
        nearbyInputs: nearby,
      });
    });

    // eslint-disable-next-line no-console
    console.log('[HPX] Time Taken 偵測報告', report);
    return report;
  }

  NS.features.timeAdjuster = {
    start: start,
    stop: stop,
    rescan: scheduleScan,
    debug: debug,
    // 供除錯與測試觀察目前掛載狀態
    _groups: groups,
    _internals: {
      isTimeInput: isTimeInput,
      isCombinedTimeInput: isCombinedTimeInput,
      isLabelCandidate: isLabelCandidate,
      assignUnits: assignUnits,
      pickTriplet: pickTriplet,
      primaryField: primaryField,
      fieldList: fieldList,
      commonAncestor: commonAncestor,
      mountToolbar: mountToolbar,
      blockAnchor: blockAnchor,
      findGroupFromLabel: findGroupFromLabel,
      findTimeTakenGroups: findTimeTakenGroups,
      readTotalSeconds: readTotalSeconds,
      writeTotalSeconds: writeTotalSeconds,
      setFieldValue: setFieldValue,
    },
  };
})();
