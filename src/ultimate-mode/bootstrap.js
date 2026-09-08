/** ultimate-mode/bootstrap.js — 在 Halo 首次繪製前掛上極致模式 CSS guard。 */
(function () {
  'use strict';
  const STORAGE_KEY = 'hpx_settings';
  const FIELD = 'ultimateMode';
  const TEAMS_FIELD = 'ultimateTeams';
  const DEFAULT_TEAMS = [
    'Op Team A', 'Op Team B', 'Op Team C', 'Other Support',
    'Project Manager', 'SecOp Team A', 'Technical Solutions Division',
    'RD', 'Thailand Team', 'Sales&Admin',
  ];
  const STYLE_ID = 'hpx-ultimate-team-guard';
  const PENDING_TEAM_KEY = 'hpx_ultimate_pending_team';
  const TEAM_IDS_KEY = 'hpx_ultimate_team_ids';

  function normalizedTeams(value) {
    const source = Array.isArray(value) ? value : DEFAULT_TEAMS;
    const seen = new Set();
    return source.reduce(function (teams, value) {
      const label = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const key = label.toLocaleLowerCase();
      if (!label || seen.has(key) || teams.length >= 20) return teams;
      seen.add(key);
      teams.push(label);
      return teams;
    }, []);
  }

  function attributeValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\f]/g, ' ');
  }

  /**
   * 只有 Halo 的 Team row 本身真的提供 title，第一幀 guard 才能安全使用。
   * Live HaloPSA 多數版本把名稱放在子層 .nodetitle；這種結構交給
   * document_idle 的 sidebar.js 依可見文字處理，不能用 title selector 猜測，
   * 否則會把所有 Team 一起隱藏。
   */
  function canGuardRows(teams) {
    // 保留極早期／測試環境的既有 guard 行為；真實瀏覽器一定會提供 querySelectorAll。
    if (!document || typeof document.querySelectorAll !== 'function') return true;
    let rows;
    try {
      rows = document.querySelectorAll('#halo-tree .treeviewnode[data-level="1"]');
    } catch (error) {
      return false;
    }
    if (!rows.length) return false;

    let matched = false;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row.hasAttribute('title')) return false;
      const title = String(row.getAttribute('title') || '').trim().toLocaleLowerCase();
      if (teams.some(function (team) { return team.toLocaleLowerCase() === title; })) matched = true;
    }
    return matched;
  }

  /**
   * team-shortcuts.js 每輪掃描都會把「已驗證的 Team label → Halo data-id」
   * 寫入 sessionStorage。data-id 是 row 本身的屬性，讓第一幀 guard 在
   * live Halo（名稱藏在子層 .nodetitle、row 沒有 title）也能用 CSS 隱藏。
   */
  function persistedTeamIds() {
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(TEAM_IDS_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function updateTeamGuard(value) {
    let teams = normalizedTeams(value);
    try {
      const parentLabel = new URL(window.location.href).searchParams.get('selparentid') || '';
      const pendingLabel = window.sessionStorage.getItem(PENDING_TEAM_KEY) || '';
      const routeLabel = pendingLabel || parentLabel;
      const active = teams.find(function (team) { return team.toLocaleLowerCase() === routeLabel.toLocaleLowerCase(); });
      if (active) teams = [active];
    } catch (error) {
      // Keep the configured whitelist when the current URL cannot be parsed.
    }
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    const rules = [];
    if (canGuardRows(teams)) {
      const keep = teams.map(function (team) {
        return ':not([title="' + attributeValue(team) + '"])';
      }).join('');
      rules.push('html[data-hpx-ultimate-mode="on"] #halo-tree li:has(> .treeviewnode[data-level="1"]' + keep + '){display:none!important;}');
    }
    const ids = persistedTeamIds();
    const keptIds = teams.map(function (team) {
      const id = ids[team.replace(/\s+/g, ' ').trim().toLocaleLowerCase()];
      return /^[\w-]+$/.test(String(id == null ? '' : id)) ? String(id) : '';
    });
    if (teams.length && keptIds.every(Boolean)) {
      // Fail open：只有「每個」保留 Team 都有已驗證 id 時才啟用 id guard，
      // 否則缺 id 的 Team 會被自己的 guard 藏起來。
      const keepIds = keptIds.map(function (id) {
        return ':not([data-id="' + attributeValue(id) + '"])';
      }).join('');
      rules.push('html[data-hpx-ultimate-mode="on"] #halo-tree li:has(> .treeviewnode[data-level="1"]' + keepIds + '){display:none!important;}');
    }
    // 沒有任何可驗證依據（title / data-id）時維持空 guard，避免整棵 tree 被藏。
    style.textContent = rules.join('\n');
  }

  window.__HPXUltimateBootstrap = { updateTeams: updateTeamGuard, normalizeTeams: normalizedTeams };

  try {
    chrome.storage.local.get(STORAGE_KEY, function (data) {
      const settings = (data && data[STORAGE_KEY]) || {};
      updateTeamGuard(settings[TEAMS_FIELD]);
      // 整頁載入（例如 Team 快捷列的 <a> 導頁）時，theme attribute 與 accent
      // 必須在第一幀就存在，theme-cute-ios.css 的 Sidebar 樣式才不會晚到。
      // 正規化規則與 theme.js loadAll 相同：非 'default' 一律視為 cute-ios。
      if (settings.theme !== 'default') {
        document.documentElement.setAttribute('data-hpx-theme', 'cute-ios');
        const accent = /^#[0-9a-f]{6}$/i.test(String(settings.accent || '')) ? String(settings.accent).toLowerCase() : '#0c2d55';
        document.documentElement.style.setProperty('--hpx-accent', accent);
      }
      if (settings[FIELD] === true) {
        document.documentElement.setAttribute('data-hpx-ultimate-mode', 'on');
        document.documentElement.setAttribute('data-hpx-ultimate-bootstrap', 'pending');
        window.setTimeout(function () {
          if (document.documentElement.getAttribute('data-hpx-ultimate-bootstrap') !== 'pending') return;
          document.documentElement.removeAttribute('data-hpx-ultimate-bootstrap');
          document.documentElement.removeAttribute('data-hpx-ultimate-mode');
        }, 8000);
      }
    });
  } catch (error) {
    // Fail open：設定讀取失敗時不隱藏 Halo 原生介面。
  }
})();
