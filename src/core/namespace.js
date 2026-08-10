/**
 * namespace.js
 * 建立全域命名空間 window.__HPX，供所有 content script 檔案共用。
 * 因為本專案不使用打包工具 / ES module，各模組透過此命名空間互相引用。
 * 載入順序：本檔必須最先載入（見 manifest.json content_scripts.js）。
 */
(function () {
  'use strict';

  if (window.__HPX) {
    return; // 已初始化（避免重複注入）
  }

  window.__HPX = {
    /** 命名空間前綴，用於 DOM class / data 屬性，避免與 HaloPSA 衝突 */
    PREFIX: 'hpx',

    /** 各層模組會掛載於此 */
    config: {},
    core: {},
    ai: {},
    features: {},
    services: {},
    halo: {},
    ui: {},

    /** 簡易 debug 開關：localStorage.setItem('__hpx_debug', '1') 可開啟 */
    get debugEnabled() {
      try {
        return window.localStorage.getItem('__hpx_debug') === '1';
      } catch (e) {
        return false;
      }
    },

    log: function () {
      if (this.debugEnabled) {
        // eslint-disable-next-line no-console
        console.log('[HPX]', ...arguments);
      }
    },

    warn: function () {
      // eslint-disable-next-line no-console
      console.warn('[HPX]', ...arguments);
    },
  };
})();
