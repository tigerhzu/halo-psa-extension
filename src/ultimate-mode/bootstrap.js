/** ultimate-mode/bootstrap.js — 在 Halo 首次繪製前掛上極致模式 CSS guard。 */
(function () {
  'use strict';
  const STORAGE_KEY = 'hpx_settings';
  const FIELD = 'ultimateMode';

  try {
    chrome.storage.local.get(STORAGE_KEY, function (data) {
      const settings = (data && data[STORAGE_KEY]) || {};
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
