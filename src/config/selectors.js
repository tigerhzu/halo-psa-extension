/**
 * selectors.js
 * 編輯器偵測規則。這是上線後「最常需要對著實際 DOM 微調」的檔案。
 *
 * 設計原則：editor-agnostic（編輯器無關）。
 * 我們不假設 HaloPSA 用哪一套富文字編輯器，而是依序嘗試多種常見簽章，
 * 涵蓋 Froala / CKEditor / TinyMCE / 通用 contenteditable / textarea 保底。
 *
 * 微調方式：在 HaloPSA 開啟編輯器 → 右鍵「檢查」→ 找到實際可編輯元素的 class，
 * 把它加進 EDITOR_SELECTORS 最前面即可。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  NS.config.selectors = {
    /**
     * 編輯器內容（可編輯區）的候選 selector，依優先序嘗試。
     * 命中其一即視為一個編輯器實例。
     */
    EDITOR_SELECTORS: [
      '.fr-element[contenteditable="true"]', // Froala
      '.ck-editor__editable[contenteditable="true"]', // CKEditor 5
      '.mce-content-body[contenteditable="true"]', // TinyMCE (inline)
      'iframe.tox-edit-area__iframe', // TinyMCE (classic, iframe)
      'div.note-editable[contenteditable="true"]', // Summernote
      '[contenteditable="true"]', // 通用 contenteditable
      'textarea.hpx-target', // 明確標記的 textarea（保底，需手動加 class）
    ],

    /**
     * 用於判斷某個編輯器是否屬於目標欄位的關鍵字（會比對編輯器鄰近的
     * label / tab / 容器文字，大小寫不敏感、含中英）。
     */
    FIELD_KEYWORDS: [
      'activity',
      'internal note',
      'internal',
      'resolution',
      'update',
      'note',
      '活動',
      '內部',
      '解決',
      '更新',
      '備註',
    ],

    /**
     * 欄位辨識模式：
     *  - 'loose'（預設）：辨識不到目標欄位時，仍對所有偵測到的編輯器套用功能。
     *  - 'strict'：只有當編輯器鄰近文字命中 FIELD_KEYWORDS 才套用。
     */
    fieldMatchMode: 'loose',

    /**
     * 往上回溯幾層父節點來尋找 label / 欄位文字。
     */
    labelLookupDepth: 6,

    /**
     * 「Cute」主題用：HaloPSA 左側選單容器的候選 selector。
     * 偵測到後會被加上 marker class（hpx-theme-sidebar），CSS 只認那個 marker，
     * 所以這裡找錯/找不到都不會誤套到其他區塊。
     * 另有幾何檢查（靠左、夠高、夠窄）避免誤標到內容區。
     * ★ 不確定就用 F12 回報實際 class，加進清單最前面即可。
     */
    SIDEBAR_SELECTORS: [
      '#sidebar',
      '.sidebar',
      '#side-menu',
      '.side-menu',
      '.side-nav',
      '.sidenav',
      '.app-sidebar',
      '.main-sidebar',
      '.left-sidebar',
      '.nav-sidebar',
      'nav[class*="side" i]',
      '[class*="sidebar" i]',
      'aside',
      /* HaloPSA 展開側邊欄 / ticket list / 篩選 panel 常見 class 特徵 */
      '[class*="navigation" i]',
      '[class*="ticketlist" i]',
      '[class*="ticket-list" i]',
      '[class*="view-list" i]',
      '[class*="list-view" i]',
      '[class*="leftpanel" i]',
      '[class*="left-panel" i]',
      '[class*="leftcol" i]',
      '[class*="left-col" i]',
      '[class*="subnav" i]',
      '[class*="sub-nav" i]',
      '[class*="treeview" i]',
      '[class*="tree-view" i]',
      '[role="navigation"]',
      '[role="complementary"]',
    ],

    /**
     * 用來判斷「目前頁面確實是 HaloPSA」的簽章 selector（runtime 守門，
     * 任一命中即視為 Halo 頁面）。避免在被 matches 誤涵蓋的網站上執行。
     */
    HALO_SIGNATURE_SELECTORS: [
      'app-root', // Angular 應用根節點
      '[class*="halo"]',
      'link[href*="halo"]',
      'script[src*="halo"]',
    ],

    /**
     * Timesheet 使用 React Big Calendar。這些 selector 集中放在設定層，
     * 避免功能模組散落 HaloPSA 專屬 class。
     */
    TIMESHEET: {
      screen: '.timesheet-screen',
      calendar: '.rbc-calendar.rbc-addons-dnd',
      event: '.rbc-event',
      eventLabel: '.rbc-event-label',
      eventContent: '.rbc-event-content',
      dayColumn: '.rbc-day-slot',
    },
  };
})();
