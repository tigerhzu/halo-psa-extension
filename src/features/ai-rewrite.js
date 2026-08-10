/**
 * ai-rewrite.js
 * 功能2：AI 潤稿（改善語氣 / 專業化 / 翻譯成英文 / 翻譯成中文）。
 *
 * 流程：讀取編輯器文字 → 呼叫 ai-adapter → 預覽 → 確認後覆蓋。
 * AI 可使用 Azure OpenAI、Gemini 或本地 Stub；本模組只依賴 adapter 的統一回傳格式。
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
      const text = adapter.getText(editorEl);

      if (!text.trim()) {
        NS.ui.toast.show('編輯器內沒有文字可以處理', { type: 'error' });
        return;
      }

      // 視覺回饋：右下角小老虎 loading
      NS.ui.loader.show('Tiger is working…');

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
          // result: { text, stub, provider, model?, deployment? }
          var note;
          if (result.stub) {
            note = '⚠ 測試模式 / 尚未設定 API Key —— 這是示意文字，未呼叫真實 AI。請至擴充套件設定頁填入 API Key。';
          } else if (result.provider === 'azure-deepseek') {
            note = 'Azure OpenAI（' + (result.deployment || '目前部署') + '）產生，可在右側微調後再套用。';
          } else {
            note = 'Gemini（' + (result.model || '') + '）產生，可在右側微調後再套用。';
          }
          return NS.ui.previewModal.open({
            title: 'AI 潤稿：' + def.title,
            original: text,
            result: result.text,
            note: note,
          });
        })
        .then(function (finalText) {
          if (finalText == null) return; // 取消
          adapter.setText(editorEl, finalText);
          NS.ui.toast.show('已套用', { type: 'success' });
        })
        .catch(function (err) {
          NS.ui.loader.hide();
          NS.warn('AI 潤稿失敗', err);
          NS.ui.toast.show('處理失敗：' + err.message, { type: 'error' });
        });
    },
  };

  NS.features.aiRewrite = AiRewrite;
})();
