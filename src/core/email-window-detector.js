/**
 * email-window-detector.js
 * SPA 安全的「寄信視窗」偵測器（功能：聯絡人名單 / CC 快速加入）。
 *
 * 偵測訊號：找得到 CC 欄位 → 視為一個寄信視窗，並推導出要掛按鈕的容器。
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

  /** 容器鄰近文字是否「像寄信視窗」（避免誤掛）。同時看可見文字與欄位的 placeholder/aria-label。 */
  function looksLikeEmailWindow(container) {
    const kws = NS.config.besties.EMAIL_WINDOW_KEYWORDS.map(function (k) {
      return k.toLowerCase();
    });
    let text = (container.textContent || '').toLowerCase();
    // 有些 UI 只有 placeholder / aria-label（無可見 label 文字），一併納入比對
    try {
      container.querySelectorAll('input, textarea, [aria-label]').forEach(function (f) {
        text += ' ' + (f.getAttribute('placeholder') || '') + ' ' + (f.getAttribute('aria-label') || '');
      });
    } catch (e) {
      /* 略過 */
    }
    text = text.toLowerCase();
    return kws.some(function (k) {
      return text.indexOf(k) !== -1;
    });
  }

  /** 容器內是否有可編輯欄位（用來確認這是一個「撰寫中」的寄信區）。 */
  function hasEditableField(container) {
    return !!(
      container.querySelector &&
      container.querySelector('input, textarea, [contenteditable="true"]')
    );
  }

  /** 容器內是否有 HaloPSA 專屬的寄信欄位（emailcc / emailto…）→ 確定是寄信視窗。 */
  function hasStrongSignal(container) {
    const sels = NS.config.besties.STRONG_FIELD_SELECTORS || [];
    return sels.some(function (s) {
      try {
        return !!container.querySelector(s);
      } catch (e) {
        return false;
      }
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
   * 找出寄信視窗容器。
   * 偵測「按鈕要不要出現」不再硬性要求找得到 CC 欄位（CC 改在點擊時解析、找不到才報錯），
   * 而是看：像寄信視窗（含 主旨/副本/送出/回覆… 關鍵字）+ 內含可編輯欄位。
   */
  function findEmailWindows() {
    if (isNewTicketPage()) return [];
    if (isOnboardingOpen()) return [];
    const candidates = collectCandidates();

    let windows = candidates.filter(function (el) {
      if (isExcluded(el)) return false;
      // 強訊號（emailcc/emailto…）直接認定；否則才需「像寄信視窗 + 有可編輯欄位」
      return hasStrongSignal(el) || (looksLikeEmailWindow(el) && hasEditableField(el));
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

  const EmailWindowDetector = {
    start: function (opts) {
      callbacks.onFound = opts && opts.onFound;
      callbacks.onRemoved = opts && opts.onRemoved;

      scan();
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.body, { childList: true, subtree: true });
      NS.log('寄信視窗偵測器已啟動');
    },

    stop: function () {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },

    rescan: scheduleScan,
  };

  NS.core.emailWindowDetector = EmailWindowDetector;
})();
