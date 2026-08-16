/** ultimate-mode/team-shortcuts.js — Timesheets／Tickets 左側與設定清單同步的 Team 快捷列。 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const shared = NS.ultimate.shared;
  const cfg = shared.cfg.SIDEBAR;
  const knownTeamIds = new Map();
  const LOGO_ASSETS = Object.freeze({
    A: 'assets/ultimate-mode/team-a.webp',
    B: 'assets/ultimate-mode/team-b.webp',
    C: 'assets/ultimate-mode/team-c.webp',
    TIMESHEETS: 'assets/ultimate-mode/timesheets.webp',
  });
  const TEAM_LOGO_ASSETS = Object.freeze({
    'other support': 'assets/ultimate-mode/team-other-support.png',
    'project manager': 'assets/ultimate-mode/team-project-manager.png',
    // normalizeText 會將 Halo 的「SecOp」拆成「Sec Op」。
    'sec op team a': 'assets/ultimate-mode/team-sec-a.png',
    'technical solutions division': 'assets/ultimate-mode/team-technical-solutions.png',
    'rd': 'assets/ultimate-mode/team-rd.png',
    'thailand team': 'assets/ultimate-mode/team-thailand.png',
    'sales&admin': 'assets/ultimate-mode/team-sales-admin.png',
  });

  function createLogoImage(className, assetPath) {
    const image = document.createElement('img');
    image.className = className;
    image.src = chrome.runtime.getURL(assetPath);
    image.alt = '';
    image.decoding = 'async';
    image.draggable = false;
    image.setAttribute('aria-hidden', 'true');
    return image;
  }

  /** 使用自有 Timesheets 圖片，取代極致模式下的 Halo 原生 logo。 */
  function createTimesheetsLogo() {
    return createLogoImage('hpx-ultimate-timesheets-logo', LOGO_ASSETS.TIMESHEETS);
  }

  /** 使用已配置的 Team logo；沒有素材的 Team 保留安全的文字徽章。 */
  function createTeamLogo(label) {
    const match = /^Op\s+Team\s+([ABC])$/i.exec(String(label || '').trim());
    const letter = match ? match[1].toUpperCase() : '';
    const normalizedLabel = shared.normalizeText(label);
    const assetPath = TEAM_LOGO_ASSETS[normalizedLabel] || LOGO_ASSETS[letter];
    if (!assetPath) {
      const badge = document.createElement('span');
      badge.className = 'hpx-ultimate-team-logo hpx-ultimate-team-logo-fallback';
      badge.textContent = String(label || '').split(/\s+/).map(function (part) {
        return part.charAt(0);
      }).join('').slice(0, 3).toUpperCase();
      badge.setAttribute('aria-hidden', 'true');
      return badge;
    }
    const classSuffix = normalizedLabel.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || letter.toLowerCase();
    return createLogoImage(
      'hpx-ultimate-team-logo hpx-ultimate-team-logo-' + classSuffix,
      assetPath
    );
  }

  function brandTimesheets(link) {
    if (!link) return false;
    const host = link.querySelector('.app-button-img');
    if (!host) return false;
    link.classList.add('hpx-ultimate-timesheets-branded');
    host.classList.add('hpx-ultimate-timesheets-icon-host');
    if (!host.querySelector('.hpx-ultimate-timesheets-logo')) host.appendChild(createTimesheetsLogo());
    return true;
  }

  function isTimesheetsRoute() {
    return /^\/timesheets(?:\/|$)/i.test(window.location.pathname);
  }

  function isTicketsRoute() {
    return /^\/tickets(?:\/|$)/i.test(window.location.pathname);
  }

  function isTeamNavigationRoute() {
    return isTimesheetsRoute() || isTicketsRoute();
  }

  function shortcutItems() {
    const seen = new Set();
    return cfg.TEAM_ITEMS.filter(function (label) {
      const key = shared.normalizeText(label);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function findTeamRow(label) {
    const tree = document.querySelector(cfg.HALO_TREE_ROOT);
    if (!tree) return null;
    return shared.safeQueryAll(tree, cfg.HALO_TEAM_ROW_SELECTOR).find(function (row) {
      if (String(row.getAttribute('data-level') || '1') !== '1') return false;
      const title = row.querySelector(cfg.HALO_TEAM_TITLE_SELECTOR);
      return !!title && shared.matchesLabel(title, [label], { allowTrailingCounter: true });
    }) || null;
  }

  function discoverTeamIds() {
    let found = 0;
    shortcutItems().forEach(function (label) {
      const row = findTeamRow(label);
      const id = row && row.getAttribute('data-id');
      if (!id) return;
      knownTeamIds.set(shared.normalizeText(label), id);
      found += 1;
    });
    return found;
  }

  function pendingTeam() {
    try { return window.sessionStorage.getItem(cfg.PENDING_TEAM_KEY) || ''; } catch (e) { return ''; }
  }

  function clearPendingTeam() {
    try { window.sessionStorage.removeItem(cfg.PENDING_TEAM_KEY); } catch (e) { /* no-op */ }
  }

  function resumePendingTeam() {
    if (!isTicketsRoute()) return false;
    const label = pendingTeam();
    if (!label || !shortcutItems().some(function (item) {
      return shared.normalizeText(item) === shared.normalizeText(label);
    })) return false;

    const row = findTeamRow(label);
    if (!row) return false;
    const id = row.getAttribute('data-id') || '';
    const params = new URL(window.location.href).searchParams;
    clearPendingTeam();
    if (params.get('selid') === id && params.get('sellevel') === '1') return true;

    // 使用 Halo 原生 tree row 的 click handler 完成 Team 選取，不重做 API。
    window.setTimeout(function () {
      if (row.isConnected) row.click();
    }, 0);
    return true;
  }

  function shortcutHref(label) {
    const url = new URL(cfg.TICKETS_ROUTE, window.location.origin);
    const id = knownTeamIds.get(shared.normalizeText(label));
    if (id) {
      url.searchParams.set('selid', id);
      url.searchParams.set('sellevel', '1');
      url.searchParams.set('selparentid', 'All Teams');
    }
    return url.href;
  }

  function removeShortcuts() {
    shared.safeQueryAll(document, '.' + cfg.SHORTCUTS_ROOT_CLASS).forEach(function (root) {
      if (root.parentNode) root.parentNode.removeChild(root);
    });
  }

  function restoreTimesheetsLogo() {
    shared.safeQueryAll(document, '.hpx-ultimate-timesheets-logo').forEach(function (logo) {
      if (logo.parentNode) logo.parentNode.removeChild(logo);
    });
    shared.safeQueryAll(document, '.hpx-ultimate-timesheets-icon-host').forEach(function (host) {
      host.classList.remove('hpx-ultimate-timesheets-icon-host');
    });
    shared.safeQueryAll(document, '.hpx-ultimate-timesheets-branded').forEach(function (link) {
      link.classList.remove('hpx-ultimate-timesheets-branded');
    });
  }

  function destroy() {
    removeShortcuts();
    restoreTimesheetsLogo();
  }

  function createShortcut(label) {
    const link = document.createElement('a');
    link.className = cfg.SHORTCUT_CLASS;
    link.href = shortcutHref(label);
    link.title = '前往 ' + label;
    link.setAttribute('aria-label', '前往 ' + label);

    const icon = createTeamLogo(label);

    const text = document.createElement('span');
    text.className = 'hpx-ultimate-team-shortcut-label';
    text.textContent = label.replace(/^Op\s+/i, '');

    link.appendChild(icon);
    link.appendChild(text);
    link.addEventListener('click', function () {
      try { window.sessionStorage.setItem(cfg.PENDING_TEAM_KEY, label); } catch (e) { /* href remains a safe fallback */ }
    });
    return link;
  }

  function mount() {
    const nav = document.querySelector(cfg.HALO_NAV_MENU_SELECTOR);
    if (!nav) return null;
    const timesheets = shared.safeQueryAll(nav, cfg.HALO_ICON_LINK_SELECTOR).find(function (link) {
      return shared.matchesLabel(link, ['Timesheets']);
    });
    if (!timesheets) return null;
    brandTimesheets(timesheets);

    const items = shortcutItems();
    let root = nav.querySelector('.' + cfg.SHORTCUTS_ROOT_CLASS);
    const signature = items.map(shared.normalizeText).join('|');
    if (root && root.getAttribute('data-team-signature') !== signature) {
      root.parentNode.removeChild(root);
      root = null;
    }
    if (!root) {
      root = document.createElement('div');
      root.className = cfg.SHORTCUTS_ROOT_CLASS;
      root.setAttribute('aria-label', 'Ultimate Mode teams');
      root.setAttribute('data-team-signature', signature);
      items.forEach(function (label) { root.appendChild(createShortcut(label)); });
      nav.insertBefore(root, timesheets.nextSibling);
    } else {
      shared.safeQueryAll(root, '.' + cfg.SHORTCUT_CLASS).forEach(function (link, index) {
        if (items[index]) link.href = shortcutHref(items[index]);
      });
    }
    return root;
  }

  function brandCurrentTimesheets() {
    const nav = document.querySelector(cfg.HALO_NAV_MENU_SELECTOR);
    if (!nav) return false;
    const timesheets = shared.safeQueryAll(nav, cfg.HALO_ICON_LINK_SELECTOR).find(function (link) {
      return shared.matchesLabel(link, ['Timesheets']);
    });
    return brandTimesheets(timesheets);
  }

  function apply() {
    const discovered = discoverTeamIds();
    const resumed = resumePendingTeam();
    const branded = brandCurrentTimesheets();
    if (!isTeamNavigationRoute()) {
      removeShortcuts();
      return { found: discovered > 0 || branded, mounted: false, resumed: resumed, teams: discovered, branded: branded };
    }

    const root = mount();
    if (!root) {
      shared.warnOnce('missing:team-shortcuts', '找不到 Team 快捷列的左側導覽容器，本輪不加入 Team 快捷按鈕。');
      return { found: false, mounted: false, resumed: false, teams: knownTeamIds.size };
    }
    shared.clearWarning('missing:team-shortcuts');
    return { found: true, mounted: true, resumed: false, teams: knownTeamIds.size, branded: branded };
  }

  NS.ultimate.teamShortcuts = {
    apply: apply,
    restore: destroy,
    _knownTeamIds: knownTeamIds,
  };
})();
