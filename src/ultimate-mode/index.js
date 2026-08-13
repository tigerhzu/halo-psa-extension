/** ultimate-mode/index.js — storage、啟用狀態與各可獨立失敗的 UI filter 協調器。 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const shared = NS.ultimate.shared;
  const cfg = shared.cfg;
  let enabled = false;
  let started = false;
  let lastReport = null;

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
    };
    if (ticketDetailsMounted) {
      report.ticketActions = safeApply('Ticket Actions', NS.ultimate.ticketActions);
      report.ticketInfo = safeApply('Ticket Information', NS.ultimate.ticketInfo);
      report.userInfo = safeApply('End-User Details', NS.ultimate.userInfo);
    } else {
      ['ticket-actions', 'ticket-more-actions', 'ticket-info', 'user-info'].forEach(shared.restoreSection);
      report.ticketDetails = 'not-mounted';
    }
    const endedAt = window.performance && window.performance.now ? window.performance.now() : Date.now();
    report.durationMs = Math.round((endedAt - startedAt) * 10) / 10;
    lastReport = report;
    return report;
  }

  function setEnabled(next) {
    next = next === true;
    if (enabled === next) {
      if (enabled) NS.ultimate.observer.schedule();
      else shared.restoreAll();
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

  function readSetting() {
    try {
      chrome.storage.local.get(cfg.STORAGE_KEY, function (data) {
        const settings = (data && data[cfg.STORAGE_KEY]) || {};
        setEnabled(settings[cfg.SETTING_FIELD] === true);
      });
    } catch (error) {
      shared.warnOnce('storage-read', '讀取設定失敗，極致模式維持關閉。', error);
      setEnabled(false);
    }
  }

  function start() {
    if (started) return;
    started = true;
    readSetting();
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes[cfg.STORAGE_KEY]) return;
        const next = changes[cfg.STORAGE_KEY].newValue || {};
        setEnabled(next[cfg.SETTING_FIELD] === true);
      });
    } catch (error) {
      shared.warnOnce('storage-listener', '無法監聽設定變更；重新載入後仍會套用已儲存值。', error);
    }
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
  };
})();
