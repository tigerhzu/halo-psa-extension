/**
 * editor-detector.js
 * SPA 安全的編輯器偵測器。
 *
 * 職責：
 *  - 初始化時掃描整頁既有編輯器。
 *  - 以單一 MutationObserver 監聽 documentElement 的相關 DOM 變動（含切換
 *    工單 / 動態建立編輯器 / editor attribute lifecycle），透過
 *    requestAnimationFrame 合併爆量變動後再掃描。
 *  - 對每個「新出現且尚未處理」的編輯器，呼叫 onEditorFound callback。
 *  - 對被移除的編輯器，呼叫 onEditorRemoved callback（供清除工具列）。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const ENHANCED_ATTR = 'data-hpx-enhanced';
  const OBSERVED_ATTRIBUTES = [
    'class',
    'contenteditable',
    'name',
    'id',
    'hidden',
    'style',
    'role',
    'aria-label',
    'data-testid',
    'data-test',
  ];

  let observer = null;
  let scanScheduled = false;
  let scheduledHandle = null;
  let scheduledWithRaf = false;
  let callbacks = { onEditorFound: null, onEditorRemoved: null, onScan: null };
  const tracked = new Set(); // 目前追蹤中的編輯器元素

  function safeMatches(node, selectors) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE || !node.matches) return false;
    const list = Array.isArray(selectors) ? selectors : [selectors];
    return list.some(function (selector) {
      try {
        return !!selector && node.matches(selector);
      } catch (e) {
        return false;
      }
    });
  }

  function safeContainsEditor(node) {
    if (!node || !node.querySelectorAll) return false;
    if (safeMatches(node, NS.config.selectors.EDITOR_SELECTORS)) return true;
    const selectors = NS.config.selectors.EDITOR_SELECTORS;
    return selectors.some(function (selector) {
      try {
        return node.querySelector(selector) !== null;
      } catch (e) {
        return false;
      }
    });
  }

  function isExtensionToolbar(node) {
    if (!node || !node.getAttribute) return false;
    return node.getAttribute('data-' + NS.PREFIX + '-extension-toolbar') === 'true';
  }

  /**
   * 判斷 mutation target 是否仍與目前 editor 的 lifecycle 有關。
   * 這讓 observer 可以掛在穩定的 documentElement，卻不會因 Halo 其它區塊
   * 的每一個無關 mutation 都做整頁 scan。
   */
  function touchesTrackedEditor(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return Array.from(tracked).some(function (editor) {
      if (!editor) return false;
      return node === editor ||
        !!(node.contains && node.contains(editor)) ||
        !!(editor.contains && editor.contains(node));
    });
  }

  function touchesTrackedEditorScope(node) {
    let current = node;
    // label / Email 欄位常是 editor 的 sibling；向上走有限深度即可涵蓋
    // editor root、欄位 wrapper 與 action container，不必把每次 mutation 都
    // 當成全頁 scan。
    for (let depth = 0; current && depth <= 10; depth += 1) {
      // body / documentElement 是全頁共同祖先；若把它們算進來，任何無關
      // 區塊的 mutation 都會因為頁面上「有 editor」而觸發 scan。
      if (current === document.body || current === document.documentElement) break;
      if (touchesTrackedEditor(current)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function isInsideTrackedEditor(node) {
    if (!node) return false;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return false;
    return Array.from(tracked).some(function (editor) {
      return editor && editor !== element && editor.contains && editor.contains(element);
    });
  }

  function isEditorContentMutationTarget(node) {
    if (!node) return false;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return false;
    return Array.from(tracked).some(function (editor) {
      return editor && (editor === element || (editor.contains && editor.contains(element)));
    });
  }

  function isRelevantChildList(record) {
    const changed = Array.prototype.slice.call(record.addedNodes || [])
      .concat(Array.prototype.slice.call(record.removedNodes || []));
    if (changed.some(function (node) {
      return safeContainsEditor(node) || isExtensionToolbar(node);
    })) return true;

    // contenteditable 內的文字 / inline formatting 變動不是 toolbar lifecycle；
    // 不要因使用者每次輸入或編輯器內部重排而觸發全域 reconcile。
    if (isEditorContentMutationTarget(record.target)) return false;

    // label、Email 欄位或 editor wrapper 可能是分批掛上的；只要變動發生在
    // 目前 editor 的 scope 內，也要讓 ensureEditorToolbar 重新解析 mount target。
    return touchesTrackedEditorScope(record.target);
  }

  function isRelevantCharacterData(record) {
    const parent = record.target && record.target.parentElement;
    if (!parent) return false;

    // editor 內容本身會隨使用者打字產生 characterData mutation；那不會改變
    // toolbar mount target，必須排除，避免每個字都觸發 reconcile。
    const insideEditor = Array.from(tracked).some(function (editor) {
      return editor && editor.contains && editor.contains(parent);
    });
    if (insideEditor) return false;
    return touchesTrackedEditorScope(parent);
  }

  function isRelevantAttribute(record) {
    const target = record.target;
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;

    // 這兩個 attribute 是候選 editor / Email action 的直接生命週期訊號，
    // 即使 mutation 後 selector 已不再命中，也不能漏掉 cleanup / remount。
    if (record.attributeName === 'contenteditable' || record.attributeName === 'name') return true;

    // editor 內容內的 class/style/aria 變動通常只是 rich-text formatting；
    // editor 根節點本身仍會由下面的 selector / scope 判斷保留 lifecycle 訊號。
    if (isInsideTrackedEditor(target) &&
        !safeMatches(target, NS.config.selectors.EDITOR_SELECTORS)) return false;

    if (safeMatches(target, NS.config.selectors.EDITOR_SELECTORS) ||
        safeMatches(target, NS.config.selectors.TOOLBAR_MOUNT.EDITOR_ROOT_SELECTORS) ||
        safeMatches(target, NS.config.selectors.TOOLBAR_MOUNT.EMAIL_FIELD_SELECTORS) ||
        isExtensionToolbar(target)) return true;

    return safeContainsEditor(target) || touchesTrackedEditorScope(target);
  }

  function onMutations(records) {
    if (records.some(function (record) {
      if (record.type === 'childList') return isRelevantChildList(record);
      if (record.type === 'characterData') return isRelevantCharacterData(record);
      return isRelevantAttribute(record);
    })) {
      scheduleScan();
    }
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

    // 富文字編輯器裡可能出現巢狀 contenteditable（例如從網頁／Office 貼入
    // HTML，或圖片元件建立可編輯 caption）。通用 selector 也會命中這些
    // 內容節點；若把它們當成獨立 editor，就會掛上第二條工具列。
    const outermost = found.filter(function (node) {
      return !found.some(function (possibleEditor) {
        return possibleEditor !== node &&
          possibleEditor.contains &&
          possibleEditor.contains(node);
      });
    });

    // Froala 在純文字貼上時還會於真正 .fr-element 的旁邊建立一個寬度為 0、
    // 移到畫面外的 contenteditable clipboard helper。它和真正 editor 是兄弟
    // 節點，巢狀過濾抓不到，但兩者共用同一個 .fr-box。每個 editor root 只取
    // selector 優先序最前面的候選（found 已依 EDITOR_SELECTORS 順序建立），
    // 因此保留 .fr-element 並忽略後命中的通用 helper；不同 root 仍各自保留。
    const rootSelectors = NS.config.selectors.TOOLBAR_MOUNT.EDITOR_ROOT_SELECTORS || [];
    const rootSelector = rootSelectors.join(',');
    const claimedRoots = new Set();
    return outermost.filter(function (node) {
      if (!rootSelector || !node.closest) return true;
      let editorRoot = null;
      try {
        editorRoot = node.closest(rootSelector);
      } catch (e) {
        return true;
      }
      if (!editorRoot) return true;
      if (claimedRoots.has(editorRoot)) return false;
      claimedRoots.add(editorRoot);
      return true;
    });
  }

  function removeTrackedEditor(el) {
    tracked.delete(el);
    // marker 只是診斷資訊，不可以成為下一次 detect 的 gate；清掉它避免
    // Halo 復用同一個 DOM node 時留下 stale state。
    try {
      el.removeAttribute(ENHANCED_ATTR);
    } catch (e) {
      /* 節點可能已被 framework 移除 */
    }
    try {
      callbacks.onEditorRemoved && callbacks.onEditorRemoved(el);
    } catch (e) {
      NS.warn('onEditorRemoved 發生錯誤', e);
    }
  }

  /** 掃描並處理新增 / 移除的編輯器 */
  function scan() {
    scanScheduled = false;
    scheduledHandle = null;

    // content script 本身已由 manifest 的 Halo host match gate 住；這裡不再
    // 依賴短暫存在的 app signature。SPA route transition 中 signature 可能先
    // 消失，若在此 return 會跳過 cleanup，也會錯過下一輪 remount。
    const editors = findEditors().filter(function (el) {
      return matchesTargetField(el);
    });
    const currentSet = new Set(editors);

    // 先移除：已離開候選集合的 editor。先 cleanup 再 mount 新 editor，
    // 可避免 SPA replace 同一個 host 時短暫留下兩條工具列。
    tracked.forEach((el) => {
      if (!currentSet.has(el) || !document.contains(el)) {
        removeTrackedEditor(el);
      }
    });

    // 新增：runtime Set 才是 detect 的來源；DOM marker 不再作為 gate。
    // 因此 marker 被 Halo 清掉、或同一 editor node 被復用，都不會破壞 lifecycle。
    editors.forEach((el) => {
      if (tracked.has(el)) return;

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

    // 每次掃描結尾通知一次：供工具列檢查掛載點是否仍有效（editor rerender、
    // Action 類型切換等情況下補回正確位置）。
    try {
      callbacks.onScan && callbacks.onScan();
    } catch (e) {
      NS.warn('onScan 發生錯誤', e);
    }
  }

  /** 合併同一幀內的相關變動；不使用輪詢或固定延遲重插。 */
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    if (typeof window.requestAnimationFrame === 'function') {
      scheduledWithRaf = true;
      scheduledHandle = window.requestAnimationFrame(scan);
    } else {
      scheduledWithRaf = false;
      scheduledHandle = window.setTimeout(scan, 0);
    }
  }

  function cancelScheduledScan() {
    if (!scanScheduled) return;
    if (scheduledWithRaf && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(scheduledHandle);
    } else if (!scheduledWithRaf) {
      window.clearTimeout(scheduledHandle);
    }
    scanScheduled = false;
    scheduledHandle = null;
  }

  function onRouteChange() {
    scheduleScan();
  }

  const Detector = {
    /** 啟動偵測器 */
    start: function (opts) {
      callbacks.onEditorFound = opts && opts.onEditorFound;
      callbacks.onEditorRemoved = opts && opts.onEditorRemoved;
      callbacks.onScan = opts && opts.onScan;

      if (observer) {
        // start 可安全重入：不建立第二個 observer，只補一次 reconcile。
        scheduleScan();
        return;
      }

      const observationRoot = document.documentElement || document.body;
      if (typeof MutationObserver === 'function' && observationRoot) {
        observer = new MutationObserver(onMutations);
        observer.observe(observationRoot, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: OBSERVED_ATTRIBUTES,
        });
      } else {
        NS.warn('找不到可監聽的 document root，編輯器偵測器只執行一次掃描');
      }

      ['popstate', 'hashchange', 'pageshow'].forEach(function (eventName) {
        window.addEventListener(eventName, onRouteChange);
      });
      if (window.navigation && window.navigation.addEventListener) {
        window.navigation.addEventListener('navigate', onRouteChange);
      }

      scan(); // 首次全頁掃描（observer 已先建立，避免初始化 race）
      NS.log('編輯器偵測器已啟動');
    },

    /** 停止偵測器 */
    stop: function () {
      cancelScheduledScan();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      ['popstate', 'hashchange', 'pageshow'].forEach(function (eventName) {
        window.removeEventListener(eventName, onRouteChange);
      });
      if (window.navigation && window.navigation.removeEventListener) {
        window.navigation.removeEventListener('navigate', onRouteChange);
      }
      Array.from(tracked).forEach(removeTrackedEditor);
    },

    /** 強制重新掃描（供外部呼叫） */
    rescan: scheduleScan,
  };

  NS.core.detector = Detector;
})();
