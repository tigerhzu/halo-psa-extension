/** ultimate-mode/sidebar.js — 保留 Op Team A/B/C（各自含工程師子列）與 Timesheets。 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const shared = NS.ultimate.shared;
  const section = 'sidebar';
  const cfg = shared.cfg.SIDEBAR;

  function isOnLeft(node, maxRight) {
    const rect = shared.elementRect(node);
    return !!(rect && rect.left >= -4 && rect.left < 360 && rect.right <= (maxRight || 620));
  }

  function teamLabels(root) {
    return shared.findByLabels(root || document, cfg.TEAM_ITEMS, { allowTrailingCounter: true })
      .filter(function (node) { return isOnLeft(node); });
  }

  function findTeamRoot() {
    const configured = shared.safeQueryAll(document, cfg.ROOT_SELECTORS).filter(function (root) {
      return isOnLeft(root) && shared.countMatchedLabels(
        root, cfg.LABEL_SELECTORS, cfg.TEAM_ITEMS, { allowTrailingCounter: true }
      ) >= cfg.MIN_SIGNATURE_MATCHES;
    });
    if (configured.length) return configured[0];

    const labels = teamLabels(document);
    const unique = new Set(labels.map(function (node) {
      return shared.matchedLabel(node, cfg.TEAM_ITEMS, { allowTrailingCounter: true });
    }));
    if (unique.size < cfg.MIN_SIGNATURE_MATCHES) return null;
    const common = shared.lowestCommonAncestor(labels);
    return common && isOnLeft(common) ? common : null;
  }

  function rowOwner(labelNode, root) {
    return shared.boundedOwner(labelNode, root, {
      maxDepth: cfg.MAX_ROW_LOOKUP_DEPTH,
      maxHeight: cfg.MAX_ROW_HEIGHT,
      maxTextLength: cfg.MAX_ROW_TEXT_LENGTH,
      minWidth: 24,
    });
  }

  /**
   * HaloPSA 2025/2026 tree structure verified against the live tenant:
   * #halo-tree > ... > ul > li > .treeviewnode (.nodetitle), with an expanded
   * team's agents kept inside that team's li.  Hiding only sibling li elements
   * preserves Halo's counters, click handlers and expand/collapse state.
   */
  function applyHaloTree() {
    const root = document.querySelector(cfg.HALO_TREE_ROOT);
    if (!root || !isOnLeft(root)) return null;

    const teams = new Map();
    shared.safeQueryAll(root, cfg.HALO_TEAM_ROW_SELECTOR).forEach(function (row) {
      const title = row.querySelector(cfg.HALO_TEAM_TITLE_SELECTOR);
      const label = title && shared.matchedLabel(title, cfg.TEAM_ITEMS, { allowTrailingCounter: true });
      if (!label || teams.has(label)) return;
      const item = row.closest('li');
      if (item && root.contains(item)) teams.set(label, item);
    });
    if (teams.size < cfg.TEAM_ITEMS.length) return null;

    // matchedLabel returns normalized labels; normalize the configured lookup too.
    const keptItems = cfg.TEAM_ITEMS.map(function (label) { return teams.get(shared.normalizeText(label)); }).filter(Boolean);
    if (keptItems.length !== cfg.TEAM_ITEMS.length) return null;
    const parent = keptItems[0].parentElement;
    if (!parent || !keptItems.every(function (item) { return item.parentElement === parent; })) return null;

    const keptTeamNames = new Set(cfg.TEAM_ITEMS.map(shared.normalizeText));
    let hidden = 0;
    let protectedCount = 0;
    Array.prototype.forEach.call(parent.children, function (item) {
      const row = item.querySelector(':scope > ' + cfg.HALO_TEAM_ROW_SELECTOR);
      const level = Number(row && row.getAttribute('data-level')) || 1;
      const parentId = shared.normalizeText(row && row.getAttribute('data-parentid'));
      const keepChild = level > 1 && keptTeamNames.has(parentId);
      if (keptItems.includes(item) || keepChild) {
        protectedCount += 1;
        return;
      }
      if (shared.hide(item, section)) hidden += 1;
    });
    return { found: true, hidden: hidden, rows: parent.children.length, protected: protectedCount };
  }

  function collectRows(root) {
    const byOwner = new Map();
    shared.safeQueryAll(root, shared.cfg.TEXT_CANDIDATE_SELECTORS).forEach(function (labelNode) {
      if (!shared.isVisible(labelNode) || shared.isOwnUi(labelNode)) return;
      const text = shared.directText(labelNode);
      if (!text || text.length > shared.cfg.MAX_LABEL_TEXT_LENGTH) return;
      const rect = shared.elementRect(labelNode);
      if (!rect || !isOnLeft(labelNode)) return;
      const owner = rowOwner(labelNode, root);
      if (!owner || owner === root || !isOnLeft(owner)) return;
      if (!byOwner.has(owner)) byOwner.set(owner, { owner: owner, labels: [], left: rect.left, top: rect.top });
      const entry = byOwner.get(owner);
      entry.labels.push(labelNode);
      entry.left = Math.min(entry.left, rect.left);
      entry.top = Math.min(entry.top, rect.top);
    });
    return Array.from(byOwner.values()).sort(function (a, b) { return a.top - b.top || a.left - b.left; });
  }

  function protectTeams(rows, root) {
    const protectedRows = new Set();
    const teams = teamLabels(root).map(function (labelNode) {
      return {
        labelNode: labelNode,
        owner: rowOwner(labelNode, root),
        rect: shared.elementRect(labelNode),
      };
    }).filter(function (team) { return team.owner && team.rect; });

    teams.forEach(function (team) {
      protectedRows.add(team.owner);
      rows.forEach(function (entry) {
        if (team.owner.contains(entry.owner)) protectedRows.add(entry.owner);
      });

      const start = rows.findIndex(function (entry) { return entry.owner === team.owner; });
      if (start < 0) return;
      for (let index = start + 1; index < rows.length; index += 1) {
        const entry = rows[index];
        if (entry.top <= team.rect.top + 2) continue;
        if (entry.left <= team.rect.left + cfg.CHILD_INDENT_PX) break;
        protectedRows.add(entry.owner);
      }
    });

    shared.findByLabels(root, ['Timesheets']).forEach(function (labelNode) {
      const owner = rowOwner(labelNode, root);
      if (owner) protectedRows.add(owner);
    });
    return protectedRows;
  }

  function hideIconRailItems() {
    const haloLinks = shared.safeQueryAll(document, cfg.HALO_ICON_LINK_SELECTOR).filter(function (link) {
      return isOnLeft(link, 180) && !shared.isOwnUi(link);
    });
    const hasTimesheets = haloLinks.some(function (link) { return shared.matchesLabel(link, ['Timesheets']); });
    const signatureCount = haloLinks.filter(function (link) {
      return shared.matchesLabel(link, cfg.ICON_ITEMS_TO_HIDE);
    }).length;
    if (hasTimesheets && signatureCount >= 3) {
      let haloHidden = 0;
      haloLinks.forEach(function (link) {
        if (shared.matchesLabel(link, ['Timesheets'])) return;
        if (shared.hide(link, section)) haloHidden += 1;
      });
      return haloHidden;
    }

    let hidden = 0;
    shared.findByLabels(document, cfg.ICON_ITEMS_TO_HIDE).forEach(function (labelNode) {
      const rect = shared.elementRect(labelNode);
      if (!rect || rect.left > 90 || rect.right > 150) return;
      const owner = shared.boundedOwner(labelNode, document.body, {
        maxDepth: 5,
        maxHeight: 84,
        maxTextLength: 80,
        minWidth: 28,
      });
      if (owner && shared.hide(owner, section)) hidden += 1;
    });
    return hidden;
  }

  function apply() {
    return shared.reconcileSection(section, function () {
      const haloResult = applyHaloTree();
      if (haloResult) {
        haloResult.hidden += hideIconRailItems();
        shared.clearWarning('missing:sidebar');
        return haloResult;
      }

      // Live Halo Timesheets does not mount a Team tree. Avoid the expensive
      // document-wide semantic fallback on this high-churn calendar page.
      if (/^\/timesheets(?:\/|$)/i.test(window.location.pathname)) {
        return { found: false, hidden: hideIconRailItems(), fastPath: 'timesheets' };
      }

      const root = findTeamRoot();
      if (!root) {
      shared.warnOnce('missing:sidebar', '找不到包含 Op Team A/B/C 的左側 Team tree，本輪只處理 icon rail。');
        return { found: false, hidden: hideIconRailItems() };
      }
      shared.clearWarning('missing:sidebar');

      const rows = collectRows(root);
      const protectedRows = protectTeams(rows, root);
      let hidden = hideIconRailItems();
      rows.forEach(function (entry) {
        if (protectedRows.has(entry.owner)) return;
        if (entry.labels.some(function (label) {
          return shared.matchesLabel(label, cfg.TEAM_ITEMS, { allowTrailingCounter: true });
        })) return;
        if (shared.hide(entry.owner, section)) hidden += 1;
      });
      return { found: true, hidden: hidden, rows: rows.length, protected: protectedRows.size };
    });
  }

  NS.ultimate.sidebar = { apply: apply, findRoot: findTeamRoot };
})();
