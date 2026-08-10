/**
 * editor-probe-bridge.js
 * 在 HaloPSA 的 MAIN world 執行，回答兩個 content script（isolated world）problem：
 *
 *  1. 這個編輯器實際是哪一套？富文字編輯器的實例物件只存在 MAIN world，
 *     isolated world 看得到 DOM 但看不到 window.FroalaEditor / el.ckeditorInstance。
 *  2. 如果 isolated world 的「改 innerHTML + 派發 input」沒有讓 Halo 存檔，
 *     改用編輯器自己的 API（froala.html.set / ckeditor.setData / tinymce.setContent）會不會成功。
 *
 * 只在收到明確請求時動作，載入本身不改變任何頁面行為。
 * 不讀取、不外送任何權杖或工單內容 —— 回傳的只有偵測結果與呼叫端自己送進來的 HTML。
 *
 * 目標元素的傳遞方式：isolated world 先在元素上標記 data-hpx-probe="1"，
 * 這裡再用 querySelector 撈回來（兩個 world 共用同一份 DOM）。
 */
(function () {
  'use strict';
  const REQUEST_EVENT = 'hpx:editor:probe';
  const RESULT_EVENT = 'hpx:editor:probe-result';
  const TARGET_ATTR = 'data-hpx-probe';

  function respond(requestId, payload) {
    document.dispatchEvent(
      new CustomEvent(RESULT_EVENT, {
        detail: Object.assign({ requestId: requestId }, payload),
      })
    );
  }

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  /** 找 Froala 實例：優先用 jQuery data，其次掃 FroalaEditor.INSTANCES。 */
  function froalaInstance(el) {
    const box = safe(function () {
      return el.closest ? el.closest('.fr-box') : null;
    }, null);

    let inst = null;
    if (window.jQuery && box) {
      inst = safe(function () {
        return window.jQuery(box).data('froala.editor') || null;
      }, null);
    }
    if (!inst && window.FroalaEditor && window.FroalaEditor.INSTANCES) {
      inst = safe(function () {
        return (
          window.FroalaEditor.INSTANCES.filter(function (candidate) {
            if (!candidate) return false;
            const node = candidate.el || (candidate.$el && candidate.$el[0]);
            return node === el || (box && node === box) || (node && node.contains && node.contains(el));
          })[0] || null
        );
      }, null);
    }
    return { box: box, instance: inst };
  }

  function tinymceInstance(el) {
    if (!window.tinymce || !window.tinymce.editors) return null;
    return safe(function () {
      return (
        window.tinymce.editors.filter(function (ed) {
          const body = ed && ed.getBody && ed.getBody();
          const container = ed && ed.getContainer && ed.getContainer();
          return body === el || (container && container.contains && container.contains(el));
        })[0] || null
      );
    }, null);
  }

  /** 偵測目前掛在這個元素上的編輯器 / 框架，以及有沒有可用的寫入 API。 */
  function detect(el) {
    const fr = froalaInstance(el);
    const ck = safe(function () {
      return el.ckeditorInstance || null;
    }, null);
    const tiny = tinymceInstance(el);

    return {
      element: {
        tag: el.tagName ? el.tagName.toLowerCase() : '',
        className: String(el.className || '').slice(0, 300),
        contenteditable: safe(function () {
          return el.getAttribute('contenteditable');
        }, null),
        htmlLength: safe(function () {
          return (el.innerHTML || '').length;
        }, 0),
      },
      froala: {
        globalPresent: !!window.FroalaEditor,
        version: safe(function () {
          return window.FroalaEditor && window.FroalaEditor.VERSION;
        }, null),
        boxFound: !!fr.box,
        instanceFound: !!fr.instance,
        hasSetter: !!(fr.instance && fr.instance.html && typeof fr.instance.html.set === 'function'),
      },
      ckeditor5: {
        instanceFound: !!ck,
        hasSetter: !!(ck && typeof ck.setData === 'function'),
      },
      tinymce: {
        globalPresent: !!window.tinymce,
        instanceFound: !!tiny,
        hasSetter: !!(tiny && typeof tiny.setContent === 'function'),
      },
      summernote: {
        present: safe(function () {
          return !!(window.jQuery && el.closest && el.closest('.note-editor'));
        }, false),
      },
      quill: {
        present: !!window.Quill,
      },
      angular: {
        // Angular 2+：元素上會掛 __ngContext__；AngularJS 1.x：window.angular 存在
        modernContext: safe(function () {
          return Object.getOwnPropertyNames(el).some(function (name) {
            return name.indexOf('__ngContext__') === 0;
          });
        }, false),
        globalNg: !!window.ng,
        legacyAngular: !!window.angular,
        ngModelController: safe(function () {
          if (!window.angular || !window.angular.element) return false;
          return !!window.angular.element(el).controller('ngModel');
        }, false),
      },
      jquery: {
        present: !!window.jQuery,
        version: safe(function () {
          return window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery;
        }, null),
      },
    };
  }

  /** 用編輯器自己的 API 寫入（Plan B 驗證）。回傳實際用了哪一條路徑。 */
  function frameworkWrite(el, html) {
    const fr = froalaInstance(el);
    if (fr.instance && fr.instance.html && typeof fr.instance.html.set === 'function') {
      fr.instance.html.set(html);
      if (typeof fr.instance.undo === 'object' && typeof fr.instance.undo.saveStep === 'function') {
        fr.instance.undo.saveStep();
      }
      if (fr.instance.events && typeof fr.instance.events.trigger === 'function') {
        fr.instance.events.trigger('contentChanged');
      }
      return { ok: true, via: 'froala.html.set' };
    }

    const ck = safe(function () {
      return el.ckeditorInstance || null;
    }, null);
    if (ck && typeof ck.setData === 'function') {
      ck.setData(html);
      return { ok: true, via: 'ckeditor5.setData' };
    }

    const tiny = tinymceInstance(el);
    if (tiny && typeof tiny.setContent === 'function') {
      tiny.setContent(html);
      if (typeof tiny.fire === 'function') tiny.fire('change');
      return { ok: true, via: 'tinymce.setContent' };
    }

    if (window.angular && window.angular.element) {
      const ctrl = safe(function () {
        return window.angular.element(el).controller('ngModel');
      }, null);
      if (ctrl && typeof ctrl.$setViewValue === 'function') {
        ctrl.$setViewValue(html);
        ctrl.$render();
        safe(function () {
          window.angular.element(el).scope().$applyAsync();
        }, null);
        return { ok: true, via: 'angularjs.ngModel.$setViewValue' };
      }
    }

    return { ok: false, via: '', reason: '找不到可用的編輯器寫入 API（需改用 isolated world 的 innerHTML 路徑）' };
  }

  document.addEventListener(REQUEST_EVENT, function (request) {
    const detail = request.detail || {};
    const requestId = String(detail.requestId || '');
    if (!requestId) return;

    try {
      const el = document.querySelector('[' + TARGET_ATTR + '="1"]');
      if (!el) {
        respond(requestId, { ok: false, error: '找不到標記的目標編輯器元素。' });
        return;
      }

      if (detail.op === 'detect') {
        respond(requestId, { ok: true, detection: detect(el) });
        return;
      }

      if (detail.op === 'write') {
        const result = frameworkWrite(el, String(detail.html == null ? '' : detail.html));
        respond(requestId, {
          ok: result.ok,
          via: result.via,
          error: result.ok ? '' : result.reason,
        });
        return;
      }

      respond(requestId, { ok: false, error: '未知的操作：' + String(detail.op) });
    } catch (error) {
      respond(requestId, {
        ok: false,
        error: error && error.message ? error.message : 'MAIN world 偵測失敗。',
      });
    }
  });
})();
