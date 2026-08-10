/**
 * format-rules.js
 * 功能3（整理格式）使用的規則資料。皆為純資料，方便擴充。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  NS.config.formatRules = {
    /**
     * 常見錯字 / 用語統一對照表（key 會被換成 value）。
     * 注意：以「較長詞優先」處理，避免子字串先被替換。
     */
    typoMap: {
      重開機: '重新啟動',
      重開: '重新啟動',
      測試vpn: '測試 VPN 連線',
      測試VPN: '測試 VPN 連線',
      重啟: '重新啟動',
      目前正常: '目前運作正常',
    },

    /**
     * 英文 / 縮寫詞彙正規化：把各種大小寫寫法統一成標準寫法。
     * 比對時大小寫不敏感。
     */
    termMap: {
      vpn: 'VPN',
      ip: 'IP',
      dns: 'DNS',
      dhcp: 'DHCP',
      ap: 'AP',
      poe: 'PoE',
      nas: 'NAS',
      ups: 'UPS',
      wifi: 'Wi-Fi',
      'wi-fi': 'Wi-Fi',
      // 常見 IT 名詞標準化（大小寫不敏感，以詞邊界比對）
      fortigate: 'FortiGate',
      m365: 'Microsoft 365',
      ad: 'AD',
    },

    /**
     * 半形 → 全形標點對照（用於中文情境統一標點）。
     * 只在「前一個字元是中文」時才轉換（避免破壞英文 / 數字）。
     */
    punctuationMap: {
      ',': '，',
      '.': '。',
      ';': '；',
      ':': '：',
      '!': '！',
      '?': '？',
      '(': '（',
      ')': '）',
    },

    /** 條列符號 */
    bullet: '• ',

    /**
     * 條列輸出時，項目之間是否插入空行（對應需求範例的效果）。
     */
    blankLineBetweenItems: true,

    /**
     * 句子切分用的中文連接 / 結束線索：當一行內含多個動作時，
     * 會嘗試在這些詞前後切行。
     */
    splitHints: ['然後', '接著', '之後', '再', '並', '；', '。'],
  };
})();
