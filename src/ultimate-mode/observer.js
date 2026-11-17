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
  let mutationBurstAt = null;
  let hiddenDirty = false;
  const urgentSelector = cfg.OBSERVER_URGENT_SELECTORS.join(',');
  // A full reconcile includes semantic fallbacks and layout reads. Give Halo's
  // render bursts room to finish instead of repeating that work every 32 ms.
  const debounceMs = Math.max(120, cfg.SCAN_DEBOUNCE_MS);

  function relevant(record) {
    if (shared.isOwnUi(record.target)) return false;
    if (record.type !== 'childList') return false;
    function nativeNode(node) {
      return node.nodeType !== 1 || !shared.isOwnUi(node);
    }
    return Array.prototype.some.call(record.addedNodes || [], nativeNode) ||
      Array.prototype.some.call(record.removedNodes || [], nativeNode);
  }

  function containsUrgentNode(record) {
    return Array.prototype.some.call(record.addedNodes || [], function (node) {
      if (node.nodeType !== 1) return false;
      if (shared.isOwnUi(node)) return false;
      // One native subtree query, rather than walking the same subtree once per
      // selector and materializing every matching element.
      try {
        return node.matches(urgentSelector) || !!node.querySelector(urgentSelector);
      } catch (error) {
        return shared.safeMatches(node, cfg.OBSERVER_URGENT_SELECTORS) ||
          shared.safeQueryAll(node, cfg.OBSERVER_URGENT_SELECTORS).length > 0;
      }
    });
  }

  function run() {
    timer = null;
    mutationBurstAt = null;
    if (document.hidden) {
      hiddenDirty = true;
      return;
    }
    hiddenDirty = false;
    if (callback) callback();
  }

  function schedule(immediate) {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (document.hidden) {
      hiddenDirty = true;
      mutationBurstAt = null;
      return;
    }
    if (immediate) {
      // MutationObserver callback 與 SPA 導覽事件都在下一次 paint 之前執行；
      // urgent 節點必須「同步」reconcile，否則 setTimeout(0) 的 macrotask
      // 會落在 paint 之後，讓 Halo 原生 Sidebar 閃出一幀（FOUC）。
      timer = null;
      run();
      return;
    }
    if (mutationBurstAt === null) mutationBurstAt = Date.now();
    const elapsed = Date.now() - mutationBurstAt;
    const delay = Math.max(0, Math.min(debounceMs, cfg.MAX_MUTATION_WAIT_MS - elapsed));
    timer = setTimeout(run, delay);
  }

  function onMutations(records) {
    // Hidden pages need only one catch-up pass, not subtree queries for every
    // native render (or every animation update inside extension-owned UI).
    if (document.hidden) {
      hiddenDirty = true;
      return;
    }
    let changed = false;
    for (let i = 0; i < records.length; i += 1) {
      if (!relevant(records[i])) continue;
      changed = true;
      if (containsUrgentNode(records[i])) {
        schedule(true);
        return;
      }
    }
    if (changed) schedule(false);
  }

  function onRouteEvent() {
    if (window.location.href === lastUrl) return;
    lastUrl = window.location.href;
    schedule(true);
  }

  function onVisibilityChange() {
    if (!document.hidden && hiddenDirty) schedule(true);
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
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (window.navigation && window.navigation.addEventListener) {
      // currententrychange observes the committed URL; navigate fires before
      // it changes. Modern Chromium needs no permanent URL polling timer.
      window.navigation.addEventListener('currententrychange', onRouteEvent);
    } else {
      routeTimer = setInterval(onRouteEvent, cfg.ROUTE_POLL_MS);
    }
  }

  function stop() {
    if (observer) observer.disconnect();
    observer = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    mutationBurstAt = null;
    hiddenDirty = false;
    if (routeTimer !== null) clearInterval(routeTimer);
    routeTimer = null;
    window.removeEventListener('popstate', onRouteEvent);
    window.removeEventListener('hashchange', onRouteEvent);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (window.navigation && window.navigation.removeEventListener) {
      window.navigation.removeEventListener('currententrychange', onRouteEvent);
    }
    callback = null;
  }

  NS.ultimate.observer = { start: start, stop: stop, schedule: schedule };
})();
