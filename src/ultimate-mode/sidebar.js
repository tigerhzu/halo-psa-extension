/** ultimate-mode/sidebar.js — 保留設定清單中的 Team（各自含工程師子列）與 Timesheets。 */
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

  function activeTeamItems(root) {
    const configured = cfg.TEAM_ITEMS.slice();
    if (!configured.length) return configured;
    let params;
    try { params = new URL(window.location.href).searchParams; } catch (error) { return configured; }

    const parentLabel = params.get('selparentid') || '';
    const parentMatch = configured.find(function (label) {
      return shared.normalizeText(label) === shared.normalizeText(parentLabel);
    });
    if (parentMatch) return [parentMatch];

    const selectedId = params.get('selid') || '';
    if (selectedId && root) {
      const selectedRow = shared.safeQueryAll(root, cfg.HALO_TEAM_ROW_SELECTOR).find(function (row) {
        return String(row.getAttribute('data-level') || '1') === '1' && row.getAttribute('data-id') === selectedId;
      });
      const title = selectedRow && selectedRow.querySelector(cfg.HALO_TEAM_TITLE_SELECTOR);
      const selectedLabel = title && configured.find(function (label) {
        return shared.matchesLabel(title, [label], { allowTrailingCounter: true });
      });
      if (selectedLabel) return [selectedLabel];
    }
    return configured;
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

  function readExpandedState(node) {
    if (!node || !node.getAttribute) return null;
    const aria = node.getAttribute('aria-expanded');
    if (aria === 'true') return true;
    if (aria === 'false') return false;
    const expanded = node.getAttribute('data-expanded');
    if (expanded === 'true' || expanded === '1') return true;
    if (expanded === 'false' || expanded === '0') return false;
    const collapsed = node.getAttribute('data-collapsed');
    if (collapsed === 'true' || collapsed === '1') return false;
    if (collapsed === 'false' || collapsed === '0') return true;
    const className = String(node.className || '').toLowerCase();
    if (/(chevron|caret|arrow)[-_ ]?(right|closed)|\bcollapsed\b|\bclosed\b/.test(className)) return false;
    if (/(chevron|caret|arrow)[-_ ]?(down|open)|\bexpanded\b|\bopen\b/.test(className)) return true;
    return null;
  }

  function teamExpandedState(row, item) {
    const stateNodes = [row, item].concat(shared.safeQueryAll(row, cfg.HALO_TEAM_EXPAND_STATE_SELECTORS));
    for (let index = 0; index < stateNodes.length; index += 1) {
      const state = readExpandedState(stateNodes[index]);
      if (state !== null) return state;
    }
    if (item && shared.safeQueryAll(item, cfg.HALO_TEAM_ROW_SELECTOR).some(function (child) {
      return child !== row && String(child.getAttribute('data-level') || '') !== '1';
    })) return true;
    return null;
  }

  function expandActiveTeam(root, visibleTeams) {
    if (!visibleTeams.length) return false;
    const target = shared.safeQueryAll(root, cfg.HALO_TEAM_ROW_SELECTOR).find(function (row) {
      if (String(row.getAttribute('data-level') || '1') !== '1') return false;
      const title = row.querySelector(cfg.HALO_TEAM_TITLE_SELECTOR);
      return !!title && shared.matchesLabel(title, visibleTeams, { allowTrailingCounter: true });
    });
    if (!target) return false;
    const item = target.closest('li');
    const state = teamExpandedState(target, item);
    if (state !== false || target.getAttribute('data-hpx-expand-requested') === '1') return state === true;

    target.setAttribute('data-hpx-expand-requested', '1');
    const controls = shared.safeQueryAll(target, cfg.HALO_TEAM_EXPAND_CONTROL_SELECTORS);
    const control = controls.find(function (node) { return readExpandedState(node) === false; }) || controls[0];
    try {
      if (control && typeof control.click === 'function') {
        control.click();
        return true;
      }
      if (readExpandedState(target) === false && typeof target.click === 'function') {
        target.click();
        return true;
      }
    } catch (error) {
      shared.warnOnce('expand:sidebar', 'Unable to expand the active HaloPSA Team row safely.', error);
    }
    shared.warnOnce('expand:sidebar-selector', 'Active Team is collapsed, but HaloPSA exposed no reliable expand control.');
    return false;
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
    const visibleTeams = activeTeamItems(root);

    const teams = new Map();
    const topLevelItems = [];
    shared.safeQueryAll(root, cfg.HALO_TEAM_ROW_SELECTOR).forEach(function (row) {
      if (String(row.getAttribute('data-level') || '1') !== '1') return;
      const item = row.closest('li');
      if (item && root.contains(item) && !topLevelItems.includes(item)) topLevelItems.push(item);
      const title = row.querySelector(cfg.HALO_TEAM_TITLE_SELECTOR);
      const label = title && shared.matchedLabel(title, visibleTeams, { allowTrailingCounter: true });
      if (!label || teams.has(label)) return;
      if (item && root.contains(item)) teams.set(label, item);
    });
    if (visibleTeams.length && teams.size === 0) return null;

    // matchedLabel returns normalized labels; normalize the configured lookup too.
    const keptItems = visibleTeams.map(function (label) { return teams.get(shared.normalizeText(label)); }).filter(Boolean);
    const parent = (keptItems[0] || topLevelItems[0]) && (keptItems[0] || topLevelItems[0]).parentElement;
    if (!parent || !keptItems.every(function (item) { return item.parentElement === parent; })) return null;

    const keptTeamNames = new Set(visibleTeams.map(shared.normalizeText));
    if (window.__HPXUltimateBootstrap && window.__HPXUltimateBootstrap.updateTeams) {
      window.__HPXUltimateBootstrap.updateTeams(visibleTeams);
    }
    expandActiveTeam(root, visibleTeams);
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
    return {
      found: true,
      hidden: hidden,
      rows: parent.children.length,
      protected: protectedCount,
      configuredTeams: cfg.TEAM_ITEMS.length,
      visibleTeams: visibleTeams.length,
      matchedTeams: teams.size,
    };
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
    const isConfiguredTeamLink = function (link) {
      return shared.matchesLabel(link, cfg.TEAM_ITEMS, { allowTrailingCounter: true });
    };
    const hasTimesheets = haloLinks.some(function (link) { return shared.matchesLabel(link, ['Timesheets']); });
    const signatureCount = haloLinks.filter(function (link) {
      return shared.matchesLabel(link, cfg.ICON_ITEMS_TO_HIDE);
    }).length;
    if (hasTimesheets && signatureCount >= 3) {
      let haloHidden = 0;
      haloLinks.forEach(function (link) {
        // 簡單模式只精簡未選取的原生入口；使用者設定保留的 Team 必須繼續存在。
        if (shared.matchesLabel(link, ['Timesheets']) || isConfiguredTeamLink(link)) return;
        // 只隱藏已驗證的原生入口。未知／自訂入口先保留，避免把使用者自己的 Team
        // 當成一般側欄項目誤藏起來。
        if (!shared.matchesLabel(link, cfg.ICON_ITEMS_TO_HIDE, { allowTrailingCounter: true })) return;
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
      shared.warnOnce('missing:sidebar', '找不到包含設定 Team 的左側 Team tree，本輪只處理 icon rail。');
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

  NS.ultimate.sidebar = { apply: apply, findRoot: findTeamRoot, _activeTeamItems: activeTeamItems };
})();
