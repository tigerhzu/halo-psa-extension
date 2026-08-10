/**
 * templates.js
 * 功能4：快速範本。點擊後於游標處插入對應範本內容（無游標則附加到結尾）。
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  const Templates = {
    /** 取得所有範本定義 */
    list: function () {
      return NS.config.templates;
    },

    /**
     * 插入指定 id 的範本到編輯器。
     * @param {string} id
     * @param {Element} editorEl
     */
    insert: function (id, editorEl) {
      const tpl = NS.config.templates.find(function (t) {
        return t.id === id;
      });
      if (!tpl) return;

      // 若編輯器已有內容，於範本前補一個換行，避免黏在一起
      const existing = NS.core.adapter.getText(editorEl);
      const prefix = existing && existing.trim().length ? '\n' : '';

      NS.core.adapter.insertText(editorEl, prefix + tpl.content);
      NS.ui.toast.show('已插入範本：' + tpl.label, { type: 'success' });
    },
  };

  NS.features.templates = Templates;
})();
