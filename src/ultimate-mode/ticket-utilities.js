/**
 * ultimate-mode/ticket-utilities.js
 *
 * 隱藏 Ticket 詳情頁右上角的 Halo 原生 utility actions（上一筆、開新視窗、
 * 分享、列印與更多等）。這些按鈕與主要 Ticket status action bar 不同，
 * 因此獨立處理；只加可逆 class，不重做或移除 Halo DOM。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const shared = NS.ultimate.shared;
  const cfg = shared.cfg.TICKET_UTILITIES;
  const section = cfg.SECTION;

  function viewportWidth() {
    return Math.max(
      Number(window.innerWidth) || 0,
      Number(document.documentElement && document.documentElement.clientWidth) || 0
    );
  }

  function isOwnedUtility(node) {
    return !!(
      node && node.getAttribute &&
      node.getAttribute(shared.cfg.OWNED_ATTR) === '1' &&
      node.getAttribute(shared.cfg.SECTION_ATTR) === section
    );
  }

  function isKeep(node) {
    return shared.matchesLabel(node, cfg.KEEP_LABELS) ||
      shared.matchesLabel(node, shared.cfg.TICKET_ACTIONS.KEEP_PRIMARY) ||
      /^new\s+ticket$/i.test(shared.directText(node));
  }

  function isRightTopControl(node) {
    if (!node || shared.isOwnUi(node)) return false;
    if (isOwnedUtility(node)) return true;
    if (!shared.isVisible(node)) return false;
    const rect = shared.elementRect(node);
    const width = viewportWidth();
    if (!rect || width < 1) return false;
    return (
      rect.top <= cfg.MAX_TOP_PX &&
      rect.right >= width * cfg.RIGHT_START_RATIO &&
      rect.width >= 1 &&
      rect.width <= cfg.MAX_CONTROL_WIDTH &&
      rect.height >= 1 &&
      rect.height <= cfg.MAX_CONTROL_HEIGHT
    );
  }

  function detailRoot() {
    const roots = shared.safeQueryAll(document, cfg.ROOT_SELECTORS).filter(function (root) {
      return !shared.isOwnUi(root) && shared.isVisible(root);
    });
    // 只有 Ticket 詳情頁的 root 才有足夠簽章；不在 list / Timesheets
    // 頁套用右上角 utility 隱藏。
    const candidates = roots.filter(function (root) {
      return shared.safeQueryAll(root, ['.actionmenubtn', '[data-testid*="ticket-action" i]']).length >= 1;
    });
    candidates.sort(function (a, b) { return controls(b).length - controls(a).length; });
    const signed = candidates.find(function (root) { return controls(root).length >= cfg.MIN_SIGNATURE_MATCHES; });
    if (signed) return signed;

    // 若 utility row 是詳情標題的 sibling，向上找有限深度共同容器；
    // 不把 body 當候選，避免在一般頁面誤掃整個 document。
    const title = document.querySelector('.details_page_title');
    let node = title && title.parentElement;
    for (let depth = 0; node && node !== document.body && depth <= cfg.MAX_OWNER_DEPTH; depth += 1) {
      if (shared.safeQueryAll(node, ['.actionmenubtn', '[data-testid*="ticket-action" i]']).length >= 1 && controls(node).length >= cfg.MIN_SIGNATURE_MATCHES) {
        return node;
      }
      node = node.parentElement;
    }
    return candidates[0] || null;
  }

  function owner(node, boundary) {
    const semantic = shared.safeClosest(node, ['button', 'a', '[role="button"]'], boundary);
    if (semantic) return semantic;
    return shared.boundedOwner(node, boundary, {
      maxDepth: cfg.MAX_OWNER_DEPTH,
      maxHeight: cfg.MAX_CONTROL_HEIGHT,
      maxTextLength: 120,
      minWidth: 16,
    });
  }

  function controls(root) {
    const boundary = root || document.body;
    const owners = shared.safeQueryAll(boundary, cfg.CONTROL_SELECTORS)
      .filter(function (node) { return isRightTopControl(node); })
      .map(function (node) { return owner(node, boundary); })
      .filter(function (node) { return node && !shared.isOwnUi(node) && !isKeep(node); });

    const unique = owners.filter(function (node, index) { return owners.indexOf(node) === index; });
    // 僅保留最外層控制項，避免 icon span 與外層 button 重複標記。
    return unique.filter(function (node) {
      return !unique.some(function (other) {
        return other !== node && other.contains && other.contains(node);
      });
    });
  }

  function apply() {
    return shared.reconcileSection(section, function () {
      const root = detailRoot();
      if (!root) {
        shared.warnOnce('missing:' + section, '找不到 Ticket 詳情頁 utility actions 的可靠根節點，本輪跳過。');
        return { found: false, hidden: 0 };
      }

      const matches = controls(root);
      if (matches.length < cfg.MIN_SIGNATURE_MATCHES) {
        shared.warnOnce('signature:' + section, 'Ticket utility actions 簽章不足，本輪跳過。');
        return { found: false, hidden: 0 };
      }

      shared.clearWarning('missing:' + section);
      shared.clearWarning('signature:' + section);
      let hidden = 0;
      matches.forEach(function (control) {
        if (shared.hide(control, section)) hidden += 1;
      });
      return { found: true, hidden: hidden, controls: matches.length };
    });
  }

  NS.ultimate.ticketUtilities = { apply: apply };
})();
