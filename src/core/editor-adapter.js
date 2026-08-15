/**
 * editor-adapter.js
 * 編輯器讀寫抽象層。把「不同型態的編輯器」統一成一致的 get/set/insert 介面，
 * 讓上層功能（AI 潤稿、範本）不需要在意底層是 contenteditable、
 * iframe 還是 textarea。
 *
 * ── 覆蓋能否生效的關鍵 ──
 * HaloPSA 為 Angular SPA，編輯器內容通常綁定 ngModel / 編輯器內部狀態。
 * 直接改 DOM 後，必須派發 input / change / keyup 事件，框架才會同步並讓「儲存」帶到新內容。
 * 這是最大的整合風險點，請在實機驗證（見 README 的 inspect & tune）。
 */
(function () {
  'use strict';
  const NS = window.__HPX;
  const FRAMEWORK_WRITE_REQUEST = 'hpx:editor:write';
  const FRAMEWORK_WRITE_RESULT = 'hpx:editor:write-result';
  const FRAMEWORK_WRITE_ATTR = 'data-hpx-framework-write';
  let frameworkWriteSequence = 0;

  /** 判斷元素型態 */
  function getKind(el) {
    if (!el) return 'unknown';
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'textarea' || tag === 'input') return 'textarea';
    if (tag === 'iframe') return 'iframe';
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
      return 'contenteditable';
    }
    return 'contenteditable'; // 預設當作 contenteditable 處理
  }

  /** 取得 iframe 編輯器的 body（同源時可存取） */
  function getIframeBody(iframe) {
    try {
      const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      return doc ? doc.body : null;
    } catch (e) {
      NS.warn('無法存取 iframe 內容（可能跨域）', e);
      return null;
    }
  }

  /** 把純文字（含換行）轉成安全的 HTML（逐行包 <div>，空行用 <br>） */
  function textToHtml(text) {
    const escape = (s) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return String(text)
      .split('\n')
      .map((line) => (line.length ? '<div>' + escape(line) + '</div>' : '<div><br></div>'))
      .join('');
  }

  /**
   * 透過原生 prototype setter 寫入 textarea / input 的值。
   * 直接 el.value = x 會繞過框架掛在 setter 上的攔截，導致畫面變了但 model 沒變。
   *（time-adjuster 已驗證過這個寫法是必要的。）
   */
  function setTextareaValue(el, value) {
    const proto =
      el.tagName && el.tagName.toLowerCase() === 'textarea'
        ? window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement && window.HTMLInputElement.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  /** 派發必要事件，讓框架同步狀態 */
  function notifyChange(target) {
    if (!target) return;
    const opts = { bubbles: true, cancelable: true };
    try {
      target.dispatchEvent(new InputEvent('input', opts));
    } catch (e) {
      target.dispatchEvent(new Event('input', opts));
    }
    target.dispatchEvent(new Event('change', opts));
    try {
      target.dispatchEvent(new KeyboardEvent('keyup', opts));
    } catch (e) {
      /* 部分環境不支援 KeyboardEvent 建構子，可忽略 */
    }
  }

  function writeHtmlThroughFramework(el, html, op) {
    return new Promise(function (resolve) {
      if (!el || !document.contains(el)) {
        resolve({ ok: false, error: 'Target editor no longer exists.' });
        return;
      }

      frameworkWriteSequence += 1;
      const requestId = 'write-' + frameworkWriteSequence;
      let settled = false;

      function onResult(event) {
        const data = event.detail || {};
        if (data.requestId !== requestId || settled) return;
        settled = true;
        clearTimeout(timer);
        document.removeEventListener(FRAMEWORK_WRITE_RESULT, onResult);
        el.removeAttribute(FRAMEWORK_WRITE_ATTR);
        resolve(data);
      }

      const timer = setTimeout(function () {
        onResult({ detail: { requestId: requestId, ok: false, error: 'Editor bridge timed out.' } });
      }, 250);

      document.addEventListener(FRAMEWORK_WRITE_RESULT, onResult);
      el.setAttribute(FRAMEWORK_WRITE_ATTR, '1');
      document.dispatchEvent(
        new CustomEvent(FRAMEWORK_WRITE_REQUEST, {
          detail: { requestId: requestId, html: html, op: op || 'write' },
        })
      );
    });
  }

  function insertTextDirect(el, text) {
    const kind = getKind(el);
    if (kind === 'textarea') {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      let value;
      let caret;
      if (typeof start === 'number' && typeof end === 'number') {
        value = el.value.slice(0, start) + text + el.value.slice(end);
        caret = start + text.length;
      } else {
        value = (el.value || '') + ((el.value || '') ? '\n' : '') + text;
        caret = value.length;
      }
      setTextareaValue(el, value);
      if (typeof el.selectionStart === 'number') el.selectionStart = el.selectionEnd = caret;
      notifyChange(el);
      return;
    }

    const editable = kind === 'iframe' ? getIframeBody(el) : el;
    if (!editable) return;
    const ownerDoc = editable.ownerDocument || document;
    const sel = ownerDoc.getSelection ? ownerDoc.getSelection() : window.getSelection();
    const html = textToHtml(text);
    const caretInside =
      sel &&
      sel.rangeCount > 0 &&
      editable.contains(sel.getRangeAt(0).commonAncestorContainer);

    if (caretInside) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const frag = range.createContextualFragment(html);
      range.insertNode(frag);
      sel.collapseToEnd();
    } else {
      editable.insertAdjacentHTML('beforeend', html);
    }
    notifyChange(editable);
  }

  const Adapter = {
    getKind: getKind,

    /** 讀取編輯器目前的純文字內容 */
    getText: function (el) {
      const kind = getKind(el);
      if (kind === 'textarea') return el.value || '';
      if (kind === 'iframe') {
        const body = getIframeBody(el);
        return body ? body.innerText || '' : '';
      }
      return el.innerText || '';
    },

    /** 以純文字覆蓋整個編輯器內容 */
    setText: function (el, text) {
      const kind = getKind(el);
      if (kind === 'textarea') {
        el.value = text;
        notifyChange(el);
        return;
      }
      if (kind === 'iframe') {
        const body = getIframeBody(el);
        if (body) {
          body.innerHTML = textToHtml(text);
          notifyChange(body);
        }
        return;
      }
      el.innerHTML = textToHtml(text);
      notifyChange(el);
    },

    /**
     * 讀取編輯器目前的 HTML（保留富文字結構）。
     * 與 getText() 的差別：getText() 走 innerText，圖片 / 表格 / 連結 / 粗體在讀取當下就已遺失；
     * 需要完整往返（獨立編輯視窗）時一律用這支。
     */
    getHtml: function (el) {
      const kind = getKind(el);
      if (kind === 'textarea') return el.value || '';
      if (kind === 'iframe') {
        const body = getIframeBody(el);
        return body ? body.innerHTML || '' : '';
      }
      return el.innerHTML || '';
    },

    /**
     * 以 HTML 覆蓋整個編輯器內容。
     * ⚠ 呼叫端必須先 sanitize —— 本函式不做任何過濾，直接寫進 innerHTML。
     */
    setHtml: function (el, html) {
      const kind = getKind(el);
      const value = String(html == null ? '' : html);

      if (kind === 'textarea') {
        // 用原生 value setter 再派發事件：直接指定 el.value 時，
        // 部分框架（React / Angular 的 valueAccessor）會因為沒有經過 setter 而收不到變更。
        setTextareaValue(el, value);
        notifyChange(el);
        return;
      }
      if (kind === 'iframe') {
        const body = getIframeBody(el);
        if (body) {
          body.innerHTML = value;
          notifyChange(body);
        }
        return;
      }
      el.innerHTML = value;
      notifyChange(el);
    },

    /**
     * 優先透過 HaloPSA 頁面所使用的編輯器框架寫入 HTML，確保框架 model
     * 與畫面同步；若頁面沒有可辨識的框架，再退回既有 DOM 寫入。
     */
    setHtmlReliable: function (el, html) {
      const value = String(html == null ? '' : html);
      const kind = getKind(el);
      const adapter = this;

      if (kind === 'textarea') {
        adapter.setHtml(el, value);
        return Promise.resolve({ ok: true, via: 'native-textarea' });
      }

      return writeHtmlThroughFramework(el, value, 'write').then(function (result) {
        if (result && result.ok) return result;
        adapter.setHtml(el, value);
        return { ok: true, via: 'dom-fallback' };
      });
    },

    /** 在游標處插入文字；若無游標 / 無法定位則附加到結尾 */
    insertTextDirectLegacy: function (el, text) {
      const kind = getKind(el);

      if (kind === 'textarea') {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        if (typeof start === 'number' && typeof end === 'number') {
          const before = el.value.slice(0, start);
          const after = el.value.slice(end);
          el.value = before + text + after;
          const caret = start + text.length;
          el.selectionStart = el.selectionEnd = caret;
        } else {
          el.value += (el.value ? '\n' : '') + text;
        }
        notifyChange(el);
        return;
      }

      const editable = kind === 'iframe' ? getIframeBody(el) : el;
      if (!editable) return;

      const ownerDoc = editable.ownerDocument || document;
      const sel = ownerDoc.getSelection ? ownerDoc.getSelection() : window.getSelection();
      const html = textToHtml(text);

      // 若游標目前在此編輯器內，於游標處插入；否則附加到結尾
      const caretInside =
        sel &&
        sel.rangeCount > 0 &&
        editable.contains(sel.getRangeAt(0).commonAncestorContainer);

      if (caretInside) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const frag = range.createContextualFragment(html);
        range.insertNode(frag);
        sel.collapseToEnd();
      } else {
        editable.insertAdjacentHTML('beforeend', html);
      }
      notifyChange(editable);
    },

    insertText: function (el, text) {
      const content = String(text == null ? '' : text);
      const kind = getKind(el);
      if (kind === 'textarea') {
        insertTextDirect(el, content);
        return Promise.resolve({ ok: true, via: 'native-textarea' });
      }

      const insertHtml = textToHtml(content);
      const nextHtml = this.getHtml(el) + insertHtml;
      return writeHtmlThroughFramework(el, insertHtml, 'insert').then(function (result) {
        if (result && result.ok) return result;
        return writeHtmlThroughFramework(el, nextHtml, 'write').then(function (writeResult) {
          if (writeResult && writeResult.ok) return writeResult;
          insertTextDirect(el, content);
          return { ok: true, via: 'dom-fallback' };
        });
      });
    },

    /**
     * 只派發框架同步事件，不改動內容。
     * 供診斷用：把「寫入」與「事件」兩個副作用拆開測試。
     */
    notify: function (el) {
      const kind = getKind(el);
      notifyChange(kind === 'iframe' ? getIframeBody(el) : el);
    },

    /** 取得實際可編輯的元素（iframe → 其 body；其餘 → 自身），供樣式套用使用 */
    getEditableElement: function (el) {
      return getKind(el) === 'iframe' ? getIframeBody(el) : el;
    },
  };

  NS.core.adapter = Adapter;
})();
