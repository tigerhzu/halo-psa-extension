/**
 * besties-config.js
 * 「聯絡人名單 / CC 快速加入」功能的設定資料（純資料，方便擴充與微調）。
 *
 * 名單來源（兩層）：
 *  1. 使用者在「設定頁」維護的群組 → 存在 chrome.storage.local（STORAGE_KEY.GROUPS_FIELD）。
 *  2. 若使用者尚未設定，回退到本檔的 defaultGroups（種子資料）。
 * 因此「之後要新增 主管 / 同事 / 專案經理」只要在設定頁加群組即可，不必改任何程式。
 *
 * EMAIL_WINDOW / CC / Action 相關 selector 是「最常需要對著實際 HaloPSA DOM 微調」的部分，
 * 全部集中在這裡，方便上線後調整。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  NS.config.besties = {
    // ── 名單儲存位置（與 options.js 必須一致）──
    STORAGE_KEY: 'hpx_settings',
    GROUPS_FIELD: 'contactGroups',
    DEFAULT_CC_FIELD: 'defaultCcRecipients',

    /**
     * 預設群組（種子）。設定頁尚未存任何名單時使用。
     * 結構：[{ name, members: [{ name, email }] }]
     */
    defaultGroups: [],

    /**
     * 允許寄信 Action 容器的候選 selector。
     * 偵測主要靠「找得到 CC 欄位」再搭配 Action 類型判斷，這裡用來決定
     * 按鈕掛在哪個外層容器。
     * 依實際 DOM 由窄到寬排列。
     */
    EMAIL_WINDOW_SELECTORS: [
      '[class*="email" i]',
      '[class*="mail" i]',
      '[role="dialog"]',
      'form',
    ],

    /**
     * 含有輸入欄位、但不是寄信視窗的區域。
     * 避免 Timesheet 等功能被誤判並掛上「摯友名單」。
     */
    EXCLUDED_WINDOW_SELECTORS: [
      '[data-hpx-ignore-besties="1"]',
      '.timesheet-screen',
      '.hpx-ts-preview-backdrop',
      '.hpx-ts-preview',
      '.hpx-ts-editor',
    ],

    /** New Ticket 也可能使用 emailcc 欄位名稱，但不是寄信視窗。 */
    NEW_TICKET_ROOT_SELECTORS: [
      '.new-ticket-screen',
      '[data-testid*="new-ticket" i]',
      '[data-test*="new-ticket" i]',
      '[class*="new-ticket" i]',
      '[class*="newticket" i]',
    ],

    /**
     * CC 欄位的候選 selector，依優先序嘗試（在 email 視窗容器內尋找）。
     * 先精確、後寬鬆。注意 "cc" 子字串很容易誤命中，故寬鬆者放最後並輔以 label 比對。
     *
     * HaloPSA 實測：CC 是 react-select 元件，真正的值放在隱藏 input[name="emailcc"]，
     * 可見的打字框是 input[id^="react-select"]。故把 emailcc 放最前面當主訊號。
     */
    CC_FIELD_SELECTORS: [
      'input[name="emailcc" i]', // HaloPSA：CC 隱藏值欄位（主訊號）
      'input[name*="emailcc" i]',
      'input[name="cc" i]',
      'input[id="cc" i]',
      'input[name$="cc" i]',
      'input[id$="cc" i]',
      'input[aria-label*="cc" i]',
      'input[placeholder*="cc" i]',
      'textarea[name*="cc" i]',
      'input[name*="cc" i]',
      'input[id*="cc" i]',
    ],

    /**
     * CC 欄位可能是隱藏值 input + 可見 react-select 輸入框；
     * 用這些控制項確認目前確實處於寄信模式，避免只因 hidden emailcc
     * 還留在 Resolve Ticket DOM 就誤掛工具列。
     */
    VISIBLE_CC_CONTROL_SELECTORS: [
      'input[id^="react-select" i]',
      'input[role="combobox"]',
    ],

    /** HaloPSA Action 標題；只從這些節點判斷 Action，避免讀到下方 AI 工具列文字。 */
    ACTION_TITLE_SELECTORS: [
      '.history-header .outcome.oneline',
      '.history-header .outcome',
      '.history-header',
    ],
    ACTION_TITLE_LOOKUP_DEPTH: 12,

    /**
     * 聯絡人／CC 工具列的寄信 Action 白名單。
     * 只有 Email User、First Contract（Halo 實際顯示 First Contact）與
     * Resolve Ticket／Resolved Ticket 可以顯示；其它 Action 一律不得顯示工具列。
     */
    EMAIL_ACTION_KEYWORDS: [
      'email user',
      'first contract',
      'first contact',
      'resolve ticket',
      'resolved ticket',
    ],

    /** Activity Note 等非寄信 Action 即使帶有 emailcc，也不得顯示 CC 工具列。 */
    NON_EMAIL_ACTION_KEYWORDS: [
      'activity note',
      'internal note',
      '活動備註',
      '內部備註',
    ],

    /**
     * 以「鄰近 label / 欄位文字」判斷 CC 欄位的關鍵字（大小寫不敏感）。
     * 用於 selector 全部落空時的後援尋找。
     */
    CC_LABEL_KEYWORDS: ['cc', '副本', '抄送', '抄送人'],

    /**
     * CC 欄位寫入策略：
     *  - 'auto'（預設）：先嘗試一般輸入框（逗號分隔），偵測到像 chip/token 輸入時改用 token 模式。
     *  - 'plain'：一律當成一般文字輸入框，把 email 以逗號接在現有值後面。
     *  - 'token'：一律當成標籤/token 輸入框，逐一輸入後送出 Enter。
     */
    ccInputMode: 'auto',

    /** CC 欄位往上回溯幾層尋找 label / 視窗容器 */
    lookupDepth: 6,
  };
})();
