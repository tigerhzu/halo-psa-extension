/**
 * toast.js
 * 輕量提示訊息（右下角，數秒後自動消失）。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  let container = null;

  function ensureContainer() {
    if (container && document.body.contains(container)) return container;
    container = document.createElement('div');
    container.className = 'hpx-toast-container';
    document.body.appendChild(container);
    return container;
  }

  const Toast = {
    /**
     * @param {string} message
     * @param {Object} [opts]
     * @param {string} [opts.type] 'info' | 'success' | 'error'
     * @param {number} [opts.duration] 毫秒，預設 2500
     */
    show: function (message, opts) {
      opts = opts || {};
      const el = document.createElement('div');
      el.className = 'hpx-toast hpx-toast--' + (opts.type || 'info');
      el.textContent = message;
      ensureContainer().appendChild(el);

      // 進場動畫
      requestAnimationFrame(function () {
        el.classList.add('hpx-toast--visible');
      });

      const duration = opts.duration || 2500;
      setTimeout(function () {
        el.classList.remove('hpx-toast--visible');
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 250);
      }, duration);
    },
  };

  NS.ui.toast = Toast;
})();
