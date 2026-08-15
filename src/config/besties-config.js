/**
 * besties-config.js
 * 「聯絡人名單 / CC 快速加入」功能的設定資料（純資料，方便擴充與微調）。
 *
 * 名單來源（兩層）：
 *  1. 使用者在「設定頁」維護的群組 → 存在 chrome.storage.local（STORAGE_KEY.GROUPS_FIELD）。
 *  2. 若使用者尚未設定，回退到本檔的 defaultGroups（種子資料）。
 * 因此「之後要新增 主管 / 同事 / 專案經理」只要在設定頁加群組即可，不必改任何程式。
 *
 * EMAIL_WINDOW / CC 相關 selector 是「最常需要對著實際 HaloPSA DOM 微調」的部分，
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
     * 「寄信視窗」容器的候選 selector（任一命中即視為一個 email 視窗容器）。
     * 偵測主要靠「找得到 CC 欄位」，這裡是用來決定按鈕掛在哪個外層容器。
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
     * 「一看到就確定是寄信視窗」的強訊號欄位（HaloPSA 專屬命名）。
     * 命中其一就視為寄信視窗，不必再過 EMAIL_WINDOW_KEYWORDS（避免被關鍵字濾掉）。
     */
    STRONG_FIELD_SELECTORS: [
      'input[name="emailcc" i]',
      'input[name="emailto" i]',
      'input[name="emailbcc" i]',
    ],

    /**
     * 以「鄰近 label / 欄位文字」判斷 CC 欄位的關鍵字（大小寫不敏感）。
     * 用於 selector 全部落空時的後援尋找。
     */
    CC_LABEL_KEYWORDS: ['cc', '副本', '抄送', '抄送人'],

    /**
     * 判斷某容器是否「像寄信視窗」的關鍵字（避免把按鈕掛到不相干區塊）。
     * 刻意不含裸 "cc"（子字串太容易誤命中 account / success…）；偵測本身已以 CC 欄位為主訊號。
     */
    EMAIL_WINDOW_KEYWORDS: [
      'bcc',
      'subject',
      'send email',
      'reply',
      'email customer',
      '收件',
      '主旨',
      '副本',
      '寄送',
      '回覆',
    ],

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
