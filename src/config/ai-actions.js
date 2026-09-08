/**
 * ai-actions.js
 * AI 潤稿動作定義。原本寫死在 features/ai-rewrite.js 裡，
 * 現在 HaloPSA 頁面工具列與獨立編輯視窗兩邊都要用同一份，
 * 抽到設定層避免兩邊的按鈕清單各自漂移。
 *
 * key 會直接送到背景服務當 action 用（translate_* 例外，改送 action: 'translate'
 * 加上 targetLang），對應 src/ai/prompt-templates.js 的 buildPrompt()。
 * 新增動作時必須同步在那裡加上 prompt，否則背景會拿不到對應樣板。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  NS.config.aiActions = {
    improve_tone: {
      label: '回覆客戶',
      title: '回覆客戶（禮貌回覆）',
      loading: '正在轉換成客戶溝通模式…',
    },
    professional: {
      label: '工單分析',
      title: '工單分析（處理紀錄）',
      loading: '正在整理工單內容…',
    },
    translate_en: {
      label: '翻譯成英文',
      title: '翻譯成英文',
      action: 'translate',
      targetLang: 'en',
      loading: '正在翻譯內容…',
    },
    translate_zh: {
      label: '翻譯成中文',
      title: '翻譯成中文',
      action: 'translate',
      targetLang: 'zh',
      loading: '正在翻譯內容…',
    },
    first_contact: {
      label: 'First Contact',
      title: 'First Contact（首次回覆）',
      loading: '正在準備首次回覆…',
    },
  };
})();
