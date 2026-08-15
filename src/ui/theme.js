/**
 * theme.js
 * 外觀主題 / Accent / 透明度 切換器。樣式不寫死在程式裡 ——
 * 只在 <html> 設定 data-hpx-theme 與 CSS 變數 --hpx-accent（hex）/ --hpx-opacity，
 * 由各 theme CSS（content_scripts 注入 / 設定頁 <link>）依屬性套用。
 *
 * 主題：
 *  - 'default'        原始外觀
 *  - 'cute-ios'       Cute iOS（毛玻璃 / 圓角 / 浮動陰影 / Accent / 透明度）
 *  - 只保留 'default' 與 'cute-ios' 兩種主題
 *
 * 設定存在 chrome.storage（hpx_settings.theme / accent / opacity），變更即時全域生效，
 * 不重新整理、不開新分頁。只影響本擴充自己的 .hpx-* 元件與「被 JS 標記」的 Sidebar，
 * 不動 HaloPSA 其他介面。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  const STORAGE_KEY = 'hpx_settings';
  const DEFAULT_THEME = 'cute-ios';
  const DEFAULT_ACCENT = '#000000'; // 首次使用 Cute／果凍模式的預設 Accent
  const DEFAULT_OPACITY = 100; // 百分比 40~100
  const VALID = ['default', 'cute-ios'];

  function normalizeAccent(value) {
    const hex = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : DEFAULT_ACCENT;
  }

  const SIDEBAR_MARKER = 'hpx-theme-sidebar'; // 逐欄（fallback）樣式用
  const ICONBAR_MARK = 'hpx-theme-iconbar';
  const MAIN_MARK = 'hpx-theme-main';
  const WRAP_MARK = 'hpx-theme-wrap'; // 左側共同 wrapper（連續背景，優先）

  let currentTheme = DEFAULT_THEME;
  let currentAppearance = {
    theme: DEFAULT_THEME,
    accent: DEFAULT_ACCENT,
    opacity: DEFAULT_OPACITY,
  };
  let mo = null;
  let sidebarMo = null;
  let observedSidebar = null;
  let scheduled = false;
  let warnedNoWrapper = false;

  // ── Sidebar 偵測（整個左側區域）────────────────────────────

  function sidebarSelectors() {
    return (NS.config.selectors && NS.config.selectors.SIDEBAR_SELECTORS) || [];
  }

  /**
   * 找出左側所有「導覽直欄」（涵蓋 icon bar、主 sidebar、展開的次要 panel）。
   * 改用幾何位置判斷取代背景色判斷，以支援淺色 / 白底側邊欄：
   *   - 右緣位於畫面左側 45% 內，且最多 560px（排除主內容區）
   *   - 寬度 36~520px、高度 ≥ 50% 視窗
   *   - fixed / absolute / sticky 容器，或位於側欄內的 panel / view / filter 子面板
   * 同一棵樹允許保留幾何範圍不同的巢狀面板，因為 HaloPSA 的 View / Filter
   * 選單會在既有 sidebar 內再建立一層不透明面板。
   */
  function findSidebarColumns() {
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    const rightLimit = Math.min(560, Math.max(320, vw * 0.45));
    const hint =
      '#halo-tree div, #halo-tree section, nav, aside, ul, [class*="nav" i], [class*="menu" i], [class*="side" i], [class*="bar" i], [class*="icon" i], [class*="list" i], [class*="panel" i], [class*="column" i], [class*="navigation" i], [class*="filter" i], [class*="tree" i], [role="navigation"], [role="complementary"]';
    const extra = sidebarSelectors();
    const selector = extra.length ? extra.join(',') + ',' + hint : hint;

    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (e) {
      return [];
    }

    const cands = [];
    const haloRoot = document.getElementById('halo-tree');
    nodes.forEach(function (el) {
      // Ticket/New Ticket 的 details sidebar 是白底主內容；在 Ultimate Mode
      // 隱藏 Team tree 或窄視窗時會移到左側，不能只因幾何位置而套深色主題。
      const mainDetails = el.closest && el.closest(
        '.new-ticket-screen, .ticketDetailsScreen, .details-container'
      );
      const insideRealSidebar = !!(
        (haloRoot && (haloRoot === el || haloRoot.contains(el))) ||
        (el.closest && el.closest('#app-nav-menu'))
      );
      if (mainDetails && !insideRealSidebar) return;

      let r;
      try {
        r = el.getBoundingClientRect();
      } catch (e) {
        return;
      }
      const position = window.getComputedStyle(el).position;
      const tag = (el.tagName || '').toLowerCase();
      const role = (el.getAttribute && el.getAttribute('role')) || '';
      const className = typeof el.className === 'string' ? el.className : '';
      const isPositioned = position === 'fixed' || position === 'absolute' || position === 'sticky';
      const isInsideHaloTree = !!(haloRoot && haloRoot !== el && haloRoot.contains(el));
      const isNestedPanel =
        tag !== 'ul' &&
        tag !== 'ol' &&
        tag !== 'li' &&
        tag !== 'a' &&
        (isInsideHaloTree ||
          role === 'navigation' ||
          role === 'complementary' ||
          /(?:panel|view|filter|navigation|sidebar|side-bar|ticketlist|ticket-list|subnav|sub-nav)/i.test(className));
      if (
        r.left >= -4 &&
        r.left <= Math.min(140, rightLimit) &&
        r.right <= rightLimit &&
        r.width >= 36 &&
        r.width <= 520 &&
        r.height >= vh * 0.5 &&
        (isPositioned || isNestedPanel)
      ) {
        cands.push(el);
      }
    });
    // #halo-tree 是 HaloPSA sidebar 的完整容器，永遠納入候選。
    // 不再刪除其後代：View / Filter 會在 #halo-tree 內建立幾何範圍不同的
    // 不透明子面板，這些面板也必須各自套用目前主題。
    const haloTree = document.getElementById('halo-tree');
    if (haloTree) {
      const rHT = haloTree.getBoundingClientRect();
      if (
        rHT.left <= 500 &&
        rHT.right <= rightLimit &&
        rHT.width >= 36 &&
        rHT.width <= 520 &&
        rHT.height >= vh * 0.5
      ) {
        if (!cands.includes(haloTree)) cands.push(haloTree);
      }
    }

    // 相同幾何範圍只留最外層；範圍不同的巢狀 panel 要保留並各自套主題。
    return cands.filter(function (el) {
      return !cands.some(function (o) {
        if (o === el || !o.contains(el)) return false;
        const a = o.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        return (
          Math.abs(a.left - b.left) <= 8 &&
          Math.abs(a.top - b.top) <= 8 &&
          Math.abs(a.width - b.width) <= 8 &&
          Math.abs(a.height - b.height) <= 8
        );
      });
    });
  }

  /**
   * HaloPSA 的最左側 icon bar 有時會把最底下約 30px 做成獨立色塊，
   * 高度不足以通過一般 sidebar（至少半個畫面）的偵測。直接從視窗左下角
   * 往 DOM 祖先查找小型底部區塊，讓它也取得相同主題 marker。
   */
  function findSidebarBottomStrip(cols) {
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    const icon = cols.filter(function (el) {
      const r = el.getBoundingClientRect();
      return r.left <= 8 && r.width >= 36 && r.width <= 120;
    }).sort(function (a, b) {
      return a.getBoundingClientRect().width - b.getBoundingClientRect().width;
    })[0];
    if (!icon || !document.elementFromPoint) return null;

    const iconRect = icon.getBoundingClientRect();
    const x = Math.max(2, Math.min(iconRect.right - 2, iconRect.left + iconRect.width / 2));
    let node = document.elementFromPoint(x, Math.max(0, vh - 2));
    let match = null;
    while (node && node !== document.body && node !== document.documentElement) {
      const r = node.getBoundingClientRect();
      if (
        r.left <= 8 &&
        r.right <= 140 &&
        r.width >= 30 &&
        r.height >= 2 &&
        r.height <= 140 &&
        r.bottom >= vh - 6
      ) {
        match = node;
      }
      node = node.parentElement;
    }
    return match;
  }

  function clearMarkers() {
    [SIDEBAR_MARKER, ICONBAR_MARK, MAIN_MARK, WRAP_MARK].forEach(function (cls) {
      document.querySelectorAll('.' + cls).forEach(function (n) {
        n.classList.remove(cls);
      });
    });
  }

  function clearColumnMarkersExcept(keep) {
    document.querySelectorAll('.' + SIDEBAR_MARKER).forEach(function (n) {
      if (keep && keep.has(n)) return;
      n.classList.remove(SIDEBAR_MARKER, ICONBAR_MARK, MAIN_MARK);
    });
  }

  /** 兩元素在 DOM 上的最低共同祖先。 */
  function lowestCommonAncestor(a, b) {
    const set = new Set();
    let n = a;
    while (n) {
      set.add(n);
      n = n.parentElement;
    }
    n = b;
    while (n) {
      if (set.has(n)) return n;
      n = n.parentElement;
    }
    return null;
  }

  /**
   * 找出「包住 icon bar + 中間 gap + 主 sidebar」的共同 parent（左側整體 wrapper）。
   * 讓虎紋可以「一張連續覆蓋」整個左側，順便補上中間灰色空白。
   * 會驗證幾何：靠左、寬度受限、右緣不超過主 sidebar 太多、且不到半個畫面，
   * 以免誤抓到包含 ticket 內容的 app root。
   */
  function findLeftWrapper() {
    const cols = findSidebarColumns();
    if (cols.length < 2) return null;
    cols.sort(function (a, b) {
      return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    });
    const left = cols[0];
    const right = cols[cols.length - 1];
    if (left === right) return null;

    const lca = lowestCommonAncestor(left, right);
    if (!lca) return null;

    const r = lca.getBoundingClientRect();
    const rightEdge = right.getBoundingClientRect().right;
    const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    const position = window.getComputedStyle(lca).position;
    if (
      position !== 'static' &&
      r.left <= 14 &&
      r.width <= 560 &&
      r.width < vw * 0.5 &&
      r.right <= rightEdge + 80
    ) {
      return { el: lca, width: Math.round(r.width) };
    }
    return null;
  }

  /** 逐欄標記（fallback：找不到共同 wrapper 時，至少各欄有虎紋）。 */
  function markColumns() {
    const cols = findSidebarColumns();
    const bottomStrip = findSidebarBottomStrip(cols);
    if (bottomStrip && !cols.includes(bottomStrip)) cols.push(bottomStrip);
    const keep = new Set(cols);
    clearColumnMarkersExcept(keep);
    cols.forEach(function (el) {
      el.classList.add(SIDEBAR_MARKER);
      const w = Math.round(el.getBoundingClientRect().width);
      if (w < 120) {
        el.classList.remove(MAIN_MARK);
        el.classList.add(ICONBAR_MARK);
        // eslint-disable-next-line no-console
        console.log('[HPX] theme sidebar matched', 'width=' + w + 'px', 'class=' + String(el.className || ''));
      } else {
        el.classList.remove(ICONBAR_MARK);
        el.classList.add(MAIN_MARK);
        // eslint-disable-next-line no-console
        console.log('[HPX] theme main sidebar matched', 'width=' + w + 'px', 'class=' + String(el.className || ''));
      }
    });
    if (!document.querySelector('.' + SIDEBAR_MARKER)) {
      // eslint-disable-next-line no-console
      console.warn('[HPX] sidebar NOT found —— 無法定位左側 sidebar，主題不套用。請回報 class。');
    }
  }

  /**
   * 依目前主題把 marker 加到左側 Sidebar。
   *  - Cute：優先用「共同 wrapper」連續覆蓋（補中間 gap 與底部剩餘區）。
   *    找不到共同 wrapper 才退回逐欄。
   *  - Default：清除。
   */
  function updateSidebarMarker(theme) {
    const isSidebarTheme = theme === 'cute-ios';
    if (!isSidebarTheme) {
      clearMarkers();
      return;
    }

    const wrap = findLeftWrapper();
    if (wrap) {
      // wrapper 已存在時仍要重掃各欄；HaloPSA 可能剛顯示原本隱藏的 My Lists 子面板。
      if (wrap.el.classList.contains(WRAP_MARK)) {
        markColumns();
        return;
      }
      // wrapper 升級（例如 DOM 動態載入後涵蓋範圍變大），重新標記。
      clearMarkers();
      warnedNoWrapper = false;
      wrap.el.classList.add(WRAP_MARK);
      // wrapper 負責填滿欄與欄之間的 gap / 底部；各欄也要標記，避免原始背景蓋住皮膚。
      markColumns();
      // eslint-disable-next-line no-console
      console.log(
        '[HPX] themed left-wrapper matched',
        'theme=' + theme,
        'tag=' + (wrap.el.tagName || '').toLowerCase(),
        'width=' + wrap.width + 'px',
        'class=' + String(wrap.el.className || '')
      );
      return;
    }

    // 找不到共同 wrapper → 先逐欄套用（wrapper 之後出現會自動升級）。
    if (document.querySelector('.' + WRAP_MARK)) clearMarkers();
    if (!warnedNoWrapper) {
      warnedNoWrapper = true;
      // eslint-disable-next-line no-console
      console.warn('[HPX] themed left-wrapper 尚未找到 —— 暫用逐欄背景。');
    }
    markColumns();
  }

  function scheduleSidebarUpdate() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(function () {
      scheduled = false;
      updateSidebarMarker(currentTheme);
      bindSidebarObserver();
    }, 80);
  }

  /**
   * HaloPSA 會預先建立 My Lists / View / Filter 面板，第一次點擊時只切換
   * class / style / hidden，而不新增 DOM。全頁 observer 只負責結構變動；
   * 這個 observer 專門監看 #halo-tree 內的顯示狀態，避免第一次開啟漏套主題。
   */
  function bindSidebarObserver() {
    const root = document.getElementById('halo-tree');
    if (root === observedSidebar) return;

    if (sidebarMo) {
      sidebarMo.disconnect();
      sidebarMo = null;
    }
    observedSidebar = root || null;
    if (!root) return;

    try {
      sidebarMo = new MutationObserver(scheduleSidebarUpdate);
      sidebarMo.observe(root, {
        attributes: true,
        subtree: true,
        attributeFilter: [
          'class',
          'style',
          'hidden',
          'aria-hidden',
          'aria-expanded',
          'aria-selected',
        ],
      });
    } catch (e) {
      NS.warn('sidebar 狀態監聽啟動失敗', e);
    }
  }

  // ── 套用外觀（theme + accent + opacity）─────────────────────

  function applyAppearance(s) {
    s = s || {};
    const theme = VALID.indexOf(s.theme) !== -1 ? s.theme : DEFAULT_THEME;
    currentTheme = theme;

    const root = document.documentElement;
    root.setAttribute('data-hpx-theme', theme);
    // accent 直接以 hex 設成 CSS 變數（不經對照表）；所有自訂 UI 都吃 var(--hpx-accent)
    const accent = normalizeAccent(s.accent);
    root.style.setProperty('--hpx-accent', accent);

    let op = typeof s.opacity === 'number' ? s.opacity : DEFAULT_OPACITY;
    op = Math.max(40, Math.min(100, op));
    const frac = (op / 100).toFixed(2);
    root.style.setProperty('--hpx-opacity', frac);
    root.style.setProperty('--hpx-glass-opacity', frac); // 沿用既有 cute 規則別名

    currentAppearance = { theme: theme, accent: accent, opacity: op };

    updateSidebarMarker(theme);
  }

  function loadAll(cb) {
    if (!(chrome && chrome.storage && chrome.storage.local)) {
      cb && cb({});
      return;
    }
    chrome.storage.local.get(STORAGE_KEY, function (data) {
      const current = (data && data[STORAGE_KEY]) || {};
      const next = Object.assign({}, current);
      let changed = false;
      if (next.theme !== 'default' && next.theme !== 'cute-ios') {
        next.theme = DEFAULT_THEME;
        changed = true;
      }
      if (!Object.prototype.hasOwnProperty.call(next, 'accent') || !/^#[0-9a-f]{6}$/i.test(String(next.accent || ''))) {
        next.accent = DEFAULT_ACCENT;
        changed = true;
      }
      if (typeof next.opacity !== 'number') {
        next.opacity = DEFAULT_OPACITY;
        changed = true;
      }
      // 新使用者預設不開啟簡單模式；已有明確選擇時保留原值。
      if (typeof next.ultimateMode !== 'boolean') {
        next.ultimateMode = false;
        changed = true;
      }
      if (changed) chrome.storage.local.set({ [STORAGE_KEY]: next });
      cb && cb(next);
    });
  }

  const Theme = {
    DEFAULT_THEME: DEFAULT_THEME,
    VALID: VALID,
    apply: function (name) {
      applyAppearance(Object.assign({}, currentAppearance, { theme: name }));
    },
    applyAppearance: applyAppearance,

    start: function () {
      // 先用預設避免閃爍
      applyAppearance({ theme: DEFAULT_THEME, accent: DEFAULT_ACCENT, opacity: DEFAULT_OPACITY });
      loadAll(applyAppearance);
      bindSidebarObserver();

      if (chrome && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area !== 'local' || !changes[STORAGE_KEY]) return;
          loadAll(applyAppearance);
        });
      }

      try {
        mo = new MutationObserver(scheduleSidebarUpdate);
        mo.observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) {
        NS.warn('theme MutationObserver 啟動失敗', e);
      }
    },
  };

  NS.ui.theme = Theme;
})();
