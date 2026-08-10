/**
 * editor-detector.js
 * SPA 安全的編輯器偵測器。
 *
 * 職責：
 *  - 初始化時掃描整頁既有編輯器。
 *  - 以單一 MutationObserver 監聽 DOM 變動（含切換工單 / 動態建立編輯器），
 *    透過 requestAnimationFrame 合併爆量變動後再掃描。
 *  - 對每個「新出現且尚未處理」的編輯器，呼叫 onEditorFound callback。
 *  - 對被移除的編輯器，呼叫 onEditorRemoved callback（供清除工具列）。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const ENHANCED_ATTR = 'data-hpx-enhanced';

  let observer = null;
  let scanScheduled = false;
  let callbacks = { onEditorFound: null, onEditorRemoved: null };
  const tracked = new Set(); // 目前追蹤中的編輯器元素

  /** 此頁是否為 HaloPSA（runtime 守門） */
  function isHaloPage() {
    const sels = NS.config.selectors.HALO_SIGNATURE_SELECTORS;
    return sels.some((s) => {
      try {
        return document.querySelector(s) !== null;
      } catch (e) {
        return false;
      }
    });
  }

  /** 判斷編輯器鄰近文字是否命中目標欄位關鍵字 */
  function matchesTargetField(el) {
    const cfg = NS.config.selectors;
    if (cfg.fieldMatchMode === 'loose') return true;

    const keywords = cfg.FIELD_KEYWORDS.map((k) => k.toLowerCase());
    let node = el;
    for (let i = 0; i < cfg.labelLookupDepth && node; i++) {
      const text = (node.textContent || '').toLowerCase();
      const aria = (node.getAttribute && (node.getAttribute('aria-label') || '')) || '';
      const combined = text + ' ' + aria.toLowerCase();
      if (keywords.some((k) => combined.indexOf(k) !== -1)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /** 找出目前頁面所有符合條件的編輯器元素 */
  function findEditors() {
    const sels = NS.config.selectors.EDITOR_SELECTORS;
    const found = [];
    const seen = new Set();
    sels.forEach((sel) => {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        return;
      }
      nodes.forEach((node) => {
        if (seen.has(node)) return;
        seen.add(node);
        found.push(node);
      });
    });
    return found;
  }

  /** 掃描並處理新增 / 移除的編輯器 */
  function scan() {
    scanScheduled = false;
    if (!isHaloPage()) return;

    const editors = findEditors();
    const currentSet = new Set(editors);

    // 新增：尚未處理過的編輯器
    editors.forEach((el) => {
      if (el.getAttribute(ENHANCED_ATTR) === '1') return;
      if (!matchesTargetField(el)) return;

      el.setAttribute(ENHANCED_ATTR, '1');
      tracked.add(el);
      // eslint-disable-next-line no-console
      console.log('[HPX] editor matched', el.tagName ? el.tagName.toLowerCase() : '', el.className || '');
      try {
        callbacks.onEditorFound && callbacks.onEditorFound(el);
      } catch (e) {
        NS.warn('onEditorFound 發生錯誤', e);
      }
    });

    // 移除：已不在 DOM 中的追蹤項目
    tracked.forEach((el) => {
      if (!currentSet.has(el) || !document.contains(el)) {
        tracked.delete(el);
        try {
          callbacks.onEditorRemoved && callbacks.onEditorRemoved(el);
        } catch (e) {
          NS.warn('onEditorRemoved 發生錯誤', e);
        }
      }
    });
  }

  /** 合併爆量變動：以 rAF 排程一次掃描 */
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(scan, 50);
  }

  const Detector = {
    /** 啟動偵測器 */
    start: function (opts) {
      callbacks.onEditorFound = opts && opts.onEditorFound;
      callbacks.onEditorRemoved = opts && opts.onEditorRemoved;

      scan(); // 首次全頁掃描

      observer = new MutationObserver(scheduleScan);
      observer.observe(document.body, { childList: true, subtree: true });
      NS.log('編輯器偵測器已啟動');
    },

    /** 停止偵測器 */
    stop: function () {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },

    /** 強制重新掃描（供外部呼叫） */
    rescan: scheduleScan,
  };

  NS.core.detector = Detector;
})();
