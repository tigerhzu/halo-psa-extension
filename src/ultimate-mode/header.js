/**
 * ultimate-mode/header.js
 *
 * 簡單模式只隱藏 Halo 原生頁首右上角的工具按鈕。這裡不重建任何
 * Halo 控制項，也不移除 DOM；必須先同時找到「New Ticket」與多個
 * 右上角控制項，才會套用隱藏，避免 Halo 改版時誤傷整個頁首。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const shared = NS.ultimate.shared;
  const cfg = shared.cfg.HEADER;
  const section = 'header';
  let lastRoot = null;

  function viewportWidth() {
    return Math.max(
      Number(window.innerWidth) || 0,
      Number(document.documentElement && document.documentElement.clientWidth) || 0
    );
  }

  function isTopRight(rect) {
    const width = viewportWidth();
    if (!rect || width < 1) return false;
    return rect.top <= cfg.MAX_ROOT_TOP_PX && rect.right >= width * cfg.RIGHT_START_RATIO;
  }

  function isControlSized(rect) {
    return !!(
      rect &&
      rect.width >= 1 &&
      rect.width <= cfg.CONTROL_MAX_WIDTH_PX &&
      rect.height >= 1 &&
      rect.height <= cfg.CONTROL_MAX_HEIGHT_PX
    );
  }

  function isOwnedHeaderControl(control) {
    return !!(
      control &&
      control.getAttribute &&
      control.getAttribute(shared.cfg.OWNED_ATTR) === '1' &&
      control.getAttribute(shared.cfg.SECTION_ATTR) === section
    );
  }

  function isNewTicket(control) {
    return shared.matchesLabel(control, cfg.NEW_TICKET_LABELS) ||
      /^new\s+ticket$/i.test(shared.directText(control));
  }

  function isKeepControl(control) {
    return isNewTicket(control) || shared.matchesLabel(control, cfg.KEEP_LABELS);
  }

  function isLikelyIcon(control) {
    const text = shared.directText(control).replace(/\s+/g, ' ').trim();
    const labels = shared.labelVariants(control);
    // 有 aria/title 的 icon，以及只有 SVG / 圖示而沒有文字的按鈕，
    // 都是頁首右上角要收起的候選。New Ticket 由 isNewTicket 保留。
    return !text || labels.length > 0 || text.length <= 3;
  }

  function topLevelControls(root) {
    const controls = shared.safeQueryAll(root, cfg.CONTROL_SELECTORS)
      .filter(function (control) {
        if (!control || control === root || shared.isOwnUi(control)) return false;
        // 上一輪已由本模組隱藏的控制項 display:none，但仍要納入
        // signature，否則下一輪 reconcile 會把它誤判成 stale 而恢復。
        if (!shared.isVisible(control) && !isOwnedHeaderControl(control)) return false;
        const rect = shared.elementRect(control);
        return isOwnedHeaderControl(control) || (isTopRight(rect) && isControlSized(rect));
      });

    // 同一個按鈕有時同時符合 button / [role=button]，只留下最外層
    // 控制項，避免重複標記與重複計算。
    return controls.filter(function (control) {
      return !controls.some(function (other) {
        return other !== control && other.contains && other.contains(control);
      });
    });
  }

  function rootCandidate(root) {
    if (!root || shared.isOwnUi(root) || !shared.isVisible(root)) return null;
    const rect = shared.elementRect(root);
    const width = viewportWidth();
    if (!rect || rect.top > cfg.MAX_ROOT_TOP_PX || rect.width < cfg.MIN_ROOT_WIDTH_PX) return null;
    if (width > 0 && rect.right < width * 0.78) return null;

    const controls = topLevelControls(root);
    const keep = controls.filter(isNewTicket);
    const icons = controls.filter(function (control) {
      return !isNewTicket(control) && isLikelyIcon(control);
    });
    if (!keep.length || controls.length < cfg.MIN_CONTROL_SIGNATURE || icons.length < cfg.MIN_ICON_SIGNATURE) {
      return null;
    }
    return {
      root: root,
      controls: controls,
      score: keep.length * 20 + icons.length * 2 + controls.length,
      area: rect.width * rect.height,
    };
  }

  function findRoot() {
    if (lastRoot && lastRoot.isConnected) {
      const cached = rootCandidate(lastRoot);
      if (cached) return cached;
    }
    lastRoot = null;
    let best = null;
    shared.safeQueryAll(document, cfg.ROOT_SELECTORS).forEach(function (root) {
      const candidate = rootCandidate(root);
      if (!candidate) return;
      if (
        !best ||
        candidate.score > best.score ||
        (candidate.score === best.score && candidate.area < best.area)
      ) best = candidate;
    });
    if (best) {
      lastRoot = best.root;
      return best;
    }

    // 某些 Halo 版本沒有穩定的 header class；以已驗證的 New Ticket
    // 控制項向上找有限深度的共同容器；不把 body 當成候選，避免
    // 每輪掃描擴大到整頁。仍會重跑同一組幾何與簽章條件。
    if (!best) {
      const keepControls = shared.safeQueryAll(document, cfg.CONTROL_SELECTORS)
        .filter(function (control) {
          return !shared.isOwnUi(control) && shared.isVisible(control) && isNewTicket(control);
        });
      const fallbackRoots = [];
      keepControls.forEach(function (control) {
        let node = control.parentElement;
        for (let depth = 0; node && depth <= cfg.FALLBACK_MAX_ANCESTOR_DEPTH; depth += 1) {
          if (node === document.body) break;
          if (!fallbackRoots.includes(node)) fallbackRoots.push(node);
          node = node.parentElement;
        }
      });
      fallbackRoots.forEach(function (root) {
        const candidate = rootCandidate(root);
        if (!candidate) return;
        if (
          !best ||
          candidate.score > best.score ||
          (candidate.score === best.score && candidate.area < best.area)
        ) best = candidate;
      });
    }
    if (best) lastRoot = best.root;
    return best;
  }

  function apply() {
    return shared.reconcileSection(section, function () {
      const candidate = findRoot();
      if (!candidate) {
        shared.warnOnce(
          'missing:' + section,
          '找不到具備 New Ticket + 右上角控制項簽章的頁首，本輪跳過。'
        );
        return { found: false, hidden: 0 };
      }

      shared.clearWarning('missing:' + section);
      let hidden = 0;
      candidate.controls.forEach(function (control) {
        if (isKeepControl(control)) return;
        if (shared.hide(control, section)) hidden += 1;
      });
      return { found: true, hidden: hidden, controls: candidate.controls.length };
    });
  }

  NS.ultimate.header = { apply: apply };
})();
