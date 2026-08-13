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

    /**
     * 極致模式的 HaloPSA DOM 規則。
     *
     * 原則：
     *  - selector 只負責縮小候選範圍，真正套用前仍會用精確文字與區塊簽章驗證。
     *  - data-* / aria / role 優先，class 子字串只作 fallback。
     *  - 不使用 nth-child，也不依賴 minified / hash class。
     *  - Halo 改版後若實際 DOM 不再符合，模組會跳過該區塊並 warning，不會猜測性隱藏。
     */
    ULTIMATE_MODE: {
      STORAGE_KEY: 'hpx_settings',
      SETTING_FIELD: 'ultimateMode',
      HIDDEN_CLASS: 'halo-ultimate-hidden',
      OWNED_ATTR: 'data-hpx-ultimate-hidden',
      SECTION_ATTR: 'data-hpx-ultimate-section',
      KEEP_ATTR: 'data-hpx-ultimate-keep',
      SCAN_DEBOUNCE_MS: 32,
      MAX_MUTATION_WAIT_MS: 240,
      ROUTE_POLL_MS: 800,
      OBSERVER_URGENT_SELECTORS: [
        '#halo-tree',
        '#app-nav-menu .app-nav-menu-sidebar',
        '.details_page_title',
        '.details-group-header',
        '.timesheet-screen',
      ],
      TEXT_SUBTREE_SKIP_SELECTOR: 'ul, ol, [role="group"], [role="tree"], [role="menu"]',
      TEXT_CANDIDATE_SELECTORS: [
        'button', 'a', 'span', 'div', 'p', 'li', 'label', 'dt', 'th',
        '[role]', '[aria-label]', '[title]', '[data-label]', '[data-field-name]',
      ],
      MAX_LABEL_TEXT_LENGTH: 100,

      OWN_UI_ROOT_SELECTORS: [
        '.hpx-toolbar',
        '.hpx-sp',
        '.hpx-sp-pet',
        '.hpx-modal-overlay',
        '.hpx-loader',
        '.hpx-toast-container',
        '.hpx-ts-preview-backdrop',
        '.hpx-tta',
        '.hpx-ultimate-team-shortcuts',
        '.hpx-ultimate-timesheets-logo',
      ],

      SIDEBAR: {
        HALO_TREE_ROOT: '#halo-tree',
        HALO_TEAM_ROW_SELECTOR: '.treeviewnode',
        HALO_TEAM_TITLE_SELECTOR: '.nodetitle',
        HALO_ICON_LINK_SELECTOR: '.app-side-link',
        HALO_NAV_MENU_SELECTOR: '#app-nav-menu .app-nav-menu-sidebar',
        SHORTCUTS_ROOT_CLASS: 'hpx-ultimate-team-shortcuts',
        SHORTCUT_CLASS: 'hpx-ultimate-team-shortcut',
        PENDING_TEAM_KEY: 'hpx_ultimate_pending_team',
        TICKETS_ROUTE: '/tickets?area=1&mainview=team&viewid=0',
        ROOT_SELECTORS: [
          '#halo-tree',
          '[data-testid="sidebar"]',
          '[data-testid*="side-navigation" i]',
          'nav[aria-label*="navigation" i]',
          '[role="navigation"][aria-label*="side" i]',
        ],
        ITEM_CONTAINER_SELECTORS: [
          '[role="treeitem"]',
          '[role="menuitem"]',
          'li',
          '[data-testid*="nav-item" i]',
          '[data-testid*="menu-item" i]',
        ],
        LABEL_SELECTORS: [
          'a[href]',
          'button',
          'span',
          'div',
          'p',
          '[role="treeitem"]',
          '[role="menuitem"]',
          '[aria-label]',
          '[title]',
        ],
        KEEP_ITEMS: ['Op Team A', 'Op Team B', 'Op Team C', 'Timesheets'],
        TEAM_ITEMS: ['Op Team A', 'Op Team B', 'Op Team C'],
        ICON_ITEMS_TO_HIDE: [
          'Service Desk', 'Projects', 'Calendar', 'Customers', 'Assets',
          'My Approvals', 'Knowledge Base', 'Suppliers', 'Search', 'Reporting',
          'Dashboard', 'My Config',
        ],
        MIN_SIGNATURE_MATCHES: 3,
        MAX_ROW_HEIGHT: 72,
        MAX_ROW_TEXT_LENGTH: 160,
        MAX_ROW_LOOKUP_DEPTH: 6,
        CHILD_INDENT_PX: 8,
      },

      TICKET_ACTIONS: {
        HALO_TITLE_BAR_SELECTOR: '.details_page_title',
        HALO_BUTTON_CONTAINER_SELECTOR: '.buttons-container',
        HALO_ACTION_BUTTON_SELECTOR: '.actionmenubtn',
        HALO_ACTION_MORE_SELECTOR: ':scope > [role="listbox"]',
        HALO_ACTION_MENU_SELECTOR: ':scope > .menu',
        HALO_ACTION_MENU_ITEM_SELECTOR: ':scope > .item[role="option"]',
        ROOT_SELECTORS: [
          '[data-testid="ticket-actions"]',
          '[data-testid*="ticket-action-bar" i]',
          '[aria-label="Ticket actions" i]',
          '[class*="ticket-action" i]',
          '[class*="action-bar" i]',
          '[class*="actionbar" i]',
        ],
        CONTROL_SELECTORS: [
          'button',
          'a[role="button"]',
          '[role="button"]',
          '[role="menuitem"]',
        ],
        GENERIC_CONTROL_SELECTORS: ['button', 'a', '[role="button"]', 'span', 'div'],
        KEEP_PRIMARY: [
          'Re-Assign',
          'Re Assign',
          'Reassign',
          'First Contact',
          'Pending',
          'In Progress',
          'On Hold',
          'Postponed',
          'Awaiting Customer',
          'Awaiting Customer Reply',
          'Vendor Processing',
          'More',
          'More Actions',
          'More options',
          'Back',
          'Go back',
        ],
        PRIMARY_SIGNATURE: [
          'Re-Assign',
          'Re Assign',
          'Reassign',
          'First Contact',
          'Pending',
          'In Progress',
          'On Hold',
          'Postponed',
          'Awaiting Customer',
          'Awaiting Customer Reply',
          'Vendor Processing',
        ],
        KEEP_MORE: [
          'Email User',
          'Activity Note',
          'Final Check with Customer/Sales',
        ],
        MORE_LABELS: ['More', 'More Actions', 'More options'],
        MENU_ROOT_SELECTORS: [
          '[role="menu"]',
          '[data-testid*="action-menu" i]',
          '[class*="dropdown-menu" i]',
          '[class*="menu-list" i]',
        ],
        MENU_ITEM_SELECTORS: [
          '[role="menuitem"]',
          'button',
          'a',
          'span',
          'div',
        ],
        MIN_PRIMARY_SIGNATURE_MATCHES: 2,
        MAX_CONTROL_HEIGHT: 72,
        MAX_CONTROL_TEXT_LENGTH: 100,
        MAX_CONTROL_LOOKUP_DEPTH: 5,
      },

      TICKET_INFO: {
        SECTION: 'ticket-info',
        HEADINGS: ['Ticket Information'],
        ROOT_SELECTORS: [
          '[data-testid="ticket-information"]',
          '[data-testid*="ticket-details" i]',
          '[aria-label="Ticket Information" i]',
          '[class*="ticket-information" i]',
          '[class*="ticket-details" i]',
        ],
        KEEP_FIELDS: [
          'Date Created',
          'Created By',
          'Ticket Type',
          'Status',
          'Team',
          'Assigned Agent',
          'Additional Agents',
          'Time Recorded',
          'Impact',
          'Category',
        ],
      },

      USER_INFO: {
        SECTION: 'user-info',
        HEADINGS: ['End-User Details', 'End User Details'],
        ROOT_SELECTORS: [
          '[data-testid="end-user-details"]',
          '[data-testid*="user-details" i]',
          '[aria-label="End-User Details" i]',
          '[aria-label="End User Details" i]',
          '[class*="end-user" i]',
          '[class*="user-details" i]',
        ],
        KEEP_FIELDS: [
          'User',
          'Top Level',
          'Client',
          'Site',
          'Email Address',
          'Phone Number',
          'Site Phone Number',
        ],
      },

      DETAILS: {
        HALO_HEADING_SELECTOR: '.details-group-header',
        HALO_GROUP_SELECTOR: '.details-group',
        HALO_INFO_SELECTOR: ':scope > .info.info-form',
        HALO_FIELD_ROW_SELECTOR: ':scope > .col-md-12.inline.nopad',
        HALO_FIELD_LABEL_SELECTOR: 'label',
        HEADING_SELECTORS: [
          'h1',
          'h2',
          'h3',
          'h4',
          'legend',
          '[role="heading"]',
          '[aria-label]',
        ],
        LABEL_SELECTORS: [
          'label',
          'dt',
          'th',
          '[data-field-name]',
          '[data-label]',
          '[class*="field-label" i]',
          '[class*="detail-label" i]',
          '[class*="label-container" i]',
        ],
        ROW_SELECTORS: [
          'tr',
          '[data-field-name]',
          '[data-testid*="field" i]',
          '[class~="field"]',
          '[class~="form-group"]',
          '[class*="field-row" i]',
          '[class*="detail-row" i]',
          '[class*="info-row" i]',
          '[class*="form-group" i]',
        ],
        MIN_FIELD_ROWS: 2,
        MIN_SHARED_ROW_MATCHES: 2,
        MAX_SHARED_ROW_CHILDREN: 40,
        MAX_SECTION_DEPTH: 7,
        MAX_ROW_DEPTH: 4,
      },
    },
  };
})();
