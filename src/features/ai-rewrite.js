/**
 * ai-rewrite.js
 * 功能2：AI 潤稿（改善語氣 / 專業化 / 翻譯成英文 / 翻譯成中文）。
 *
 * 流程：讀取編輯器文字 → 呼叫 ai-adapter → 預覽 → 確認後覆蓋。
 * AI 可使用 Azure OpenAI、Ornith 或本地 Stub；本模組只依賴 adapter 的統一回傳格式。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  /**
   * 動作定義：對應工具列按鈕。
   * 唯一來源是 src/config/ai-actions.js —— 獨立編輯視窗用的是同一份。
   */
  const ACTIONS = NS.config.aiActions;

  const AiRewrite = {
    ACTIONS: ACTIONS,

    /**
     * 執行某個 AI 動作。
     * @param {string} actionKey  ACTIONS 的 key
     * @param {Element} editorEl  目標編輯器元素
     */
    run: function (actionKey, editorEl) {
      const def = ACTIONS[actionKey];
      if (!def) return;

      const adapter = NS.core.adapter;
      const imageTools = NS.core.imagePlaceholder;
      const safeSourceHtml = NS.core.htmlSanitizer.sanitize(adapter.getHtml(editorEl));
      const imageMask = imageTools.maskForAi(safeSourceHtml);
      const text = imageMask.count > 0 ? imageMask.text : adapter.getText(editorEl);

      if (!text.trim()) {
        NS.ui.toast.show('編輯器內沒有文字可以處理', { type: 'error' });
        return;
      }

      // 視覺回饋：右下角小老虎 loading
      if (AiRewrite.busy) return;
      AiRewrite.busy = true;
      NS.ui.loader.show('等待 AI 回覆…');

      const req = {
        action: def.action || actionKey, // translate_* → 'translate'
        text: text,
        targetLang: def.targetLang,
      };

      NS.ai.adapter
        .request(req)
        .then(function (result) {
          // 收到結果 → 顯示「已完成」並自動消失
          NS.ui.loader.done();
          AiRewrite.busy = false;
          // result: { text, stub, provider, model?, deployment? }
          var note;
          if (result.stub) {
            note = '⚠ 尚未設定 API Key —— 這是示意文字，未呼叫真實 AI。請至擴充套件設定頁填入 API Key。';
          } else if (result.provider === 'azure-deepseek') {
            note = 'Azure OpenAI（' + (result.deployment || '目前部署') + '）產生，可在右側微調後再套用。';
          } else if (result.provider === 'ornith') {
            note = 'Local Ornith（' + (result.model || '目前模型') + '）產生，可在右側微調後再套用。';
          } else {
            note = 'AI（' + (result.model || '') + '）產生，可在右側微調後再套用。';
          }
          if (imageMask.count > 0) {
            note += ' 已遮罩 ' + imageMask.count + ' 張圖片；圖片內容不會送給 AI，套用時會自動還原。';
          }
          return NS.ui.previewModal.open({
            title: 'AI 潤稿：' + def.title,
            original: imageTools.toDisplayText(text, imageMask.masks),
            result: imageTools.toDisplayText(result.text, imageMask.masks),
            note: note,
            metrics: result.metrics,
          });
        })
        .then(function (finalText) {
          if (finalText == null) return; // 取消
          const isProfessional = actionKey === 'professional' && NS.features.ticketRichFormat;
          if (isProfessional || imageMask.count > 0) {
            let html = isProfessional
              ? NS.features.ticketRichFormat.toHtml(finalText)
              : imageTools.plainTextToHtml(finalText);
            if (imageMask.count > 0) {
              html = imageTools.restoreAiMasks(html, imageMask.masks).html;
            }
            const clean = NS.core.htmlSanitizer.sanitize(html);
            return adapter.setHtmlReliable(editorEl, clean).then(function () {
              const message = isProfessional
                ? '已套用工單條列與語意顏色' + (imageMask.count ? '，圖片已保留' : '')
                : '已套用，圖片已保留';
              NS.ui.toast.show(message, { type: 'success' });
            });
          }
          adapter.setText(editorEl, finalText);
          NS.ui.toast.show('已套用', { type: 'success' });
        })
        .catch(function (err) {
          NS.ui.loader.hide();
          AiRewrite.busy = false;
          NS.warn('AI 潤稿失敗', err);
          NS.ui.toast.show('處理失敗：' + err.message, { type: 'error' });
        });
    },
  };

  NS.features.aiRewrite = AiRewrite;
})();
