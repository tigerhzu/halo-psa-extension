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
  let scanScheduled = false;
  let callbacks = { onFound: null, onRemoved: null };
  const tracked = new Set(); // 目前追蹤中的寄信視窗容器

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
          if (text) return text.replace(/\s+/g, ' ').toLowerCase();
        } catch (e) {
          /* 無效 selector 略過 */
        }
      }
      node = node.parentElement;
    }
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
    const ccNodes = [];
    const seen = new Set();
    (c.CC_FIELD_SELECTORS || []).forEach(function (selector) {
      try {
        container.querySelectorAll(selector).forEach(function (node) {
          if (seen.has(node)) return;
          seen.add(node);
          ccNodes.push(node);
        });
      } catch (e) {
        /* 無效 selector 略過 */
      }
    });

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
    c.CC_FIELD_SELECTORS.forEach(function (sel) {
      try {
        document.querySelectorAll(sel).forEach(function (cc) {
          if (isExcluded(cc)) return;
          const container = besties._findWindowContainer(cc);
          if (container && !isExcluded(container)) set.add(container);
        });
      } catch (e) {
        /* 無效 selector 略過 */
      }
    });

    if (!set.size) {
      // b) 沒有 HaloPSA 專屬欄位時，才使用通用容器 selector 作為後援。
      c.EMAIL_WINDOW_SELECTORS.forEach(function (sel) {
        try {
          document.querySelectorAll(sel).forEach(function (n) {
            if (!isExcluded(n)) set.add(n);
          });
        } catch (e) {
          /* 無效 selector 略過 */
        }
      });
    }

    return Array.from(set).filter(Boolean);
  }

  /**
   * 找出允許顯示聯絡人／CC 工具列的視窗容器。
   * 必須通過寄信 Action 白名單判斷與可見 CC 欄位檢查；
   * Activity Note、狀態類 Action 等其他 Action 一律排除。
   */
  function findEmailWindows() {
    if (isNewTicketPage()) return [];
    if (isOnboardingOpen()) return [];
    const candidates = collectCandidates();

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
    scanScheduled = false;
    if (!isHaloPage() || isNewTicketPage() || isOnboardingOpen()) {
      clearTracked();
      NS.log('寄信視窗掃描：非寄信頁面（含 New Ticket／首次登入提示），略過');
      return;
    }

    const windows = findEmailWindows();
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
      if (el.getAttribute(ENHANCED_ATTR) === '1') return;
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
    if (scanScheduled) return;
    scanScheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(scan, 50);
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

      scan();
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'class', 'style', 'hidden', 'aria-hidden', 'aria-expanded',
          'aria-pressed', 'aria-checked', 'data-state', 'data-active',
          'data-selected', 'title',
        ],
      });
      document.addEventListener('click', onDocumentClick, true);
      NS.log('寄信視窗偵測器已啟動');
    },

    stop: function () {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      document.removeEventListener('click', onDocumentClick, true);
    },

    rescan: scheduleScan,
  };

  NS.core.emailWindowDetector = EmailWindowDetector;
})();
