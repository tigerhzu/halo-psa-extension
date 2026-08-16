/** ultimate-mode/index.js — storage、啟用狀態與各可獨立失敗的 UI filter 協調器。 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const shared = NS.ultimate.shared;
  const cfg = shared.cfg;
  let enabled = false;
  let started = false;
  let lastReport = null;
  let syncGeneration = 0;

  function normalizeTeams(value) {
    const source = Array.isArray(value) ? value : cfg.DEFAULT_TEAM_ITEMS;
    const seen = new Set();
    return source.reduce(function (items, value) {
      const label = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const key = shared.normalizeText(label);
      if (!label || seen.has(key) || items.length >= 20) return items;
      seen.add(key);
      items.push(label);
      return items;
    }, []);
  }

  function mergeTeamCatalog(value) {
    const teams = normalizeTeams(value);
    const seen = new Set(teams.map(shared.normalizeText));
    cfg.TEAM_PRESETS.forEach(function (preset) {
      preset.teams.forEach(function (team) {
        const key = shared.normalizeText(team);
        if (seen.has(key)) return;
        seen.add(key);
        teams.push(team);
      });
    });
    return normalizeTeams(teams);
  }

  function ensureTeamCatalog(settings) {
    const source = settings || {};
    if (Number(source[cfg.TEAM_CATALOG_VERSION_FIELD] || 0) >= cfg.TEAM_CATALOG_VERSION) {
      return Promise.resolve(source);
    }
    const existing = Array.isArray(source[cfg.TEAMS_FIELD])
      ? source[cfg.TEAMS_FIELD]
      : cfg.DEFAULT_TEAM_ITEMS;
    const next = Object.assign({}, source, {
      [cfg.TEAMS_FIELD]: mergeTeamCatalog(existing),
      [cfg.TEAM_CATALOG_VERSION_FIELD]: cfg.TEAM_CATALOG_VERSION,
    });
    return new Promise(function (resolve) {
      try {
        // Migration 可能和設定頁的即時寫入同時發生；寫入前重新讀取，避免舊快照覆蓋使用者剛改的欄位。
        chrome.storage.local.get(cfg.STORAGE_KEY, function (data) {
          const latest = (data && data[cfg.STORAGE_KEY]) || source;
          if (Number(latest[cfg.TEAM_CATALOG_VERSION_FIELD] || 0) >= cfg.TEAM_CATALOG_VERSION) {
            resolve(latest);
            return;
          }
          const latestTeams = Array.isArray(latest[cfg.TEAMS_FIELD])
            ? latest[cfg.TEAMS_FIELD]
            : next[cfg.TEAMS_FIELD];
          const merged = Object.assign({}, latest, {
            [cfg.TEAMS_FIELD]: mergeTeamCatalog(latestTeams),
            [cfg.TEAM_CATALOG_VERSION_FIELD]: cfg.TEAM_CATALOG_VERSION,
          });
          chrome.storage.local.set({ [cfg.STORAGE_KEY]: merged }, function () {
            // 儲存失敗時仍使用目前 catalog；UI filter 不能因此中斷。
            resolve(merged);
          });
        });
      } catch (error) {
        resolve(next);
      }
    });
  }

  function applyTeamSettings(settings) {
    const teams = normalizeTeams(settings && settings[cfg.TEAMS_FIELD]);
    cfg.SIDEBAR.TEAM_ITEMS.splice.apply(cfg.SIDEBAR.TEAM_ITEMS, [0, cfg.SIDEBAR.TEAM_ITEMS.length].concat(teams));
    cfg.SIDEBAR.KEEP_ITEMS.splice.apply(cfg.SIDEBAR.KEEP_ITEMS, [0, cfg.SIDEBAR.KEEP_ITEMS.length].concat(teams, ['Timesheets']));
    if (window.__HPXUltimateBootstrap && window.__HPXUltimateBootstrap.updateTeams) {
      window.__HPXUltimateBootstrap.updateTeams(teams);
    }
    return teams;
  }

  function safeApply(name, module) {
    try {
      return module.apply();
    } catch (error) {
      shared.warnOnce('crash:' + name, name + ' 套用失敗；其他區塊會繼續處理。', error);
      return { found: false, error: true };
    }
  }

  function scan() {
    if (!enabled) return { enabled: false };
    const startedAt = window.performance && window.performance.now ? window.performance.now() : Date.now();
    document.documentElement.setAttribute('data-hpx-ultimate-mode', 'on');
    document.documentElement.removeAttribute('data-hpx-ultimate-bootstrap');
    const ticketDetailsMounted = /^\/tickets(?:\/|$)/i.test(window.location.pathname) && !!document.querySelector(
      '.details_page_title .actionmenubtn, .details-group-header'
    );
    const report = {
      enabled: true,
      url: window.location.href,
      sidebar: safeApply('Sidebar', NS.ultimate.sidebar),
      teamShortcuts: safeApply('Team Shortcuts', NS.ultimate.teamShortcuts),
      header: safeApply('Header', NS.ultimate.header),
    };
    if (ticketDetailsMounted) {
      report.ticketActions = safeApply('Ticket Actions', NS.ultimate.ticketActions);
      report.ticketUtilities = safeApply('Ticket Utilities', NS.ultimate.ticketUtilities);
      report.ticketInfo = safeApply('Ticket Information', NS.ultimate.ticketInfo);
      report.userInfo = safeApply('End-User Details', NS.ultimate.userInfo);
    } else {
      ['ticket-actions', 'ticket-more-actions', 'ticket-utilities', 'ticket-info', 'user-info'].forEach(shared.restoreSection);
      report.ticketDetails = 'not-mounted';
    }
    const endedAt = window.performance && window.performance.now ? window.performance.now() : Date.now();
    report.durationMs = Math.round((endedAt - startedAt) * 10) / 10;
    lastReport = report;
    return report;
  }

  function setEnabled(next, options) {
    next = next === true;
    const shouldRescan = !options || options.rescan !== false;
    if (enabled === next) {
      if (enabled) {
        if (shouldRescan) NS.ultimate.observer.schedule();
      } else if (shouldRescan) {
        shared.restoreAll();
      }
      return;
    }
    enabled = next;
    if (!enabled) {
      NS.ultimate.observer.stop();
      NS.ultimate.teamShortcuts.restore();
      shared.restoreAll();
      NS.log('極致模式已關閉，HaloPSA UI 已恢復');
      return;
    }
    scan();
    NS.ultimate.observer.start(scan);
    NS.log('極致模式已啟用');
  }

  /**
   * 將一次設定快照套用到所有極致模式模組。
   *
   * 這裡集中處理初次讀取與 storage.onChanged，避免兩條路徑的行為不一致。
   * Team 清單變更時先移除舊快捷列，再交給低頻 observer 重建，避免畫面殘留舊項目。
   */
  function applySettingsSnapshot(settings, rebuildShortcuts) {
    const snapshot = settings || {};
    const wasEnabled = enabled;
    applyTeamSettings(snapshot);
    setEnabled(snapshot[cfg.SETTING_FIELD] === true, { rescan: rebuildShortcuts === true });
    if (enabled && wasEnabled && rebuildShortcuts) {
      // 設定頁寫入後先同步 Timesheets 快捷列，再讓 observer 做完整 SPA reconcile，
      // 避免使用者看到舊 Team 清單停留一個 observer debounce 週期。
      NS.ultimate.teamShortcuts.restore();
      safeApply('Team Shortcuts', NS.ultimate.teamShortcuts);
    }
    return snapshot;
  }

  function teamSignature(value) {
    return normalizeTeams(value).map(shared.normalizeText).join('\u001f');
  }

  function syncSettings(settings, rebuildShortcuts) {
    const generation = ++syncGeneration;
    return ensureTeamCatalog(settings).catch(function (error) {
      shared.warnOnce('storage-sync', '設定更新遷移失敗，先套用目前收到的設定。', error);
      return settings || {};
    }).then(function (snapshot) {
      // 多筆 storage 事件同時抵達時，只讓最後一筆快照更新 UI。
      if (generation !== syncGeneration) return snapshot;
      return applySettingsSnapshot(snapshot, rebuildShortcuts === true);
    });
  }

  function readSetting() {
    try {
      chrome.storage.local.get(cfg.STORAGE_KEY, function (data) {
        const settings = (data && data[cfg.STORAGE_KEY]) || {};
        syncSettings(settings, false);
      });
    } catch (error) {
      shared.warnOnce('storage-read', '讀取設定失敗，極致模式維持關閉。', error);
      setEnabled(false);
    }
  }

  function start() {
    if (started) return;
    started = true;
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes[cfg.STORAGE_KEY]) return;
        const change = changes[cfg.STORAGE_KEY];
        const next = change.newValue || {};
        const previous = change.oldValue || {};
        const ultimateChanged = previous[cfg.SETTING_FIELD] !== next[cfg.SETTING_FIELD]
          || teamSignature(previous[cfg.TEAMS_FIELD]) !== teamSignature(next[cfg.TEAMS_FIELD]);
        syncSettings(next, ultimateChanged);
      });
    } catch (error) {
      shared.warnOnce('storage-listener', '無法監聽設定變更；重新載入後仍會套用已儲存值。', error);
    }
    // 先註冊 listener，再讀取初始值，避免初始化期間的設定寫入落在空窗期。
    readSetting();
  }

  NS.features.ultimateMode = {
    start: start,
    setEnabled: setEnabled,
    rescan: function () { if (enabled) NS.ultimate.observer.schedule(); },
    isEnabled: function () { return enabled; },
    restore: shared.restoreAll,
    _scan: scan,
    debug: function () {
      const report = scan();
      // eslint-disable-next-line no-console
      console.log('[HPX] 極致模式診斷', report);
      return report;
    },
    lastReport: function () { return lastReport; },
    getTeams: function () { return cfg.SIDEBAR.TEAM_ITEMS.slice(); },
    _normalizeTeams: normalizeTeams,
  };
})();
