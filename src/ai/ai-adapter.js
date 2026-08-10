/**
 * ai-adapter.js（content script 端）
 *
 * AI 接口。實際的 Azure OpenAI / Gemini 呼叫在 background service worker
 *（見 src/background/service-worker.js）：
 *  - content script 直接 fetch 外部 API 會踩 CORS，且金鑰會暴露在頁面環境；
 *  - 因此這裡只負責把請求透過 chrome.runtime.sendMessage 轉發給背景，再把結果回傳上層。
 *
 * 上層（ai-rewrite.js）只需要：呼叫 request() 取得 Promise，介面保持穩定。
 *
 * 設定（API Key / 模型 / 測試模式）由設定頁寫入 chrome.storage，背景讀取，這裡不碰金鑰。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  // AI 請求可能因網路或模型負載而久候；設一個逾時上限，
  // 避免背景服務無回應時，前端 UI 永遠卡在「處理中…」。
  const REQUEST_TIMEOUT_MS = 30000;

  const AiAdapter = {
    /**
     * 請求 AI 處理文字（透過背景服務轉發，見檔頭說明）。
     * @param {Object} req
     * @param {string} req.action  'improve_tone' | 'professional' | 'translate'
     * @param {string} req.text
     * @param {string} [req.targetLang]  'en' | 'zh'
     * @returns {Promise<{text: string, stub: boolean, provider: string, model?: string, deployment?: string}>}
     */
    request: function (req) {
      return new Promise(function (resolve, reject) {
        if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
          reject(new Error('擴充套件背景服務無法連線（chrome.runtime 不可用）'));
          return;
        }

        let settled = false;
        const finish = function (fn, arg) {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          fn(arg);
        };

        const timer = setTimeout(function () {
          finish(reject, new Error('AI 請求逾時（超過 ' + REQUEST_TIMEOUT_MS / 1000 + ' 秒）'));
        }, REQUEST_TIMEOUT_MS);

        try {
          chrome.runtime.sendMessage(
            { type: 'HPX_AI_REQUEST', payload: req },
            function (response) {
              if (settled) return;

              const lastErr = chrome.runtime.lastError;
              if (lastErr) {
                finish(reject, new Error(lastErr.message || '背景服務無回應'));
                return;
              }
              if (!response) {
                finish(reject, new Error('背景服務無回應'));
                return;
              }
              if (response.ok) {
                finish(resolve, {
                  text: response.text,
                  stub: !!response.stub,
                  provider: response.provider || '',
                  deployment: response.deployment || '',
                  model: response.model || '',
                });
              } else {
                finish(reject, new Error(response.error || 'AI 請求失敗'));
              }
            }
          );
        } catch (e) {
          finish(reject, e);
        }
      });
    },
  };

  NS.ai.adapter = AiAdapter;
})();
