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
