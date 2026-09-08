/** ultimate-mode/observer.js — 單一節流 observer，加上低成本 URL 變更偵測。 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const shared = NS.ultimate.shared;
  const cfg = shared.cfg;
  let observer = null;
  let timer = null;
  let routeTimer = null;
  let callback = null;
  let lastUrl = window.location.href;
  let mutationBurstAt = 0;

  function relevant(record) {
    if (shared.isOwnUi(record.target)) return false;
    if (record.type !== 'childList') return false;
    const changed = Array.prototype.slice.call(record.addedNodes || [])
      .concat(Array.prototype.slice.call(record.removedNodes || []));
    return changed.some(function (node) {
      return node.nodeType !== 1 || !shared.isOwnUi(node);
    });
  }

  function containsUrgentNode(record) {
    return Array.prototype.some.call(record.addedNodes || [], function (node) {
      if (node.nodeType !== 1) return false;
      if (shared.safeMatches(node, cfg.OBSERVER_URGENT_SELECTORS)) return true;
      return shared.safeQueryAll(node, cfg.OBSERVER_URGENT_SELECTORS).length > 0;
    });
  }

  function run() {
    timer = null;
    mutationBurstAt = 0;
    if (callback) callback();
  }

  function schedule(immediate) {
    if (timer) clearTimeout(timer);
    if (immediate) {
      // MutationObserver callback 與 SPA 導覽事件都在下一次 paint 之前執行；
      // urgent 節點必須「同步」reconcile，否則 setTimeout(0) 的 macrotask
      // 會落在 paint 之後，讓 Halo 原生 Sidebar 閃出一幀（FOUC）。
      timer = null;
      run();
      return;
    }
    if (!mutationBurstAt) mutationBurstAt = Date.now();
    const elapsed = Date.now() - mutationBurstAt;
    const delay = elapsed >= cfg.MAX_MUTATION_WAIT_MS ? 0 : cfg.SCAN_DEBOUNCE_MS;
    timer = setTimeout(run, delay);
  }

  function onMutations(records) {
    const relevantRecords = records.filter(relevant);
    if (!relevantRecords.length) return;
    schedule(relevantRecords.some(containsUrgentNode));
  }

  function onRouteEvent() {
    lastUrl = window.location.href;
    schedule(true);
  }

  function start(onScan) {
    callback = onScan;
    if (observer) return;
    lastUrl = window.location.href;
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    window.addEventListener('popstate', onRouteEvent);
    window.addEventListener('hashchange', onRouteEvent);
    if (window.navigation && window.navigation.addEventListener) {
      window.navigation.addEventListener('navigate', onRouteEvent);
    }
    routeTimer = setInterval(function () {
      if (window.location.href === lastUrl) return;
      lastUrl = window.location.href;
      schedule(true);
    }, cfg.ROUTE_POLL_MS);
  }

  function stop() {
    if (observer) observer.disconnect();
    observer = null;
    if (timer) clearTimeout(timer);
    timer = null;
    mutationBurstAt = 0;
    if (routeTimer) clearInterval(routeTimer);
    routeTimer = null;
    window.removeEventListener('popstate', onRouteEvent);
    window.removeEventListener('hashchange', onRouteEvent);
    if (window.navigation && window.navigation.removeEventListener) {
      window.navigation.removeEventListener('navigate', onRouteEvent);
    }
    callback = null;
  }

  NS.ultimate.observer = { start: start, stop: stop, schedule: schedule };
})();
