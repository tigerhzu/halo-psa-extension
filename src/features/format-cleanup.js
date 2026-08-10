/**
 * format-cleanup.js
 * 功能3：整理格式（本地規則，真實實作 —— 不需 AI）。
 *
 * 管線（pure functions，依序套用）：
 *  1. normalizeLines     去除多餘空白、切出非空行
 *  2. applyTypoMap       常見錯字 / 用語統一（如 重開→重新啟動、測試vpn→測試 VPN 連線）
 *  3. applyTermMap       英文縮寫 / IT 名詞正規化（vpn→VPN、fortigate→FortiGate、m365→Microsoft 365）
 *  3.5 addCJKSpacing     中文與英文 / 數字之間自動補空格（今天dinner→今天 dinner、完成3台→完成 3 台）
 *  4. normalizePunctuation 中文情境半形標點→全形
 *  5. toBulletList       每行加 • 前綴、（可選）項目間空行
 *
 * 範例：
 *   今天到現場檢查防火牆 / 重開設備 / 測試vpn / 目前正常
 * → • 到現場檢查防火牆（註：時間詞不自動刪，保留原意）
 *   • 重新啟動設備
 *   • 測試 VPN 連線
 *   • 目前運作正常
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  function rules() {
    return NS.config.formatRules;
  }

  /** 1. 切行 + 去除每行頭尾空白與既有條列符號 */
  function normalizeLines(text) {
    return String(text)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (line) {
        // 去掉既有的條列符號（• - * ·）與多餘空白
        return line.replace(/^[\s]*[•\-\*·]\s*/, '').trim();
      })
      .filter(function (line) {
        return line.length > 0;
      });
  }

  /** 2. 套用錯字 / 用語對照（長詞優先，避免子字串先被替換） */
  function applyTypoMap(line) {
    const map = rules().typoMap;
    const keys = Object.keys(map).sort(function (a, b) {
      return b.length - a.length;
    });
    let out = line;
    keys.forEach(function (k) {
      out = out.split(k).join(map[k]);
    });
    return out;
  }

  /** 3. 英文縮寫正規化（大小寫不敏感、以詞邊界比對） */
  function applyTermMap(line) {
    const map = rules().termMap;
    let out = line;
    Object.keys(map).forEach(function (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(^|[^A-Za-z0-9])(' + escaped + ')(?![A-Za-z0-9])', 'gi');
      out = out.replace(re, function (m, pre) {
        return pre + map[term];
      });
    });
    return out;
  }

  /**
   * 3.5 中文與英文 / 數字之間自動補空格（CJK ↔ 英數）。
   * 在 applyTermMap 之後執行，這樣 VPN、FortiGate 等已正規化的詞也會正確補空格。
   *   今天dinner好吃  → 今天 dinner 好吃
   *   完成3台設備更新 → 完成 3 台設備更新
   *   VPN測試正常     → VPN 測試正常
   */
  function addCJKSpacing(line) {
    return String(line)
      .replace(/([一-鿿])([A-Za-z0-9])/g, '$1 $2') // 中→英數
      .replace(/([A-Za-z0-9])([一-鿿])/g, '$1 $2'); // 英數→中
  }

  /** 4. 中文情境半形標點 → 全形（前一字為中文時才轉） */
  function normalizePunctuation(line) {
    const map = rules().punctuationMap;
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const prev = out.length ? out[out.length - 1] : '';
      if (map[ch] && /[一-鿿]/.test(prev)) {
        out += map[ch];
      } else {
        out += ch;
      }
    }
    // 收斂多重空白
    return out.replace(/[ \t]{2,}/g, ' ').trim();
  }

  /** 5. 條列化 */
  function toBulletList(lines) {
    const r = rules();
    const items = lines.map(function (line) {
      return r.bullet + line;
    });
    return items.join(r.blankLineBetweenItems ? '\n\n' : '\n');
  }

  const FormatCleanup = {
    /** 對外主函式：輸入原文，回傳整理後文字 */
    clean: function (text) {
      let lines = normalizeLines(text);
      lines = lines
        .map(applyTypoMap)
        .map(applyTermMap)
        .map(addCJKSpacing)
        .map(normalizePunctuation);
      // 去除處理後可能變空的行
      lines = lines.filter(function (l) {
        return l.length > 0;
      });
      if (lines.length === 0) return '';
      return toBulletList(lines);
    },

    // 匯出個別步驟，方便單元測試 / 之後擴充
    _normalizeLines: normalizeLines,
    _applyTypoMap: applyTypoMap,
    _applyTermMap: applyTermMap,
    _addCJKSpacing: addCJKSpacing,
    _normalizePunctuation: normalizePunctuation,
  };

  NS.features.formatCleanup = FormatCleanup;
})();
