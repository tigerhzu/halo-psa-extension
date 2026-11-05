/**
 * preview-modal.js
 * AI 潤稿預覽視窗。
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

  const PreviewModal = {
    /**
     * @param {Object} opts
     * @param {string} opts.title      視窗標題
     * @param {string} opts.original   原文
     * @param {string} opts.result     處理後結果（預設帶入 textarea）
     * @param {string} [opts.note]     額外提示（例如 Stub 說明）
     * @returns {Promise<string|null>}
     */
    open: function (opts) {
      return new Promise(function (resolve) {
        const overlay = el('div', 'hpx-modal-overlay');
        const modal = el('div', 'hpx-modal');
        const previousFocus = document.activeElement;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', opts.title || '檢視 AI 草稿');

        // 標題列
        const header = el('div', 'hpx-modal__header');
        header.appendChild(el('span', 'hpx-modal__title', opts.title || '檢視 AI 草稿'));
        const closeBtn = el('button', 'hpx-modal__close', '✕');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', '關閉預覽');
        header.appendChild(closeBtn);
        modal.appendChild(header);

        // 提示
        if (opts.note) {
          modal.appendChild(el('div', 'hpx-modal__note', opts.note));
        }
        if (opts.metrics) {
          const m = opts.metrics;
          const card = el('section', 'hpx-modal__metrics');
          card.appendChild(el('strong', '', 'AI 效能'));
          function number(value, digits, suffix) {
            return typeof value === 'number' && Number.isFinite(value) && value >= 0
              ? value.toFixed(digits) + suffix : 'Provider 未回報';
          }
          const details = m.stub ? '示意模式，未呼叫 AI，不提供模型效能數據。' :
            'API 耗時：' + number(m.elapsedMs == null ? null : m.elapsedMs / 1000, 1, ' 秒') +
            '；全程平均速度：' + number(m.effectiveOutputTokensPerSecond, 1, ' tokens/s') +
            '；輸出 tokens：' + number(m.completionTokens, 0, '') +
            '；推理 tokens：' + number(m.reasoningTokens, 0, '');
          card.appendChild(el('div', 'hpx-modal__metrics-values',
            '本次處理：' + number(m.totalElapsedMs / 1000, 1, ' 秒') + '；' + details));
          if (!m.stub && typeof m.requestMaxTokens === 'number') {
            card.appendChild(el('div', 'hpx-modal__metrics-values',
              '等待回應標頭：' + number(m.responseHeadersMs / 1000, 1, ' 秒') +
              '；讀取完整回應：' + number(m.responseBodyMs / 1000, 1, ' 秒') +
              '；輸出上限：' + number(m.requestMaxTokens, 0, ' tokens') +
              '；請求模式：' + (m.requestedThinkingMode === 'disabled' ? '關閉 Thinking' : '服務預設')));
          }
          if (!m.stub) card.appendChild(el('div', 'hpx-modal__metrics-help',
            '全程平均包含等待與傳輸，不代表模型生成速度。回應標頭時間不是首字延遲；推理用量未回報時，無法確認服務是否採用關閉 Thinking。'));
          modal.appendChild(card);
        }

        // 內容：左原文（唯讀）/ 右結果（可編輯）
        const body = el('div', 'hpx-modal__body');

        const leftCol = el('div', 'hpx-modal__col');
        leftCol.appendChild(el('div', 'hpx-modal__col-label', '原文'));
        const originalBox = el('textarea', 'hpx-modal__textarea hpx-modal__textarea--readonly');
        originalBox.value = opts.original || '';
        originalBox.readOnly = true;
        originalBox.setAttribute('aria-label', '原始內容，唯讀');
        leftCol.appendChild(originalBox);

        const rightCol = el('div', 'hpx-modal__col');
        rightCol.appendChild(el('div', 'hpx-modal__col-label', '草稿'));
        const resultBox = el('textarea', 'hpx-modal__textarea');
        resultBox.value = opts.result || '';
        resultBox.setAttribute('aria-label', 'AI 草稿，可編輯');
        rightCol.appendChild(resultBox);

        body.appendChild(leftCol);
        body.appendChild(rightCol);
        modal.appendChild(body);

        // 動作列
        const footer = el('div', 'hpx-modal__footer');
        const cancelBtn = el('button', 'hpx-btn hpx-btn--secondary', '保留原文');
        const confirmBtn = el('button', 'hpx-btn hpx-btn--primary', '套用草稿');
        cancelBtn.type = 'button';
        confirmBtn.type = 'button';
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
          if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        }
        function done(value) {
          cleanup();
          resolve(value);
        }
        function onKey(e) {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            done(null);
          }
          if (e.key === 'Tab') {
            const items = [closeBtn, originalBox, resultBox, cancelBtn, confirmBtn];
            const current = items.indexOf(document.activeElement);
            if (e.shiftKey && current <= 0) { e.preventDefault(); confirmBtn.focus(); }
            else if (!e.shiftKey && (current === items.length - 1 || current < 0)) { e.preventDefault(); closeBtn.focus(); }
          }
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
