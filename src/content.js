/**
 * content.js
 * 進入點：啟動編輯器偵測器，掛上 / 移除浮動工具列。
 * 本檔在所有模組之後載入（見 manifest.json content_scripts.js 順序）。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  if (!NS) {
    // namespace.js 未載入（理論上不會發生）
    // eslint-disable-next-line no-console
    console.warn('[HPX] 命名空間未初始化，content script 中止');
    return;
  }

  function onEditorFound(editorEl) {
    NS.ui.toolbar.mount(editorEl);
  }

  function onEditorRemoved(editorEl) {
    NS.ui.toolbar.unmount(editorEl);
    // SPA 換掉編輯器後，對應的獨立編輯視窗 session 已無法寫回，讓它失效。
    NS.features.noteWindow.forgetEditor(editorEl);
  }

  // ── 功能：聯絡人名單 / CC 快速加入（獨立於編輯器工具列）──
  function onEmailWindowFound(windowEl) {
    NS.ui.bestiesToolbar.mount(windowEl);
    NS.features.besties.applyDefaultCc(windowEl).catch(function (error) {
      NS.warn('Unable to apply default CC recipients', error);
    });
  }

  function onEmailWindowRemoved(windowEl) {
    NS.ui.bestiesToolbar.unmount(windowEl);
  }

  function init() {
    // 外觀主題（只套在 .hpx-* 元件，不影響 HaloPSA）：在 <html> 設定 data-hpx-theme
    NS.ui.theme.start();

    // 極致模式：可逆地精簡 Halo 原生 UI；各區塊 selector 失敗時彼此隔離。
    NS.features.ultimateMode.start();

    // 浮動設定面板（右下角 FAB → 右側滑入）
    NS.ui.settingsPanel.start();

    // Optional three-step first-login hint. It opens an independent extension page when possible.
    NS.ui.onboarding.start();

    // 獨立 Note 編輯視窗：接收背景轉送的套用請求（唯一會寫回 Halo 編輯器的入口）
    NS.features.noteWindow.start();

    // 啟動編輯器偵測器（AI 潤稿 / 範本工具列）
    NS.core.detector.start({
      onEditorFound: onEditorFound,
      onEditorRemoved: onEditorRemoved,
    });

    // 啟動寄信視窗偵測器（聯絡人名單）
    NS.core.emailWindowDetector.start({
      onFound: onEmailWindowFound,
      onRemoved: onEmailWindowRemoved,
    });

    // Timesheet：提供手動工時調整，並透過 Halo 原生更新流程套用。
    NS.features.timesheetAlign.start();

    // Time Taken 快速調整：在 Action 的原生時／分／秒欄位下方插入工具列。
    // 只改 DOM 欄位值，不呼叫 API、不自動儲存或送出 Action。
    NS.features.timeAdjuster.start();

    NS.log('HaloPSA Writing Helper 已啟動');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
