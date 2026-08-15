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
    if (!canGuardRows(teams)) {
      // Fail open：沒有可驗證的 row title 時，避免 selector 將整棵 Team tree 藏起來。
      style.textContent = '';
      return;
    }
    const keep = teams.map(function (team) {
      return ':not([title="' + attributeValue(team) + '"])';
    }).join('');
    style.textContent = 'html[data-hpx-ultimate-mode="on"] #halo-tree li:has(> .treeviewnode[data-level="1"]' + keep + '){display:none!important;}';
  }

  window.__HPXUltimateBootstrap = { updateTeams: updateTeamGuard, normalizeTeams: normalizedTeams };

  try {
    chrome.storage.local.get(STORAGE_KEY, function (data) {
      const settings = (data && data[STORAGE_KEY]) || {};
      updateTeamGuard(settings[TEAMS_FIELD]);
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
