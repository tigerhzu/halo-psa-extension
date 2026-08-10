/**
 * preview-modal.js
 * 預覽視窗（功能2 AI 潤稿 與 功能3 整理格式 共用）。
 *
 * 呈現「原文（唯讀）」+「處理後結果（可編輯，使用者可微調）」，
 * 使用者按「確認覆蓋」才會套用。回傳 Promise：
 *  - resolve(finalText)：使用者確認，帶回（可能被微調過的）結果文字
 *  - resolve(null)：使用者取消
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ── 差異計算（純本地，給「整理格式」預覽用）──

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * 把字串切成 diff 的最小單位：
   *   英數字串（整段）/ 單個中日韓字 / 連續空白（含換行）/ 其它單一字元。
   * 這樣補空格、英文縮寫替換、條列化都能呈現成易讀的增刪。
   */
  function tokenize(s) {
    const re = /[A-Za-z0-9]+|[一-鿿]|\s+|[^\sA-Za-z0-9一-鿿]/g;
    return String(s).match(re) || [];
  }

  /**
   * 以 LCS 計算 token 級差異，輸出 HTML：
   *   相同 → 原樣；新增 → .hpx-diff-ins；刪除 → .hpx-diff-del。
   * 容器使用 white-space: pre-wrap，故空白與換行會原樣保留。
   */
  function buildDiffHtml(original, result) {
    const a = tokenize(original);
    const b = tokenize(result);

    // 規模保護：避免極端長文造成 O(n*m) DP 過大
    if (a.length * b.length > 400000) {
      return null;
    }

    const n = a.length;
    const m = b.length;
    // LCS 長度表
    const dp = [];
    for (let i = 0; i <= n; i++) {
      dp.push(new Array(m + 1).fill(0));
    }
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    let out = '';
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        out += escapeHtml(a[i]);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        out += '<span class="hpx-diff-del">' + escapeHtml(a[i]) + '</span>';
        i++;
      } else {
        out += '<span class="hpx-diff-ins">' + escapeHtml(b[j]) + '</span>';
        j++;
      }
    }
    while (i < n) {
      out += '<span class="hpx-diff-del">' + escapeHtml(a[i]) + '</span>';
      i++;
    }
    while (j < m) {
      out += '<span class="hpx-diff-ins">' + escapeHtml(b[j]) + '</span>';
      j++;
    }
    return out;
  }

  const PreviewModal = {
    /**
     * @param {Object} opts
     * @param {string} opts.title      視窗標題
     * @param {string} opts.original   原文
     * @param {string} opts.result     處理後結果（預設帶入 textarea）
     * @param {string} [opts.note]     額外提示（例如 Stub 說明）
     * @param {boolean} [opts.showDiff] 是否顯示「修改前 → 修改後」差異面板（整理格式用）
     * @returns {Promise<string|null>}
     */
    open: function (opts) {
      return new Promise(function (resolve) {
        const overlay = el('div', 'hpx-modal-overlay');
        const modal = el('div', 'hpx-modal');

        // 標題列
        const header = el('div', 'hpx-modal__header');
        header.appendChild(el('span', 'hpx-modal__title', opts.title || '預覽'));
        const closeBtn = el('button', 'hpx-modal__close', '✕');
        header.appendChild(closeBtn);
        modal.appendChild(header);

        // 提示
        if (opts.note) {
          modal.appendChild(el('div', 'hpx-modal__note', opts.note));
        }

        // 差異面板（修改前 → 修改後），目前供「整理格式」使用
        if (opts.showDiff) {
          const diffHtml = buildDiffHtml(opts.original || '', opts.result || '');
          const diffWrap = el('div', 'hpx-modal__diff');
          const label = el('div', 'hpx-modal__col-label', '修改前後差異');
          const legend = el('span', 'hpx-modal__diff-legend');
          legend.innerHTML =
            '<span class="hpx-diff-del">刪除</span> ' +
            '<span class="hpx-diff-ins">新增</span>';
          label.appendChild(legend);
          diffWrap.appendChild(label);

          const diffBox = el('div', 'hpx-modal__diff-box');
          if (diffHtml == null) {
            diffBox.textContent = '（內容過長，略過差異標示；仍可比對左右兩欄）';
          } else if (diffHtml === escapeHtml(opts.original || '')) {
            diffBox.textContent = '（沒有偵測到任何變更）';
          } else {
            diffBox.innerHTML = diffHtml;
          }
          diffWrap.appendChild(diffBox);
          modal.appendChild(diffWrap);
        }

        // 內容：左原文（唯讀）/ 右結果（可編輯）
        const body = el('div', 'hpx-modal__body');

        const leftCol = el('div', 'hpx-modal__col');
        leftCol.appendChild(el('div', 'hpx-modal__col-label', '原文'));
        const originalBox = el('textarea', 'hpx-modal__textarea hpx-modal__textarea--readonly');
        originalBox.value = opts.original || '';
        originalBox.readOnly = true;
        leftCol.appendChild(originalBox);

        const rightCol = el('div', 'hpx-modal__col');
        rightCol.appendChild(el('div', 'hpx-modal__col-label', '處理後'));
        const resultBox = el('textarea', 'hpx-modal__textarea');
        resultBox.value = opts.result || '';
        rightCol.appendChild(resultBox);

        body.appendChild(leftCol);
        body.appendChild(rightCol);
        modal.appendChild(body);

        // 動作列
        const footer = el('div', 'hpx-modal__footer');
        const cancelBtn = el('button', 'hpx-btn hpx-btn--secondary', '取消');
        const confirmBtn = el('button', 'hpx-btn hpx-btn--primary', '確認');
        footer.appendChild(cancelBtn);
        footer.appendChild(confirmBtn);
        modal.appendChild(footer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // 聚焦結果框
        setTimeout(function () {
          resultBox.focus();
        }, 0);

        function cleanup() {
          document.removeEventListener('keydown', onKey);
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }
        function done(value) {
          cleanup();
          resolve(value);
        }
        function onKey(e) {
          if (e.key === 'Escape') done(null);
        }

        closeBtn.addEventListener('click', function () {
          done(null);
        });
        cancelBtn.addEventListener('click', function () {
          done(null);
        });
        confirmBtn.addEventListener('click', function () {
          done(resultBox.value);
        });
        overlay.addEventListener('click', function (e) {
          if (e.target === overlay) done(null);
        });
        document.addEventListener('keydown', onKey);
      });
    },
  };

  NS.ui.previewModal = PreviewModal;
})();
