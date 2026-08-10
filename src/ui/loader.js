/**
 * loader.js
 * AI / 整理格式 執行中的視覺回饋：右下角一隻小老虎 🐯 + 文字。
 *
 * 用法：
 *   NS.ui.loader.show('正在轉換成客戶溝通模式…');  // 開始（持續顯示、老虎擺動）
 *   NS.ui.loader.done();                          // 完成 → 顯示「🐯 已完成」，約 1 秒後自動消失
 *   NS.ui.loader.hide();                          // 立即隱藏（例如發生錯誤）
 *
 * 全域單一實例（同時間只會有一個 AI 動作在跑）。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  const DONE_VISIBLE_MS = 1000; // 「已完成」停留時間
  const FADE_MS = 220; // 淡出時間（需與 CSS transition 一致）

  let el = null;
  let tigerEl = null;
  let textEl = null;
  let hideTimer = null;
  let removeTimer = null;

  function ensure() {
    if (el && document.body.contains(el)) return el;
    el = document.createElement('div');
    el.className = 'hpx-loader';

    tigerEl = document.createElement('span');
    tigerEl.className = 'hpx-loader__tiger';
    tigerEl.textContent = '🐯';

    textEl = document.createElement('span');
    textEl.className = 'hpx-loader__text';

    el.appendChild(tigerEl);
    el.appendChild(textEl);
    document.body.appendChild(el);
    return el;
  }

  function clearTimers() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (removeTimer) {
      clearTimeout(removeTimer);
      removeTimer = null;
    }
  }

  const Loader = {
    /** 開始顯示 loading（持續到 done / hide）。 */
    show: function (text) {
      clearTimers();
      ensure();
      el.classList.remove('hpx-loader--done');
      textEl.textContent = text || '正在處理中…';
      // 觸發進場動畫
      requestAnimationFrame(function () {
        el.classList.add('hpx-loader--visible');
      });
    },

    /** 完成：顯示「已完成」，停留約 1 秒後自動淡出。 */
    done: function (text) {
      clearTimers();
      ensure();
      el.classList.add('hpx-loader--visible', 'hpx-loader--done');
      textEl.textContent = text || '已完成';
      hideTimer = setTimeout(function () {
        Loader.hide();
      }, DONE_VISIBLE_MS);
    },

    /** 立即隱藏並移除。 */
    hide: function () {
      clearTimers();
      if (!el) return;
      el.classList.remove('hpx-loader--visible');
      const node = el;
      removeTimer = setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
        if (node === el) {
          el = null;
          tigerEl = null;
          textEl = null;
        }
      }, FADE_MS);
    },
  };

  NS.ui.loader = Loader;
})();
