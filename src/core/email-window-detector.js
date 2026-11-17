/**
 * email-window-detector.js
 * SPA 安全的「允許寄信 Action 視窗」偵測器（功能：聯絡人名單 / CC 快速加入）。
 *
 * 偵測訊號：找得到可見的 CC 欄位，再確認 Action 名稱符合寄信白名單；
 * Activity Note、狀態類 Action 即使帶有 emailcc 也必須排除。
 * 與 editor-detector 相同設計：單一 MutationObserver + rAF 合併爆量變動，
 * 對「新出現的寄信視窗」呼叫 onFound，對「已消失的」呼叫 onRemoved。
 *
 * 不影響既有 editor-detector / 工具列（兩者各自獨立運作）。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const ENHANCED_ATTR = 'data-hpx-besties';

  let observer = null;
  let active = false;
  let generation = 0;
  let scanScheduled = false;
  let scheduledHandle = null;
  let scheduledWithRaf = false;
  let scheduleBurstScan = null;
  let callbacks = { onFound: null, onRemoved: null };
  const tracked = new Set(); // 目前追蹤中的寄信視窗容器
  let knownCcNodes = [];
  let knownContainers = [];
  let titleCache = new Map();
  const knownTitles = new Set();
  let onboardingOpen = false;
  const OWN_UI = '[data-hpx-extension-toolbar="true"], .hpx-toolbar, .hpx-sp, .hpx-sp-pet, .hpx-modal-overlay, .hpx-loader, .hpx-toast-container, .hpx-onboarding-overlay';
  const EDITOR_CONTENT = '[contenteditable="true"], .fr-element, .ck-editor__editable, .mce-content-body, .note-editable';

  // These selectors describe a union, not a priority order. One DOM traversal is
  // enough; retain the per-selector fallback for tenant-specific invalid rules.
  function queryAll(root, selectors) {
    if (!root || !root.querySelectorAll || !selectors || !selectors.length) return [];
    try {
      return Array.from(root.querySelectorAll(selectors.join(',')));
    } catch (e) {
      const found = new Set();
      selectors.forEach(function (selector) {
        try { root.querySelectorAll(selector).forEach(function (node) { found.add(node); }); } catch (ignored) { /* invalid selector */ }
      });
      return Array.from(found);
    }
  }

  function matchesAny(node, selectors) {
    if (!node || !node.matches || !selectors || !selectors.length) return false;
    try { return node.matches(selectors.join(',')); } catch (e) {
      return selectors.some(function (selector) {
        try { return node.matches(selector); } catch (ignored) { return false; }
      });
    }
  }

  function closest(node, selector) {
    const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    return element && element.closest ? element.closest(selector) : null;
  }

  function containsCc(node) {
    const selectors = NS.config.besties.CC_FIELD_SELECTORS;
    if (matchesAny(node, selectors)) return true;
    if (!node || !node.querySelector) return false;
    try { return !!node.querySelector(selectors.join(',')); } catch (e) {
      return queryAll(node, selectors).length > 0;
    }
  }

  function touchesKnownWindow(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return knownCcNodes.concat(knownContainers).some(function (known) {
      return node === known || node.contains(known) || known.contains(node);
    });
  }

  function isTitleMutation(node) {
    const selectors = NS.config.besties.ACTION_TITLE_SELECTORS || ['.history-header'];
    let element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    if (element === document.body || element === document.documentElement) return false;
    if (element && Array.from(knownTitles).some(function (title) {
      return title === element || title.contains(element) || element.contains(title);
    })) return true;
    while (element && element !== document.body && element !== document.documentElement) {
      if (matchesAny(element, selectors)) return true;
      element = element.parentElement;
    }
    return false;
  }

  function onMutations(records) {
    if (!active) return;
    const relevant = records.some(function (record) {
      const target = record.target;
      if (target === document.documentElement && record.attributeName === 'class') {
        if (isOnboardingOpen() !== onboardingOpen) return true;
      }
      if (closest(target, OWN_UI) || closest(target, EDITOR_CONTENT)) return false;
      if (record.type === 'characterData') return isTitleMutation(target);
      if (record.type === 'attributes') {
        return touchesKnownWindow(target) || matchesAny(target, NS.config.besties.CC_FIELD_SELECTORS) ||
          matchesAny(target, NS.config.besties.NEW_TICKET_ROOT_SELECTORS) ||
          /new-?ticket/i.test(record.oldValue || '') || isTitleMutation(target);
      }
      const changed = Array.from(record.addedNodes || []).concat(Array.from(record.removedNodes || []));
      // Own toolbar/pet updates must not create a scan -> DOM write -> scan loop.
      const nativeChanged = changed.filter(function (node) { return !closest(node, OWN_UI); });
      if (!nativeChanged.length) return false;
      if (isTitleMutation(target)) return true;
      // Avoid treating body/html as a candidate scope for every unrelated insert.
      if (target !== document.body && target !== document.documentElement &&
          touchesKnownWindow(target)) return true;
      return nativeChanged.some(function (node) {
        return touchesKnownWindow(node) || containsCc(node) ||
          matchesAny(node, NS.config.besties.NEW_TICKET_ROOT_SELECTORS);
      });
    });
    if (relevant) scheduleBurstScan();
  }

  /** Timesheet 等可編輯介面不是寄信視窗，必須在所有偵測路徑中排除。 */
  function isExcluded(element) {
    const selectors = NS.config.besties.EXCLUDED_WINDOW_SELECTORS || [];
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    return selectors.some(function (selector) {
      try {
        return element.matches(selector) || !!element.closest(selector);
      } catch (e) {
        return false;
      }
    });
  }

  function isHaloPage() {
    const sels = NS.config.selectors.HALO_SIGNATURE_SELECTORS;
    return sels.some(function (s) {
      try {
        return document.querySelector(s) !== null;
      } catch (e) {
        return false;
      }
    });
  }

  function isNewTicketPage() {
    const path = String(window.location.pathname || '');
    if (/\/newticket(?:\/|$)/i.test(path)) return true;
    const selectors = NS.config.besties.NEW_TICKET_ROOT_SELECTORS || [];
    return selectors.some(function (selector) {
      try {
        const root = document.querySelector(selector);
        if (!root) return false;
        const style = window.getComputedStyle ? window.getComputedStyle(root) : null;
        return !style || (style.display !== 'none' && style.visibility !== 'hidden');
      } catch (e) {
        return false;
      }
    });
  }

  /** 首次登入提示若因背景頁無法開啟而回退成內嵌精靈，先卸載摯友工具列。 */
  function isOnboardingOpen() {
    return !!(
      document.documentElement &&
      document.documentElement.classList &&
      document.documentElement.classList.contains('hpx-onboarding-open')
    );
  }

  /** 判斷元素及其祖先目前是否可見；hidden input 本身不算可見控制項。 */
  function isVisibleElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    if (element.tagName && element.tagName.toLowerCase() === 'input'
        && String(element.type || '').toLowerCase() === 'hidden') return false;

    let node = element;
    for (let depth = 0; depth < 10 && node; depth += 1) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
      try {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      } catch (e) {
        // Continue with the DOM checks when a browser cannot compute styles yet.
      }
      node = node.parentElement;
    }

    // getClientRects() is the reliable check for Halo's display:none wrappers.
    // Do not require a non-zero rect in test/fallback DOMs that do not implement it.
    if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
    return true;
  }

  function isVisibleControl(element) {
    if (!isVisibleElement(element)) return false;
    if (element.disabled) return false;
    return true;
  }

  /** 只取得 Halo Action 標題文字，不把編輯器內容或 AI 工具列按鈕算進來。 */
  function getActionTitleText(container) {
    if (titleCache.has(container)) return titleCache.get(container);
    const selectors = NS.config.besties.ACTION_TITLE_SELECTORS || [
      '.history-header .outcome.oneline',
      '.history-header .outcome',
      '.history-header',
    ];
    const maxDepth = Number(NS.config.besties.ACTION_TITLE_LOOKUP_DEPTH) || 12;
    let node = container;
    for (let i = 0; i < maxDepth && node; i++) {
      for (let j = 0; j < selectors.length; j++) {
        try {
          const titleNode = node.querySelector && node.querySelector(selectors[j]);
          const text = titleNode && (titleNode.textContent || '').trim();
          if (text) {
            const result = text.replace(/\s+/g, ' ').toLowerCase();
            knownTitles.add(titleNode);
            titleCache.set(container, result);
            return result;
          }
        } catch (e) {
          /* 無效 selector 略過 */
        }
      }
      node = node.parentElement;
    }
    titleCache.set(container, '');
    return '';
  }

  function hasKeyword(container, keywords) {
    const text = getActionTitleText(container);
    return (keywords || []).some(function (keyword) {
      return text.indexOf(String(keyword || '').toLowerCase()) !== -1;
    });
  }

  /** 向上看兩層，涵蓋 Halo 將 Action 標題放在 form 外側的 .newaction 版型。 */
  function hasActionKeyword(container, keywords) {
    let node = container;
    for (let i = 0; i < 3 && node; i++) {
      if (hasKeyword(node, keywords)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /** Activity Note 等非寄信 Action 優先排除，避免 emailcc 強訊號誤判。 */
  function isNonEmailAction(container) {
    return hasActionKeyword(container, NS.config.besties.NON_EMAIL_ACTION_KEYWORDS);
  }

  /** 只允許白名單中的寄信 Action；沒有明確 Action 名稱就不顯示 CC 工具列。 */
  function isSupportedEmailAction(container) {
    if (isNonEmailAction(container)) return false;
    return hasActionKeyword(container, NS.config.besties.EMAIL_ACTION_KEYWORDS);
  }

  /**
   * 確認 CC 目前真的顯示在畫面上。
   * HaloPSA 的 react-select 會把 emailcc 留成 hidden input，實際可操作的
   * input 在同一個小元件內；因此也檢查 hidden input 附近的可見 companion。
   */
  function hasVisibleCcSignal(container) {
    const c = NS.config.besties;
    const ccNodes = queryAll(container, c.CC_FIELD_SELECTORS);

    if (ccNodes.some(isVisibleControl)) return true;

    const companionSelectors = (c.VISIBLE_CC_CONTROL_SELECTORS || []).join(',');
    if (!companionSelectors) return false;
    return ccNodes.some(function (ccNode) {
      let parent = ccNode.parentElement;
      // 只在 CC 元件本身與緊鄰的欄位列找 companion，避免把同一個 Action
      // 裡仍可見的 To 欄位或解決方案編輯器誤認成 CC。
      for (let depth = 0; depth < 2 && parent && parent !== container; depth += 1) {
        try {
          const companion = parent.querySelectorAll(companionSelectors);
          for (let index = 0; index < companion.length; index += 1) {
            const control = companion[index];
            if (control === ccNode) continue;
            if (isVisibleControl(control)) return true;
          }
        } catch (e) {
          /* 無效 selector 略過 */
        }
        parent = parent.parentElement;
      }
      return false;
    });
  }

  /** 蒐集所有可能的寄信視窗容器候選。 */
  function collectCandidates() {
    const c = NS.config.besties;
    const besties = NS.features.besties;
    const set = new Set();

    // a) 只從 CC 欄位推導掛載容器。emailto 不能作為工具列根節點，否則會在
    //    To 上方多掛一條；同一個 emailcc 被多個 selector 命中時 Set 會自動去重。
    knownCcNodes = queryAll(document, c.CC_FIELD_SELECTORS);
    knownCcNodes.forEach(function (cc) {
      if (isExcluded(cc)) return;
      const container = besties._findWindowContainer(cc);
      if (container && !isExcluded(container)) set.add(container);
    });
    // Without any CC field, no generic form/email container can pass the
    // visible-CC check. Do not scan unrelated forms and their ancestor titles.
    knownContainers = Array.from(set).filter(Boolean);
    return knownContainers;
  }

  /**
   * 找出允許顯示聯絡人／CC 工具列的視窗容器。
   * 必須通過寄信 Action 白名單判斷與可見 CC 欄位檢查；
   * Activity Note、狀態類 Action 等其他 Action 一律排除。
   */
  function findEmailWindows(candidates) {

    let windows = candidates.filter(function (el) {
      if (isExcluded(el)) return false;
      // emailcc 可能只是 Halo 留下的 hidden input；只有可見 CC 控制項
      // 存在時才算寄信模式，避免信封關閉後仍殘留工具列。
      return isSupportedEmailAction(el) && hasVisibleCcSignal(el);
    });

    // 只留最內層，避免外層 + 內層重複掛工具列
    windows = windows.filter(function (el) {
      return !windows.some(function (other) {
        return other !== el && el.contains(other);
      });
    });

    NS.log('寄信視窗掃描：候選=' + candidates.length + '，命中=' + windows.length);
    return windows;
  }

  function clearTracked() {
    tracked.forEach(function (el) {
      tracked.delete(el);
      try {
        callbacks.onRemoved && callbacks.onRemoved(el);
      } catch (e) {
        NS.warn('onRemoved（寄信視窗）發生錯誤', e);
      }
      el.removeAttribute(ENHANCED_ATTR);
    });
  }

  function scan() {
    if (!active) return;
    scanScheduled = false;
    scheduledHandle = null;
    titleCache = new Map();
    knownTitles.clear();
    onboardingOpen = isOnboardingOpen();
    const candidates = collectCandidates();
    if (!candidates.length || !isHaloPage() || isNewTicketPage() || onboardingOpen) {
      clearTracked();
      NS.log('寄信視窗掃描：非寄信頁面（含 New Ticket／首次登入提示），略過');
      return;
    }

    const windows = findEmailWindows(candidates);
    const currentSet = new Set(windows);

    // 先移除已失效的舊容器，避免 SPA 結構改變的一瞬間同時存在兩條工具列。
    tracked.forEach(function (el) {
      if (!currentSet.has(el) || !document.contains(el)) {
        tracked.delete(el);
        try {
          callbacks.onRemoved && callbacks.onRemoved(el);
        } catch (e) {
          NS.warn('onRemoved（寄信視窗）發生錯誤', e);
        }
        el.removeAttribute(ENHANCED_ATTR);
      }
    });

    // 新增
    windows.forEach(function (el) {
      if (tracked.has(el)) return;
      el.setAttribute(ENHANCED_ATTR, '1');
      tracked.add(el);
      try {
        callbacks.onFound && callbacks.onFound(el);
      } catch (e) {
        NS.warn('onFound（寄信視窗）發生錯誤', e);
      }
    });
  }

  function scheduleScan() {
    if (!active || scanScheduled) return;
    scanScheduled = true;
    const expectedGeneration = generation;
    const run = function () {
      if (active && expectedGeneration === generation) scan();
    };
    scheduledWithRaf = typeof window.requestAnimationFrame === 'function';
    scheduledHandle = scheduledWithRaf ? window.requestAnimationFrame(run) : window.setTimeout(run, 50);
  }

  /**
   * 信封切換有些版本只改 React state / class，不一定新增或移除節點；
   * tracked window 內的按鈕點擊因此也要觸發一次生命週期掃描。
   */
  function onDocumentClick(event) {
    const target = event && event.target;
    if (!target) return;
    for (const windowEl of tracked) {
      if (windowEl.contains && windowEl.contains(target)) {
        scheduleScan();
        return;
      }
    }
    const control = target.closest && target.closest('button, a, [role="button"], [role="menuitem"]');
    if (!control) return;
    const signal = [
      control.getAttribute('title'),
      control.getAttribute('aria-label'),
      control.className,
      control.textContent,
    ].join(' ').toLowerCase();
    if (/(?:email|mail|寄信|信封)/i.test(signal)) scheduleScan();
  }

  const EmailWindowDetector = {
    start: function (opts) {
      callbacks.onFound = opts && opts.onFound;
      callbacks.onRemoved = opts && opts.onRemoved;
      if (active) { scheduleScan(); return; }
      active = true;
      const expectedGeneration = ++generation;
      scheduleBurstScan = NS.burstScheduler(function () {
        if (active && expectedGeneration === generation) scan();
      }, 150);
      observer = new MutationObserver(onMutations);
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: [
          'class', 'style', 'hidden', 'aria-hidden', 'aria-expanded',
          'aria-pressed', 'aria-checked', 'data-state', 'data-active',
          'data-selected', 'title', 'name', 'id', 'aria-label', 'placeholder', 'type', 'disabled',
        ],
      });
      document.addEventListener('click', onDocumentClick, true);
      ['popstate', 'hashchange', 'pageshow'].forEach(function (name) { window.addEventListener(name, scheduleScan); });
      if (window.navigation && window.navigation.addEventListener) window.navigation.addEventListener('navigate', scheduleScan);
      scan();
      NS.log('寄信視窗偵測器已啟動');
    },

    stop: function () {
      active = false;
      generation += 1;
      if (scheduledHandle !== null) {
        if (scheduledWithRaf && window.cancelAnimationFrame) window.cancelAnimationFrame(scheduledHandle);
        else window.clearTimeout(scheduledHandle);
      }
      scheduledHandle = null;
      scanScheduled = false;
      if (scheduleBurstScan && scheduleBurstScan.cancel) scheduleBurstScan.cancel();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      document.removeEventListener('click', onDocumentClick, true);
      ['popstate', 'hashchange', 'pageshow'].forEach(function (name) { window.removeEventListener(name, scheduleScan); });
      if (window.navigation && window.navigation.removeEventListener) window.navigation.removeEventListener('navigate', scheduleScan);
      clearTracked();
      knownCcNodes = [];
      knownContainers = [];
      titleCache.clear();
      knownTitles.clear();
    },

    rescan: scheduleScan,
  };

  NS.core.emailWindowDetector = EmailWindowDetector;
})();
