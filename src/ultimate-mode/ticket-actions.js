/** ultimate-mode/ticket-actions.js — 篩選 Halo 原生 Ticket actions 與 More menu，不重做任何 action。 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const shared = NS.ultimate.shared;
  const cfg = shared.cfg.TICKET_ACTIONS;
  const section = 'ticket-actions';
  const menuSection = 'ticket-more-actions';

  function controlOwner(node, boundary) {
    const semantic = shared.safeClosest(node, cfg.CONTROL_SELECTORS, boundary);
    if (semantic) return semantic;
    return shared.boundedOwner(node, boundary, {
      maxDepth: cfg.MAX_CONTROL_LOOKUP_DEPTH,
      maxHeight: cfg.MAX_CONTROL_HEIGHT,
      maxTextLength: cfg.MAX_CONTROL_TEXT_LENGTH,
      minWidth: 18,
    });
  }

  function controls(root) {
    return shared.safeQueryAll(root, cfg.CONTROL_SELECTORS).filter(function (node) {
      if (shared.isOwnUi(node)) return false;
      return !shared.safeQueryAll(node, cfg.CONTROL_SELECTORS).some(function (child) { return child !== node; });
    });
  }

  function signatureCount(root) {
    const found = new Set();
    shared.findByLabels(root, cfg.PRIMARY_SIGNATURE).forEach(function (node) {
      const label = shared.matchedLabel(node, cfg.PRIMARY_SIGNATURE);
      if (label) found.add(label);
    });
    return found.size;
  }

  function semanticFallbackRoot() {
    const matches = shared.findByLabels(document, cfg.PRIMARY_SIGNATURE);
    const owners = matches.map(function (node) { return controlOwner(node, document.body); }).filter(Boolean);
    const common = shared.lowestCommonAncestor(owners);
    if (common && common !== document.body && signatureCount(common) >= cfg.MIN_PRIMARY_SIGNATURE_MATCHES) return common;
    let best = null;
    owners.forEach(function (control) {
      let node = control.parentElement;
      for (let depth = 0; node && node !== document.body && depth < 7; depth += 1) {
        const score = signatureCount(node);
        if (score >= cfg.MIN_PRIMARY_SIGNATURE_MATCHES) {
          const size = controls(node).length;
          if (!best || size < best.size || (size === best.size && score > best.score)) {
            best = { node: node, size: size, score: score };
          }
          break;
        }
        node = node.parentElement;
      }
    });
    return best && best.node;
  }

  function findRoot() {
    const haloTitleBar = document.querySelector(cfg.HALO_TITLE_BAR_SELECTOR);
    if (haloTitleBar) {
      const haloRoots = shared.safeQueryAll(haloTitleBar, cfg.HALO_BUTTON_CONTAINER_SELECTOR).filter(function (root) {
        return !!root.querySelector(cfg.HALO_ACTION_BUTTON_SELECTOR);
      });
      if (haloRoots.length === 1) return haloRoots[0];
    }
    const candidates = shared.safeQueryAll(document, cfg.ROOT_SELECTORS).filter(function (root) {
      return !shared.isOwnUi(root) && signatureCount(root) >= cfg.MIN_PRIMARY_SIGNATURE_MATCHES;
    });
    candidates.sort(function (a, b) { return controls(a).length - controls(b).length; });
    return candidates[0] || semanticFallbackRoot() || null;
  }

  function genericControls(root) {
    if (shared.safeMatches(root, cfg.HALO_BUTTON_CONTAINER_SELECTOR) && root.querySelector(cfg.HALO_ACTION_BUTTON_SELECTOR)) {
      return shared.safeQueryAll(root, [
        ':scope > ' + cfg.HALO_ACTION_BUTTON_SELECTOR,
        cfg.HALO_ACTION_MORE_SELECTOR,
      ]).filter(function (node) { return !shared.isOwnUi(node); });
    }
    const labels = shared.findByLabels(root, cfg.PRIMARY_SIGNATURE.concat(cfg.MORE_LABELS));
    let best = null;
    labels.forEach(function (labelNode) {
      let row = labelNode;
      for (let depth = 0; row && row !== root && depth <= cfg.MAX_CONTROL_LOOKUP_DEPTH; depth += 1) {
        const parent = row.parentElement;
        if (!parent) break;
        const owners = new Set();
        labels.forEach(function (otherLabel) {
          let owner = otherLabel;
          while (owner && owner.parentElement !== parent && owner !== root) owner = owner.parentElement;
          if (owner && owner.parentElement === parent) owners.add(owner);
        });
        const childCount = parent.children ? parent.children.length : 0;
        if (owners.size >= cfg.MIN_PRIMARY_SIGNATURE_MATCHES && childCount <= 30) {
          const candidate = { parent: parent, score: owners.size, childCount: childCount };
          if (
            !best || candidate.score > best.score ||
            (candidate.score === best.score && candidate.childCount < best.childCount)
          ) best = candidate;
        }
        row = parent;
      }
    });
    if (best) {
      return Array.prototype.filter.call(best.parent.children, function (node) {
        return shared.isVisible(node) && !shared.isOwnUi(node);
      });
    }
    return controls(root);
  }

  function controlledMenus(root) {
    const menus = [];
    const moreControls = genericControls(root).filter(function (control) {
      return shared.matchesLabel(control, cfg.MORE_LABELS);
    });
    moreControls.forEach(function (control) {
      const id = control.getAttribute('aria-controls');
      if (id) {
        const target = document.getElementById(id);
        if (target && !menus.includes(target)) menus.push(target);
      }
      const owned = control.getAttribute('aria-owns');
      if (owned) {
        const target = document.getElementById(owned);
        if (target && !menus.includes(target)) menus.push(target);
      }
    });

    // Portal menu 沒有 aria-controls 時，只在 More 明確展開、且頁面上只有一個
    // 可見並含白名單項目的 menu 時建立關聯；無法唯一判定就不碰。
    const expanded = moreControls.some(function (control) {
      return control.getAttribute('aria-expanded') === 'true';
    });
    if (expanded) {
      const visibleMatches = shared.safeQueryAll(document, cfg.MENU_ROOT_SELECTORS).filter(function (menu) {
        if (shared.isOwnUi(menu) || menu.hidden || menu.getAttribute('aria-hidden') === 'true') return false;
        let style;
        try { style = window.getComputedStyle(menu); } catch (e) { style = null; }
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        return shared.safeQueryAll(menu, cfg.MENU_ITEM_SELECTORS).some(function (item) {
          return shared.matchesLabel(item, cfg.KEEP_MORE);
        });
      });
      if (visibleMatches.length === 1 && !menus.includes(visibleMatches[0])) menus.push(visibleMatches[0]);
    }
    return menus;
  }

  function filterMenus(root) {
    return shared.reconcileSection(menuSection, function () {
      let hidden = 0;
      let matchedMenus = 0;

    // Halo's action More is the listbox directly inside the verified action
    // container.  The other title-bar listbox is a utility menu and is never
    // touched by this scoped path.
    const haloMore = root.querySelector(cfg.HALO_ACTION_MORE_SELECTOR);
    const haloMenu = haloMore && haloMore.querySelector(cfg.HALO_ACTION_MENU_SELECTOR);
    const haloItems = haloMenu ? shared.safeQueryAll(haloMenu, cfg.HALO_ACTION_MENU_ITEM_SELECTOR) : [];
    if (haloItems.some(function (item) { return shared.matchesLabel(item, cfg.KEEP_MORE); })) {
      matchedMenus += 1;
      haloItems.forEach(function (item) {
        if (shared.matchesLabel(item, cfg.KEEP_MORE)) return;
        if (shared.hide(item, menuSection)) hidden += 1;
      });
        return { menus: matchedMenus, hidden: hidden };
      }

    const related = controlledMenus(root);
    const candidates = related.concat(shared.safeQueryAll(document, cfg.MENU_ROOT_SELECTORS)).filter(function (menu, index, all) {
      return menu && all.indexOf(menu) === index && !shared.isOwnUi(menu);
    });
    function menuItems(menu) {
      const labels = shared.safeQueryAll(menu, shared.cfg.TEXT_CANDIDATE_SELECTORS).filter(function (node) {
        if (!shared.isVisible(node) || shared.isOwnUi(node)) return false;
        const text = shared.directText(node);
        if (!text || text.length > cfg.MAX_CONTROL_TEXT_LENGTH) return false;
        return !shared.safeQueryAll(node, shared.cfg.TEXT_CANDIDATE_SELECTORS).some(function (child) {
          return child !== node && shared.directText(child).trim();
        });
      });
      let best = null;
      labels.forEach(function (labelNode) {
        let row = labelNode;
        for (let depth = 0; row && row !== menu && depth <= 4; depth += 1) {
          const parent = row.parentElement;
          if (!parent) break;
          const owners = new Set();
          labels.forEach(function (otherLabel) {
            let owner = otherLabel;
            while (owner && owner.parentElement !== parent && owner !== menu) owner = owner.parentElement;
            if (owner && owner.parentElement === parent) owners.add(owner);
          });
          const childCount = parent.children ? parent.children.length : 0;
          if (owners.size >= 2 && childCount <= 30) {
            const candidate = { parent: parent, score: owners.size, childCount: childCount };
            if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.childCount < best.childCount)) {
              best = candidate;
            }
          }
          row = parent;
        }
      });
      if (best) return Array.prototype.slice.call(best.parent.children);
      return controls(menu);
    }

    candidates.forEach(function (menu) {
      const items = menuItems(menu);
      const keepMatches = new Set();
      items.forEach(function (item) {
        const label = shared.matchedLabel(item, cfg.KEEP_MORE);
        if (label) keepMatches.add(label);
      });
      if (keepMatches.size < 1) return;
      matchedMenus += 1;
      items.forEach(function (item) {
        if (!shared.labelVariants(item).length || shared.matchesLabel(item, cfg.KEEP_MORE)) return;
        if (shared.hide(item, menuSection)) hidden += 1;
      });
    });
      return { menus: matchedMenus, hidden: hidden };
    });
  }

  function apply() {
    return shared.reconcileSection(section, function () {
      const root = findRoot();
      if (!root) {
        shared.reconcileSection(menuSection, function () {});
        shared.warnOnce('missing:ticket-actions', '找不到具有足夠核心動作簽章的 Ticket Action bar，本輪跳過。');
        return { found: false, hidden: 0, menus: 0 };
      }
      shared.clearWarning('missing:ticket-actions');

      const haloMore = root.querySelector(cfg.HALO_ACTION_MORE_SELECTOR);
      const haloMenu = haloMore && haloMore.querySelector(cfg.HALO_ACTION_MENU_SELECTOR);
      const haloMenuItems = haloMenu ? shared.safeQueryAll(haloMenu, cfg.HALO_ACTION_MENU_ITEM_SELECTOR) : [];
      let hidden = 0;
      genericControls(root).forEach(function (control) {
        if (!shared.labelVariants(control).length || shared.matchesLabel(control, cfg.KEEP_PRIMARY)) return;
        // Some closed-ticket layouts expose Email User / Activity Note only as
        // primary buttons and omit the action More menu. Preserve that sole native
        // entry point so Ultimate Mode never removes required functionality.
        const requiredMoreLabel = shared.matchedLabel(control, cfg.KEEP_MORE);
        if (requiredMoreLabel && !haloMenuItems.some(function (item) {
          return shared.matchedLabel(item, cfg.KEEP_MORE) === requiredMoreLabel;
        })) return;
        if (shared.safeClosest(control, cfg.MENU_ROOT_SELECTORS, root)) return;
        if (shared.hide(control, section)) hidden += 1;
      });
      const menuResult = filterMenus(root);
      return { found: true, hidden: hidden + menuResult.hidden, menus: menuResult.menus };
    });
  }

  NS.ultimate.ticketActions = { apply: apply, findRoot: findRoot };
})();
