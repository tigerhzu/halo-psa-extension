/**
 * time-adjuster-config.js
 * 「Time Taken 快速調整」的偵測規則與按鈕設定。
 *
 * 偵測刻意「不依賴 HaloPSA 的隨機 class 名稱」：
 * 主要訊號是 Time Taken 標籤文字，其次是三個相鄰的時間輸入框結構特徵。
 * 若日後 Halo 改版，通常只需要在這裡加關鍵字或調整層數，不必改邏輯。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  NS.config.timeAdjuster = {
    /** 標記已插入工具列，避免重複插入（需求指定的 data attribute）。 */
    MARK_ATTR: 'data-hpx-time-adjuster',

    /**
     * Time Taken 標籤文字比對。
     * 以「正規化後的完整文字」比對，避免整個 Action 面板的長文字誤命中。
     */
    LABEL_PATTERNS: [
      /^time\s*taken\b/i,
      /^time\s*spent\b/i,
      /^花費時間/,
      /^耗用時間/,
      /^所花時間/,
    ],

    /** 標籤節點的文字長度上限：超過就不是標籤，是整段區塊文字。 */
    LABEL_MAX_LENGTH: 40,

    /** 找到標籤後，往上回溯幾層尋找時間輸入框的容器。 */
    CONTAINER_LOOKUP_DEPTH: 10,

    /**
     * 工具列插入位置：
     *  - 'below-field'（預設）：插在「完整的時：分：秒欄位」之後，獨立一行、靠左。
     *    絕不插進時、分、秒之間，避免把原生欄位排列拆開。
     *  - 'beside'：插在欄位同一行右側。版面夠寬時比較省空間，但窄版面容易被擠出去。
     */
    INSERT_MODE: 'below-field',

    /** 'below-field' 模式往外找 block 版面容器時最多走幾層。 */
    BLOCK_ANCHOR_DEPTH: 4,

    /**
     * 可接受的欄位數量下限。
     * Halo 不同動作（Update / On Hold / Close…）的 Time Taken 可能是
     * 時＋分＋秒三格，也可能只有時＋分兩格，因此不硬性要求三格。
     */
    MIN_FIELDS: 2,

    /**
     * 單一欄位形式的 Time Taken（例如整格顯示 `00:19:40` 或 `00:19`）。
     * 找不到多格欄位時才會用這個形狀。
     */
    COMBINED_PATTERN: /^\s*(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\s*$/,

    /**
     * 個別欄位的辨識關鍵字（比對 aria-label / placeholder / name / id / title）。
     * 找不到時退回「文件順序 = 時、分、秒」。
     */
    UNIT_HINTS: {
      hours: ['hour', 'hrs', 'hh', '小時', '時'],
      minutes: ['minute', 'min', 'mm', '分鐘', '分'],
      seconds: ['second', 'sec', 'ss', '秒'],
    },

    /** 快速調整按鈕（deltaMinutes 為正負分鐘數）。 */
    PRESETS: [
      { label: '-5 分', deltaMinutes: -5 },
      { label: '+5 分', deltaMinutes: 5 },
      { label: '+10 分', deltaMinutes: 10 },
      { label: '+15 分', deltaMinutes: 15 },
      { label: '+30 分', deltaMinutes: 30 },
      { label: '+1 小時', deltaMinutes: 60 },
    ],

    /** 小時欄位上限（兩位數），用來夾住總秒數避免寫入不合法的值。 */
    MAX_HOURS: 99,

    /** 掃描節流：合併 SPA 爆量 DOM 變動。 */
    SCAN_DEBOUNCE_MS: 200,
  };
})();
